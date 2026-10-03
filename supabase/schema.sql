-- Hope — cloud schema for sync (docs/rebuild-plan.md, section 12.1).
--
-- Paste the whole file into the Supabase SQL Editor and run it. It is safe to run again: tables are
-- created only if missing, functions are replaced, and triggers / policies are dropped and recreated.
-- (Running it again does NOT alter existing tables; a later schema change will ship its own migration.)
--
-- Rules every client relies on:
--   * Columns mirror the local SQLite tables, plus user_id (owner) and server_seq (pull cursor).
--   * Last write wins on (updated_ms, device_id): an update that is not newer leaves the stored row as is.
--   * server_seq comes from one global sequence and is bumped on every accepted write.
--   * Only one running session per user: the one that started last keeps running.
--   * No foreign keys between tables: rows may arrive in any order.

create sequence if not exists public.sync_seq;

-- ---------------------------------------------------------------------------------------------
-- Tables

create table if not exists public.activity (
  user_id     uuid   not null default auth.uid(),
  id          text   not null,
  name        text   not null,
  color       text   not null check (color in ('blue','green','orange','pink','purple','teal','yellow','gray')),
  symbol      text,
  sort        bigint not null default 0,
  archived_at bigint,
  parent_id   text,
  updated_ms  bigint not null,
  deleted_ms  bigint,
  device_id   text   not null,
  server_seq  bigint not null,
  primary key (user_id, id)
);

create table if not exists public.session (
  user_id      uuid   not null default auth.uid(),
  id           text   not null,
  activity_id  text   not null,
  start_ms     bigint not null,
  end_ms       bigint,                              -- null = running
  note         text,
  continues_id text,
  plan_id      text,
  updated_ms   bigint not null,
  deleted_ms   bigint,
  device_id    text   not null,
  server_seq   bigint not null,
  primary key (user_id, id),
  check (end_ms is null or end_ms >= start_ms)
);

create table if not exists public.plan (
  user_id     uuid    not null default auth.uid(),
  id          text    not null,
  activity_id text    not null,
  date        text    not null,
  start_hm    text    not null,
  end_hm      text    not null,
  rule        text,
  auto_log    integer not null default 1,           -- 0 / 1, as in SQLite
  until       text,
  updated_ms  bigint  not null,
  deleted_ms  bigint,
  device_id   text    not null,
  server_seq  bigint  not null,
  primary key (user_id, id)
);

create table if not exists public.journal (
  user_id    uuid   not null default auth.uid(),
  id         text   not null,
  date       text   not null,
  text       text   not null,
  updated_ms bigint not null,
  deleted_ms bigint,
  device_id  text   not null,
  server_seq bigint not null,
  primary key (user_id, id)
);

create table if not exists public.day (
  user_id        uuid    not null default auth.uid(),
  date           text    not null,
  wake_ms        bigint,
  sleep_ms       bigint,
  utc_offset_min integer not null,
  updated_ms     bigint  not null,
  deleted_ms     bigint,
  device_id      text    not null,
  server_seq     bigint  not null,
  primary key (user_id, date)
);

-- ---------------------------------------------------------------------------------------------
-- Last write wins + server_seq (BEFORE INSERT OR UPDATE, every table)

create or replace function public.hope_lww()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- Not newer than the stored row: keep the stored row, drop this write. Ties go to the larger
    -- device_id, compared bytewise ("C") so every client computes the same winner.
    if new.updated_ms < old.updated_ms
       or (new.updated_ms = old.updated_ms and new.device_id collate "C" <= old.device_id collate "C") then
      return old;
    end if;
    new.user_id := old.user_id;
  end if;
  new.server_seq := nextval('public.sync_seq');
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Only one running session per user (AFTER INSERT OR UPDATE on session)
--
-- When a row becomes running, every running session of that user except the latest-started one is
-- ended at the start of the next running one, with updated_ms raised so the change wins everywhere.
-- No recursion: the rows this updates are no longer running, so the WHEN clause skips them.

create or replace function public.hope_single_running()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Two devices starting at once: serialize per user so the second statement sees the first.
  perform pg_advisory_xact_lock(hashtextextended('hope.single_running:' || new.user_id::text, 0));
  update public.session s
     set end_ms     = r.next_start,
         updated_ms = greatest(s.updated_ms + 1, (extract(epoch from clock_timestamp()) * 1000)::bigint)
    from (
      select id, lead(start_ms) over (order by start_ms, id collate "C") as next_start
        from public.session
       where user_id = new.user_id and end_ms is null and deleted_ms is null
    ) r
   where s.user_id = new.user_id
     and s.id = r.id
     and r.next_start is not null;
  return null;
end;
$$;

drop trigger if exists hope_single_running on public.session;
create trigger hope_single_running
  after insert or update on public.session
  for each row
  when (new.end_ms is null and new.deleted_ms is null)
  execute function public.hope_single_running();

-- ---------------------------------------------------------------------------------------------
-- Per-table: pull index, trigger, privileges, row-level security

grant usage on sequence public.sync_seq to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['activity', 'session', 'plan', 'journal', 'day'] loop
    execute format('create index if not exists %I on public.%I (user_id, server_seq)', t || '_user_seq', t);

    execute format('drop trigger if exists hope_lww on public.%I', t);
    execute format(
      'create trigger hope_lww before insert or update on public.%I for each row execute function public.hope_lww()', t);

    -- Only signed-in users, only through RLS. Hope never uses the anon role for data.
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);

    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists hope_select on public.%I', t);
    execute format('drop policy if exists hope_insert on public.%I', t);
    execute format('drop policy if exists hope_update on public.%I', t);
    execute format('drop policy if exists hope_delete on public.%I', t);
    execute format(
      'create policy hope_select on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format(
      'create policy hope_insert on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t);
    -- Upsert (INSERT … ON CONFLICT DO UPDATE) needs both: USING to touch the existing row,
    -- WITH CHECK for the row it leaves behind.
    execute format(
      'create policy hope_update on public.%I for update to authenticated '
      'using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format(
      'create policy hope_delete on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t);
  end loop;
end;
$$;

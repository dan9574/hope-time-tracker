// src/pages/StatsMonth.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom"; // <-- added: import useNavigate
import Calendar from "react-calendar";
import "react-calendar/dist/Calendar.css";
import "./StatsMonth.css";
import dayjs from "dayjs";
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import type { Activity } from "../types";

dayjs.extend(isSameOrAfter);



type RawRow = { key: string; millis: number };
type ViewRow = { key: string; millis: number };
type Mode = "simple" | "detailed";

function normalizeBase(s: string) {
  if (!s) return "";
  let t = s
    .replace(/\uFF0F/g, "/")
    .replace(/\uFF5C/g, "|")
    .replace(/\uFF1A/g, ":")
    .replace(/\u3000/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/[\/|:>\-–—]+\s*$/g, "").trim();
  return t;
}

function splitKey(k: string): { main: string; sub?: string } {
  const raw = normalizeBase(k);
  if (!raw) return { main: "(Uncategorized)" };
  const mParen = raw.match(/^(.+?)[(（]\s*(.+?)\s*[)）]\s*$/);
  if (mParen) {
  const main = normalizeBase(mParen[1]);
  const sub  = normalizeBase(mParen[2]);
  return { main: main || "(Uncategorized)", sub: sub || undefined };
  }
  const sepRegex = /\s*(\/|>|\\| \| |::|:| - |–|—|\|)\s*/;
  const idx = raw.search(sepRegex);
  if (idx > -1) {
    const match = raw.match(sepRegex);
    if (match) {
      const i = match.index ?? -1;
      const sepLen = match[0].length;
      const main = normalizeBase(raw.slice(0, i));
      const sub  = normalizeBase(raw.slice(i + sepLen));
      return { main: main || "(Uncategorized)", sub: sub || undefined };
    }
  }
  return { main: raw };
}

function formatMs(ms: number) {
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes <= 0) return "0m";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}


export default function StatsMonth() {
  const [mode, setMode] = useState<Mode>("simple");
  const [month, setMonth] = useState<Date>(() => new Date());
  const ym = useMemo(() => dayjs(month).format("YYYY-MM"), [month]);

  const [raw, setRaw] = useState<RawRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [openCalendar, setOpenCalendar] = useState(false);
  const [daysWithData, setDaysWithData] = useState<Set<string>>(new Set());
  const [activities, setActivities] = useState<Activity[]>([]);
  // Future dates are not clickable; no need to load weekly templates or future manual plans

  const navigate = useNavigate(); // <-- added: initialize navigate

  useEffect(() => {
    let aborted = false;
    (async () => {
      setLoading(true);
      try {
        // Combined source: actual sessions (including manual records) + daily_instantiated_plans
        const list = (await (window.api as any)?.getMonthCombinedSummary?.(ym)) ?? [];
        if (!aborted) setRaw(list);

        const listDays = (await (window.api as any)?.getDaysWithDataInMonth?.(ym)) ?? [];
        if (!aborted)
          setDaysWithData(new Set(listDays.map((s: string) => dayjs(s).format("YYYY-MM-DD"))));

        // Do not load weekly plans or manual plans for future dates (no interaction needed)
      } finally {
        if (!aborted) setLoading(false);
      }
    })();
    return () => { aborted = true; };
  }, [ym, month]);

  // Load activity color map (initialize once or reload on settings change)
  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        const acts = (await (window.api as any)?.listActivitiesWithColors?.()) ?? [];
        if (!aborted) setActivities(acts);
      } catch {}
    })();
    return () => { aborted = true; };
  }, []);

  const colorMap = useMemo(() => {
    const m = new Map<string, { color?: string; text?: string; bg?: string }>();
    for (const a of activities) {
      if (!a?.name) continue;
      m.set(a.name, {
        color: a.color_hex,
        text: a.text_color,
        bg: a.background_color,
      });
    }
    return m;
  }, [activities]);

  const rows: ViewRow[] = useMemo(() => {
    if (raw.length === 0) return [];
    if (mode === "detailed") {
      const map = new Map<string, number>();
      for (const r of raw) {
        const { main, sub } = splitKey(r.key);
        const label = sub ? `${main} / ${sub}` : main;
        map.set(label, (map.get(label) ?? 0) + (r.millis || 0));
      }
      return [...map.entries()].map(([key, millis]) => ({ key, millis }))
        .sort((a, b) => b.millis - a.millis);
    } else {
      const map = new Map<string, number>();
      for (const r of raw) {
        const { main } = splitKey(r.key);
        map.set(main, (map.get(main) ?? 0) + (r.millis || 0));
      }
      return [...map.entries()].map(([key, millis]) => ({ key, millis }))
        .sort((a, b) => b.millis - a.millis);
    }
  }, [raw, mode]);

  const monthTotalMs = useMemo(() => rows.reduce((a, b) => a + (b.millis || 0), 0), [rows]);

  const prevMonth = () => setMonth((d) => dayjs(d).subtract(1, "month").toDate());
  const nextMonth = () => setMonth((d) => dayjs(d).add(1, "month").toDate());

  // Calendar click handler: future dates are not allowed (weekly plans are visualization-only)
  function handleDayClick(date: Date) {
    const clickedDate = dayjs(date);
    const today = dayjs();
    if (clickedDate.isAfter(today, 'day')) return; // Future dates are not clickable
    
    const isoDate = clickedDate.format('YYYY-MM-DD');
    navigate(`/center/day/${isoDate}`);
  }

  return (
    <div className="stats-month-container">
      <div className="stats-month-header">
        <div className="title-and-month">
          <h1 className="page-title">Monthly</h1>
          <div className="month-switch">
            <button className="ghost-btn" onClick={prevMonth}>‹</button>
            <span className="month-text">{dayjs(month).format("MMMM YYYY")}</span>
            <button className="ghost-btn" onClick={nextMonth}>›</button>
            <button className="ghost-btn" onClick={() => setOpenCalendar(v => !v)}>
              {openCalendar ? "Hide calendar" : "Open calendar"}
            </button>
          </div>
        </div>
        <div className="modes">
          <div className="total" title="Total time this month">{formatMs(monthTotalMs)}</div>
          <label className={"mode " + (mode === "simple" ? "active" : "")}
                 onClick={() => setMode("simple")}>Simple</label>
          <label className={"mode " + (mode === "detailed" ? "active" : "")}
                 onClick={() => setMode("detailed")}>Detailed</label>
        </div>
      </div>

      {openCalendar && (
        <div className="calendar-container">
          <Calendar
            value={month}
            onChange={(d) => { if (d && !Array.isArray(d)) setMonth(d); }}
            onActiveStartDateChange={({ activeStartDate }) => {
              if (activeStartDate) setMonth(activeStartDate);
            }}
            onClickDay={handleDayClick}
            view="month"
            minDetail="month"
            locale="en-US"
            formatMonthYear={(_locale, date) => new Date(date).toLocaleString('en-US', { month: 'long', year: 'numeric' })}
            tileClassName={({ date, view }) => {
              if (view !== "month") return undefined;
              const clickedDate = dayjs(date);
              const today = dayjs();
              const key = clickedDate.format("YYYY-MM-DD");
                      if (clickedDate.isAfter(today, 'day')) return "future-date"; // Future: disabled state
              return daysWithData.has(key) ? "has-data" : undefined;
            }}
            tileContent={({ date, view }) => {
              if (view !== "month") return null;
              const clickedDate = dayjs(date);
              const today = dayjs();
                      // Do not show plan count for future dates
              if (clickedDate.isAfter(today, 'day')) return null;
              return null;
            }}
            formatShortWeekday={(_locale, date) => dayjs(date).format("dd").charAt(0)}
          />
        </div>
      )}

      <div className="stats-month-body">
  {loading && <div className="loading">Loading...</div>}
  {!loading && rows.length === 0 && <div className="empty">No data for this month</div>}
        {!loading && rows.length > 0 && (
          <ul className={"rows " + mode}>
            {rows.map((r) => {
              // Bar width represents the percentage of the month's total
              const percent = monthTotalMs > 0 ? Math.round((r.millis / monthTotalMs) * 100) : 0;
              const { main } = splitKey(r.key);
              const colors = colorMap.get(main);
              const barStyle: React.CSSProperties = colors?.color ? { background: colors.color } : {};
              return (
                <li className="row" key={r.key}>
                  <div className="row-main">
                    <span className="label-dot" style={{ background: colors?.color || '#3B82F6' }} />
                    <div className="label">{r.key}</div>
                  </div>
                  <div className="bar-container">
                    <div className="bar-wrap" aria-hidden title={`${percent}%`}>
                      <div className="bar" style={{ width: `${percent}%`, ...barStyle }} />
                    </div>
                    <div className="time">{formatMs(r.millis)}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
// src/pages/StartCenter.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./StartCenter.css";
// Reuse Settings grouping and item styles
import "./Settings.css";

type Opt = { id:number; name:string }
type Sub = { id:number; activityId:number; name:string }
type Tab = "create" | "delete";

export default function StartCenter(){
  const nav = useNavigate();
  const [acts,setActs] = useState<Opt[]>([]);
  const [subs,setSubs] = useState<Sub[]>([]);
  // Single line: main activity + optional sub-activity
  const [activityId,setActivityId] = useState<number|null>(null);
  const [subActivityId,setSubActivityId] = useState<number|null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("create");

  const [newActName, setNewActName] = useState("");
  const [subForAid, setSubForAid] = useState<number|null>(null);
  const [newSubName, setNewSubName] = useState("");
  const newActRef = useRef<HTMLInputElement>(null);
  const newSubRef = useRef<HTMLInputElement>(null);

  const [delAid, setDelAid] = useState<number|null>(null);
  const [delSid, setDelSid] = useState<number|null>(null);

  const collapseRef = useRef<HTMLDivElement>(null);
  const [collH, setCollH] = useState(0);

  const createBtnRef = useRef<HTMLButtonElement>(null);
  const deleteBtnRef = useRef<HTMLButtonElement>(null);
  const [gliderStyle, setGliderStyle] = useState({});

  // ——— Journal (message board) state ———
  type JournalItem = { id:number; day_date:string; created_ms:number; content:string; edited_ms:number|null };
  const [journalItems, setJournalItems] = useState<JournalItem[]>([]);
  const [journalInput, setJournalInput] = useState("");
  const [journalLoading, setJournalLoading] = useState(false);
  const [journalHasMore, setJournalHasMore] = useState(true);
  const journalScrollRef = useRef<HTMLDivElement>(null);

  const subsFiltered = useMemo(
    () => subs.filter(x=>activityId?x.activityId===activityId:true),
    [subs,activityId]
  );

  async function refresh(){
    const a = await window.api.listActivities(); setActs(a);
    const s = await window.api.listSubActivities(null); setSubs(s);
    if (a.length){
      setActivityId(v => v ?? a[0].id);
      setSubForAid(v => v ?? a[0].id);
      setDelAid(v => v ?? a[0].id);
    }
    if (s.length){ setDelSid(v => v ?? s[0].id); }
  }
  useEffect(()=>{ refresh(); },[]);

  // Load recent journal entries on first render
  useEffect(() => {
    loadRecentJournal(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (editOpen) {
      requestAnimationFrame(() => {
        const h = collapseRef.current?.scrollHeight ?? 0;
        setCollH(h);
      });
    } else {
      setCollH(0);
    }
  }, [editOpen, tab, acts, subs]);

  useEffect(() => {
    if (!editOpen) return;

    let targetBtn: HTMLButtonElement | null = null;
    if (tab === "create") {
      targetBtn = createBtnRef.current;
    } else {
      targetBtn = deleteBtnRef.current;
    }

    if (targetBtn) {
      const { offsetWidth, offsetLeft } = targetBtn;
      setGliderStyle({
        width: `${offsetWidth}px`,
        transform: `translateX(${offsetLeft}px)`,
      });
    }
  }, [tab, editOpen, acts, subs]);

  async function startSession(){
    await window.api.startSession({activityId:activityId, subActivityId:subActivityId ?? null, note:""});
    nav("/hud");
  }

  async function onAddActivity(){
    const name = newActName.trim();
  if (!name) return;
    await window.api.upsertActivity(name);
    setNewActName(""); await refresh();
    setTimeout(()=>newActRef.current?.focus(),0);
  }
  async function onAddSub(){
    const aid = subForAid; const name = newSubName.trim();
  if (!aid) return alert("Please select a main activity"); if (!name) return;
    await window.api.upsertSubActivity(aid, name);
    setNewSubName(""); await refresh();
    setTimeout(()=>newSubRef.current?.focus(),0);
  }

  async function onDeleteActivity(){
  if (!delAid) return;
    const target = acts.find(a=>a.id===delAid);
    if (!target) return;
  if (!confirm(`Delete activity "${target.name}"? Its sub-activities will also be deleted. This will be blocked if there are historical references.`)) return;
    const res = await (window.api as any).deleteActivity(delAid);
  if (res && res.ok === false) return alert(res?.reason || "Delete failed");
    await refresh();
  }
  async function onDeleteSub(){
    if (!delSid) return;
    const target = subs.find(s=>s.id===delSid);
    if (!target) return;
  const actName = acts.find(a=>a.id===target.activityId)?.name ?? "(Unknown main activity)";
  if (!confirm(`Delete sub-activity "${actName} / ${target.name}"? This will be blocked if there are historical references.`)) return;
  const res = await (window.api as any).deleteSubActivity(delSid);
  if (res && res.ok === false) return alert(res?.reason || "Delete failed");
    await refresh();
  }

  async function loadRecentJournal(reset=false){
    if (journalLoading) return;
    setJournalLoading(true);
    try {
      // We keep items in memory in ascending order by created_ms (old → new)
      // When loading more, use the current oldest entry as the cursor
      const cursor = reset ? null : (journalItems[0]?.created_ms ?? null);
      const res = await window.api.listJournalRecent(30, cursor ?? null);
      if (res && res.ok) {
  // API returns items in descending order by created_ms; reverse them to ascending
        const batchAsc = [...res.items].reverse();
        let merged: JournalItem[];
        if (reset) {
          merged = batchAsc;
        } else {
          merged = [...batchAsc, ...journalItems];
        }
  // Record previous scroll position before loading
        const el = journalScrollRef.current;
        const prevBottom = el ? (el.scrollHeight - el.scrollTop) : 0;
        setJournalItems(merged);
        setJournalHasMore((res.items?.length ?? 0) > 0);
        setTimeout(() => {
          const el2 = journalScrollRef.current;
          if (!el2) return;
          if (reset) {
            // On initial load, scroll to bottom
            el2.scrollTop = el2.scrollHeight;
          } else {
            // Preserve previous position when loading older messages at the top
            el2.scrollTop = Math.max(0, el2.scrollHeight - prevBottom);
          }
        }, 0);
      }
    } finally {
      setJournalLoading(false);
    }
  }

  async function sendJournal(){
    const text = journalInput.trim();
    if (!text) return;
    const r = await window.api.addJournal(text);
    if (r && r.ok) {
      const item = { id: r.id!, day_date: r.day_date!, created_ms: r.created_ms!, content: text, edited_ms: null };
      setJournalItems(prev => [...prev, item]);
      setJournalInput("");
      requestAnimationFrame(() => {
        const el = journalScrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  }

  function groupByDay(items: JournalItem[]) {
    const map = new Map<string, JournalItem[]>();
    for (const it of items) {
  if (!map.has(it.day_date)) map.set(it.day_date, []);
      map.get(it.day_date)!.push(it);
    }
    return [...map.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
  }

  return (
    <div>
  <h2 style={{margin:"0 0 12px"}}>Start</h2>

      {/* Session starter area: follows Settings item style */}
      <div className="settings-section">
        <h3>Sessions</h3>
        <div className="setting-item">
          <div className="setting-item-label">
            <h4>Start a new session</h4>
            <p>Select an activity first; leave sub-activity as "(no sub)" if not needed.</p>
          </div>
          <div className="setting-item-action">
            <select value={activityId ?? ""} onChange={e=>{ const v=e.target.value?Number(e.target.value):null; setActivityId(v); setSubActivityId(null); }}>
              {acts.map(x=>
                <option key={x.id} value={x.id}>{x.name}</option>)
              }
            </select>
            <select value={subActivityId ?? ""} onChange={e=>setSubActivityId(e.target.value?Number(e.target.value):null)}>
              <option value="">(No sub)</option>
              {subsFiltered.map(x=>
                <option key={x.id} value={x.id}>{x.name}</option>)
              }
            </select>
            <button className="icon-btn primary" onClick={startSession} title="Start" disabled={!activityId}>▶</button>
          </div>
        </div>
      </div>

      {/* Activity management */}
      <div className="settings-section">
        <h3>Activity management</h3>
        <div className="glass edit-card" style={{padding: "12px"}}>
          <div className="edit-header-clickable" onClick={() => setEditOpen(v => !v)}>
            <div className="edit-title">Edit</div>
            <div className={"edit-chevron " + (editOpen ? "open" : "")}>▼</div>
          </div>

          <div className={"collapse " + (editOpen ? "open" : "")} style={{ height: collH }}>
            <div ref={collapseRef} className="collapse-inner">
              <div style={{ marginBottom: 10, paddingTop: 4 }}>
                <div className="segmented-control">
                  <div className="segmented-control-glider" style={gliderStyle} />
                  <button
                    ref={createBtnRef}
                    className={"segmented-control-btn " + (tab === "create" ? "active" : "")}
                    onClick={() => setTab("create")}
                  >
                    <span>+</span>
                    <span>Create</span>
                  </button>
                  <button
                    ref={deleteBtnRef}
                    className={"segmented-control-btn " + (tab === "delete" ? "active" : "")}
                    onClick={() => setTab("delete")}
                  >
                    <span>🗑️</span>
                    <span>Delete</span>
                  </button>
                </div>
              </div>

              <div className="edit-body">
                {tab === "create" ? (
                  <div>
                    <div className="setting-item" style={{marginBottom:8}}>
                      <div className="setting-item-label">
                        <h4>Create a main activity</h4>
                        <p>Examples: Gaming, Study, Exercise…</p>
                      </div>
                      <div className="setting-item-action" style={{display:"flex", alignItems:"center"}}>
         <input ref={newActRef} className="input" placeholder="New activity: e.g. Study"
                               value={newActName} onChange={e=>setNewActName(e.target.value)} style={{minWidth:220}} />
                        <button className="icon-btn primary" onClick={onAddActivity} title="添加" disabled={!newActName.trim()}>＋</button>
                      </div>
                    </div>

                    <div className="setting-item">
                      <div className="setting-item-label">
                        <h4>Create a sub-activity</h4>
                        <p>Select a main activity first, then enter sub-activity name.</p>
                      </div>
                      <div className="setting-item-action" style={{display:"flex", alignItems:"center"}}>
                        <select className="select" value={subForAid ?? ""} onChange={e=>setSubForAid(e.target.value?Number(e.target.value):null)}>
                          {acts.map(x=> <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
         <input ref={newSubRef} className="input" placeholder="New sub-activity: e.g. Minecraft"
                               value={newSubName} onChange={e=>setNewSubName(e.target.value)} style={{minWidth:220}} />
                        <button className="icon-btn primary" onClick={onAddSub} title="添加" disabled={!subForAid || !newSubName.trim()}>＋</button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="setting-item" style={{marginBottom:8}}>
                      <div className="setting-item-label">
                        <h4>Delete main activity</h4>
                        <p>Deletion will be blocked if historical references exist.</p>
                      </div>
                      <div className="setting-item-action" style={{display:"flex", alignItems:"center"}}>
                        <select className="select" value={delAid ?? ""} onChange={e=>setDelAid(e.target.value?Number(e.target.value):null)}>
                          {acts.map(x=> <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                        <button className="icon-btn danger" onClick={onDeleteActivity} title="Delete activity" disabled={!delAid}>🗑</button>
                      </div>
                    </div>

                    <div className="setting-item">
                      <div className="setting-item-label">
                        <h4>Delete sub-activity</h4>
                        <p>Select an item to delete; deletion will be blocked if historical references exist.</p>
                      </div>
                      <div className="setting-item-action" style={{display:"flex", alignItems:"center"}}>
                        <select className="select" value={delSid ?? ""} onChange={e=>setDelSid(e.target.value?Number(e.target.value):null)}>
                          {subs.map(x=>{
                            const an = acts.find(a=>a.id===x.activityId)?.name ?? "(?)";
                            return <option key={x.id} value={x.id}>{an} / {x.name}</option>;
                          })}
                        </select>
                        <button className="icon-btn danger" onClick={onDeleteSub} title="Delete sub-activity" disabled={!delSid}>🗑</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Journal: plain text, grouped by day, scrollable */}
      <div className="settings-section">
        <h3>Journal</h3>
        <div className="glass" style={{ padding: 12 }}>
          <div
            ref={journalScrollRef}
            className="journal-scroll"
            onScroll={(e) => {
              const el = e.currentTarget;
              if (el.scrollTop < 40 && journalHasMore && !journalLoading) {
                loadRecentJournal(false);
              }
            }}
            style={{
              maxHeight: 172,
              overflowY: 'auto',
              padding: '6px 8px',
              borderRadius: 8,
              background: 'rgba(255,255,255,0.6)'
            }}
          >
            {groupByDay(journalItems).map(([day, items]) => (
              <div key={day} style={{ marginBottom: 12 }}>
                <div style={{ textAlign: 'center', color: 'var(--ink-weak)', fontSize: 12, margin: '6px 0' }}>{day}</div>
                {items.map(it => (
                  <div key={it.id} style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                    <div className="bubble self" title={new Date(it.created_ms).toLocaleString()}>{it.content}</div>
                  </div>
                ))}
              </div>
            ))}
            {journalLoading && <div style={{ textAlign: 'center', color: 'var(--ink-weak)', fontSize: 12 }}>Loading…</div>}
          </div>
          <div className="setting-item" style={{ marginTop: 8 }}>
            <div className="setting-item-label">
              <h4>Write something</h4>
              <p>Press Enter to send; only plain text is kept.</p>
            </div>
            <div className="setting-item-action" style={{ display:'flex', alignItems:'center' }}>
              <input
                className="input"
                placeholder="Thoughts for today…"
                value={journalInput}
                onChange={e=>setJournalInput(e.target.value)}
                onKeyDown={e=>{ if (e.key==='Enter') sendJournal(); }}
                style={{ flex: 1, minWidth: 220 }}
              />
              <button className="icon-btn primary" onClick={sendJournal} disabled={!journalInput.trim()}>↵</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
import { useEffect, useMemo, useRef, useState } from 'react';
import './Settings.css';
import './StartCenter.css';
import './Developer.css';

type SessionRow = { id:number; activity_id:number|null; sub_activity_id:number|null; start_ms:number; end_ms:number|null; duration_ms:number|null; is_manual:number; note:string; activity_name:string|null; sub_activity_name:string|null };
type JournalRow = { id:number; day_date:string; created_ms:number; content:string; edited_ms:number|null };

export default function Developer(){
  const [tab, setTab] = useState<'sessions'|'journal'>('sessions');
  const [sess, setSess] = useState<SessionRow[]>([]);
  const [sessTotal, setSessTotal] = useState(0);
  const [sessSel, setSessSel] = useState<Set<number>>(new Set());
  const [jrn, setJrn] = useState<JournalRow[]>([]);
  const [jrnTotal, setJrnTotal] = useState(0);
  const [jrnSel, setJrnSel] = useState<Set<number>>(new Set());

  async function loadSessions(){
    const r = await window.api.dev.sessions.list(1, 200);
    if (r.ok){ setSess(r.items); setSessTotal(r.total); setSessSel(new Set()); }
  }
  async function loadJournal(){
    const r = await window.api.dev.journal.list(1, 300);
    if (r.ok){ setJrn(r.items); setJrnTotal(r.total); setJrnSel(new Set()); }
  }

  useEffect(()=>{ loadSessions(); loadJournal(); },[]);

  const sessAllIds = useMemo(()=>sess.map(x=>x.id),[sess]);
  const jrnAllIds = useMemo(()=>jrn.map(x=>x.id),[jrn]);

  async function delSessions(ids: number[]){
    if (ids.length===0) return;
    if (!confirm(`Delete the selected ${ids.length} session(s)? This action cannot be undone.`)) return;
    const r = await window.api.dev.sessions.delete(ids);
    if (r.ok){ await loadSessions(); }
  }
  async function clearSessions(){
    if (!confirm('Delete all session records? This action cannot be undone.')) return;
    if (!confirm('Are you sure? This will permanently delete ALL session records.')) return;
    const r = await window.api.dev.sessions.deleteAll();
    if (r.ok){ await loadSessions(); }
  }

  async function delJournal(ids: number[]){
    if (ids.length===0) return;
    if (!confirm(`Delete the selected ${ids.length} journal entry(ies)? This action cannot be undone.`)) return;
    const r = await window.api.dev.journal.delete(ids);
    if (r.ok){ await loadJournal(); }
  }
  async function clearJournal(){
    if (!confirm('Delete all journal entries? This action cannot be undone.')) return;
    if (!confirm('Are you sure? This will permanently delete ALL journal entries.')) return;
    const r = await window.api.dev.journal.deleteAll();
    if (r.ok){ await loadJournal(); }
  }

  // segmented control（参考“简洁/详细”风格）
  const sessBtnRef = useRef<HTMLButtonElement>(null);
  const jrnBtnRef = useRef<HTMLButtonElement>(null);
  const [gliderStyle, setGliderStyle] = useState<any>({});
  useEffect(() => {
    const target = tab==='sessions' ? sessBtnRef.current : jrnBtnRef.current;
    if (target) {
      const { offsetWidth, offsetLeft } = target;
      setGliderStyle({ width: `${offsetWidth}px`, transform: `translateX(${offsetLeft}px)` });
    }
  }, [tab]);

  return (
    <div className="developer-page">
      <h2 style={{marginTop:0}}>Developer Tools</h2>
      <div className="settings-section">
        <h3>Mode</h3>
        <div className="setting-item">
          <div className="setting-item-label">
            <h4>This page provides deletion tools only</h4>
            <p>Supports: delete all / multi-select delete / single delete. Actions are irreversible.</p>
          </div>
          <div className="setting-item-action" style={{gap:8, alignItems:'center'}}>
            <div className="segmented-control">
              <div className="segmented-control-glider" style={gliderStyle} />
              <button ref={sessBtnRef} className={"segmented-control-btn "+(tab==='sessions'?'active':'')} onClick={()=>setTab('sessions')}>Sessions</button>
              <button ref={jrnBtnRef} className={"segmented-control-btn "+(tab==='journal'?'active':'')} onClick={()=>setTab('journal')}>Journal</button>
            </div>
          </div>
        </div>
      </div>

      {tab==='sessions' ? (
        <div className="settings-section">
          <div className="setting-item">
            <div className="setting-item-label">
              <h4>Total</h4>
              <p>{sessTotal} items</p>
            </div>
            <div className="setting-item-action" style={{gap:8}}>
              <button className="icon-btn danger" title="Delete all" onClick={clearSessions}>Delete all</button>
              <button className="icon-btn danger" title="Delete selected" onClick={()=>delSessions([...sessSel])} disabled={sessSel.size===0}>Delete selected</button>
              <button className="icon-btn" title="Toggle select all" onClick={()=>{
                if (sessSel.size===sessAllIds.length) setSessSel(new Set()); else setSessSel(new Set(sessAllIds));
              }}>✓</button>
            </div>
          </div>
          <div className="glass" style={{padding:12, maxHeight:360, overflow:'auto'}}>
            {sess.map(row => (
              <div key={row.id} className="setting-item" style={{alignItems:'center'}}>
                <div className="setting-item-label">
                  <h4>#{row.id} {row.activity_name || '(no activity selected)'}{row.sub_activity_name ? (' / '+row.sub_activity_name):''}</h4>
                  <p>{new Date(row.start_ms).toLocaleString()} {row.duration_ms? `· ${(row.duration_ms/60000).toFixed(1)} min` : ''}</p>
                </div>
                <div className="setting-item-action" style={{gap:8,alignItems:'center'}}>
                  <input type="checkbox" checked={sessSel.has(row.id)} onChange={e=>{
                    const m=new Set(sessSel); if(e.target.checked) m.add(row.id); else m.delete(row.id); setSessSel(m);
                  }}/>
                  <button className="icon-btn danger" title="Delete" onClick={()=>delSessions([row.id])}>🗑</button>
                </div>
              </div>
            ))}
            {sess.length===0 && <div style={{textAlign:'center', color:'var(--ink-weak)'}}>No data</div>}
          </div>
        </div>
      ) : (
        <div className="settings-section">
          <div className="setting-item">
            <div className="setting-item-label">
              <h4>Total</h4>
              <p>{jrnTotal} items</p>
            </div>
            <div className="setting-item-action" style={{gap:8}}>
              <button className="icon-btn danger" title="Delete all" onClick={clearJournal}>Delete all</button>
              <button className="icon-btn danger" title="Delete selected" onClick={()=>delJournal([...jrnSel])} disabled={jrnSel.size===0}>Delete selected</button>
              <button className="icon-btn" title="Toggle select all" onClick={()=>{
                if (jrnSel.size===jrnAllIds.length) setJrnSel(new Set()); else setJrnSel(new Set(jrnAllIds));
              }}>✓</button>
            </div>
          </div>
          <div className="glass" style={{padding:12, maxHeight:360, overflow:'auto'}}>
            {jrn.map(row => (
              <div key={row.id} className="setting-item" style={{alignItems:'center'}}>
                <div className="setting-item-label">
                  <h4>#{row.id} {row.day_date}</h4>
                  <p>{new Date(row.created_ms).toLocaleString()}</p>
                  <div style={{whiteSpace:'pre-wrap'}}>{row.content}</div>
                </div>
                <div className="setting-item-action" style={{gap:8,alignItems:'center'}}>
                  <input type="checkbox" checked={jrnSel.has(row.id)} onChange={e=>{
                    const m=new Set(jrnSel); if(e.target.checked) m.add(row.id); else m.delete(row.id); setJrnSel(m);
                  }}/>
                  <button className="icon-btn danger" title="Delete" onClick={()=>delJournal([row.id])}>🗑</button>
                </div>
              </div>
            ))}
            {jrn.length===0 && <div style={{textAlign:'center', color:'var(--ink-weak)'}}>No data</div>}
          </div>
        </div>
      )}
    </div>
  );
}

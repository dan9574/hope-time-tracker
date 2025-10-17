import { useEffect, useState } from "react"
function ms(ms:number){ const s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60); return `${h}h ${m}m` }
export default function StatsToday(){
  const [rows, setRows] = useState<Array<{activity:string, subActivity:string|null, millis:number}>>([])
  useEffect(()=>{ (window.api as any).getToday().then(setRows) },[])
  return (
    <div className="stats-today-bg">
      <h2 style={{marginTop:0}}>Today</h2>
      {rows.length===0 && <div style={{opacity:.6}}>No data</div>}
      {rows.map((r,i)=>(
        <div className="kv" key={i}>
          <div>{r.activity}{r.subActivity?` / ${r.subActivity}`:''}</div>
          <div>{ms(r.millis)}</div>
        </div>
      ))}
    </div>
  )
}

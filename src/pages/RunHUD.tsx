// src/pages/RunHUD.tsx
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

// HUD type augmentation only; the API is already defined in global types
declare global {
  interface Window {
    hud: { enter: (w?: number, h?: number) => void; leave: () => void };
  }
}

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(ss)}`;
}


const TICK_MS = 200;
const HOLD_MS = 1200;

export default function RunHUD() {
  const nav = useNavigate();

  // --- State logic refactor ---
  const [startMs, setStartMs] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  // New: stores elapsed time when paused
  const [elapsedOnPause, setElapsedOnPause] = useState(0);

  // Force a view refresh
  const [, setTick] = useState(0);
  const tickTimer = useRef<number | null>(null);

  // Long-press handling
  const pressing = useRef(false);
  const holdTimeout = useRef<number | null>(null);
  const ringTimer = useRef<number | null>(null);
  const [holdPct, setHoldPct] = useState(0);

  const pickStart = (r: any | null): number | null => {
    if (!r) return null;
    const raw = r.startMs ?? r.start_ms;
    let n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n)) return null;
    if (n < 1e11) n *= 1000;
    return n;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r0 = await window.api.getNowRunning();
      const s0 = pickStart(r0);
      if (s0 != null) setStartMs(s0);
      else {
        for (let i = 0; i < 12 && !cancelled; i++) {
          await new Promise((res) => setTimeout(res, 160));
          const r = await window.api.getNowRunning();
          const s = pickStart(r);
          if (s != null) {
            setStartMs(s);
            break;
          }
        }
      }
    })();
    tickTimer.current = window.setInterval(() => setTick((x) => x + 1), TICK_MS);
  window.hud?.enter(460, 100);
    return () => {
      cancelled = true;
      if (tickTimer.current) window.clearInterval(tickTimer.current);
      clearHold();
      window.hud?.leave();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") nav("/center/start");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav]);

  /* ---------------------- Timer controls (refactored) ---------------------- */

  // Compute current elapsed time
  const elapsed = startMs != null
      ? paused
        ? elapsedOnPause // If paused, time freezes at the moment of pause
        : elapsedOnPause + (Date.now() - startMs) // If running, paused duration + newly elapsed time
      : 0;


  function togglePause() {
    if (startMs == null && !paused) return; 

    setPaused(currentPaused => {
      if (currentPaused) {
        setStartMs(Date.now());
        return false;
      } else {
        setElapsedOnPause(elapsed);
        return true;
      }
    });
  }

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    clearHold();
    pressing.current = true;
    try { (e.currentTarget as any).setPointerCapture?.(e.pointerId); } catch {}

    const begin = Date.now();
    setHoldPct(0);

    ringTimer.current = window.setInterval(() => {
      const p = Math.min(1, (Date.now() - begin) / HOLD_MS);
      setHoldPct(p);
    }, 40);

    holdTimeout.current = window.setTimeout(async () => {
      if (!pressing.current) return;
      clearHold();
      await window.api.stopSession();
      setStartMs(null);
      setPaused(false);
      setElapsedOnPause(0);
      nav("/center/start");
    }, HOLD_MS);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    if (holdTimeout.current) {
      clearHold(e);
      togglePause();
    }
  }

  function clearHold(e?: React.PointerEvent) {
    pressing.current = false;
    if (holdTimeout.current) {
      window.clearTimeout(holdTimeout.current);
      holdTimeout.current = null;
    }
    if (ringTimer.current) {
      window.clearInterval(ringTimer.current);
      ringTimer.current = null;
    }
    setHoldPct(0);
    try { if (e?.pointerId) { (e?.currentTarget as any).releasePointerCapture?.(e!.pointerId); } } catch {}
  }

  /* ---------------------- UI ---------------------- */

  return (
    <div style={{ position: "relative", width: "100%", padding: 0 }}>
      {/**
      <button
        onClick={() => nav("/center/start")}
        title="back（Esc）"
        className="no-drag"
        style={{
          position: "fixed", top: 40, right: 10, width: 20, height: 20,
          display: "flex", alignItems: "center", justifyContent: "center",
          borderRadius: "50%", background: "rgba(0,0,0,.22)", color: "#fff",
          fontSize: 20, border: "1px solid rgba(255,255,255,.18)",
          boxShadow: "0 2px 8px rgba(0,0,0,0.10)", backdropFilter: "blur(6px)",
          cursor: "pointer", zIndex: 9999, WebkitAppRegion: "no-drag" as any,
        }}
      >
        <span style={{ fontSize: 11, lineHeight: 1 }}>⮌</span>
      </button>
      */}

      <div
        style={{
          display: "flex", alignItems: "center", flexDirection: "row",
          gap: 20, justifyContent: "center",
          width: "min(100%, 340px)",
          margin: "0px auto 0",
        }}
      >
        <div
          className="time-big"
          onDoubleClick={() => nav("/center/start")}
    title="Double-click to go back (Esc)"
          style={{ fontSize: 48, minWidth: 160, textAlign: "center" }}
        >
          {fmt(elapsed)}
        </div>

        <button
          onPointerDown={onPointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={(e) => clearHold(e)}
          onPointerLeave={(e) => clearHold(e)}
          title="Pause/Resume (short press), long press to stop"
          className="no-drag"
          style={{
            position: "relative", width: 48, height: 48, borderRadius: "50%",
            border: "none", background: paused ? "#10b981" : "var(--blue)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 2px 8px rgba(0,0,0,0.10)", fontSize: 28, color: "#fff",
            cursor: "pointer", outline: "none", transition: "background 0.2s",
          } as any}
        >
          {paused ? (
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
              <polygon points="6,4 18,11 6,18" fill="white" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
              <rect x="5" y="4" width="4" height="14" rx="2" fill="white" />
              <rect x="13" y="4" width="4" height="14" rx="2" fill="white" />
            </svg>
          )}

          {holdPct > 0 && (
            <div
              style={{
                position: "absolute", inset: 0, borderRadius: "50%",
                background: `conic-gradient(rgba(255,255,255,.7) ${holdPct * 360}deg, transparent 0deg)`,
                pointerEvents: "none",
              }}
            />
          )}
        </button>
      </div>
    </div>
  );
}
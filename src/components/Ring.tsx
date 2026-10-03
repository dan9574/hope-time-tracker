import type { ReactNode } from "react";
import { activityColorVar } from "../lib/activity";
import type { ActivityColor } from "../lib/bindings";
import "./Ring.css";

export interface RingSegment {
  key: string;
  startMs: number;
  endMs: number;
  color: ActivityColor | undefined;
}

interface RingProps {
  /** The waking window, mapped onto the 300° arc. */
  wakeMs: number;
  sleepMs: number;
  /** Logged time, drawn solid. */
  records: RingSegment[];
  /** Planned time, drawn at 40% under the records. */
  plans: RingSegment[];
  now: number;
  wakeLabel: string;
  sleepLabel: string;
  /** Shown in the middle of the ring. */
  children: ReactNode;
}

// Horseshoe ring (rebuild-plan 4.5): 300° arc, 60° gap at the bottom for sleep.
const DIAMETER = 248;
const STROKE = 10;
const ARC = 300;
const START = 180 + (360 - ARC) / 2; // lower-left end = wake; degrees clockwise from 12 o'clock
const LABEL_GAP = 14;

const R = DIAMETER / 2;
const PAD = STROKE / 2 + 4; // room for round caps and the now dot
const SIZE = DIAMETER + PAD * 2;
const C = SIZE / 2;
const HEIGHT = C + R * Math.cos((((360 - ARC) / 2) * Math.PI) / 180) + PAD + LABEL_GAP + 8;

function point(angle: number, radius = R) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: C + radius * Math.cos(rad), y: C + radius * Math.sin(rad) };
}

function arcPath(fromDeg: number, toDeg: number): string {
  const a = point(START + fromDeg);
  const b = point(START + toDeg);
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${R} ${R} 0 ${large} 1 ${b.x} ${b.y}`;
}

export function Ring({ wakeMs, sleepMs, records, plans, now, wakeLabel, sleepLabel, children }: RingProps) {
  const span = sleepMs - wakeMs;
  const deg = (ms: number) => ((Math.min(Math.max(ms, wakeMs), sleepMs) - wakeMs) / span) * ARC;
  const toArcs = (segments: RingSegment[]) =>
    segments
      .map((s) => ({ key: s.key, from: deg(s.startMs), to: deg(s.endMs), color: s.color }))
      .filter((a) => a.to > a.from);

  const nowDeg = deg(now);
  const nowPoint = point(START + nowDeg);
  const wakeEnd = point(START, R);
  const sleepEnd = point(START + ARC, R);

  return (
    <div className="ring" style={{ width: SIZE }}>
      <svg viewBox={`0 0 ${SIZE} ${HEIGHT}`} width={SIZE} height={HEIGHT} aria-hidden>
        {/* Track: elapsed part darker than the future part. */}
        <path className="ring-track-future" d={arcPath(0, ARC)} strokeWidth={STROKE} />
        {nowDeg > 0 && <path className="ring-track-past" d={arcPath(0, nowDeg)} strokeWidth={STROKE} />}
        {toArcs(plans).map((a) => (
          <path
            key={a.key}
            className="ring-plan"
            d={arcPath(a.from, a.to)}
            stroke={activityColorVar(a.color)}
            strokeWidth={STROKE}
          />
        ))}
        {toArcs(records).map((a) => (
          <path
            key={a.key}
            className="ring-record"
            d={arcPath(a.from, a.to)}
            stroke={activityColorVar(a.color)}
            strokeWidth={STROKE}
          />
        ))}
        {now >= wakeMs && now <= sleepMs && <circle className="ring-now" cx={nowPoint.x} cy={nowPoint.y} r={4} />}
        <text className="ring-end-label" x={wakeEnd.x} y={wakeEnd.y + STROKE / 2 + LABEL_GAP} textAnchor="middle">
          {wakeLabel}
        </text>
        <text className="ring-end-label" x={sleepEnd.x} y={sleepEnd.y + STROKE / 2 + LABEL_GAP} textAnchor="middle">
          {sleepLabel}
        </text>
      </svg>
      <div className="ring-center" style={{ top: C }}>
        {children}
      </div>
    </div>
  );
}

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
  diameter?: number;
  stroke?: number;
  /** End labels under the two tips; omitted on small rings. */
  wakeLabel?: string;
  sleepLabel?: string;
  /** Clicking an end label edits that day's wake-up / bedtime. */
  onWakeClick?: () => void;
  onSleepClick?: () => void;
  /** Parts of the ring spent asleep (late wake-up, early bedtime), drawn purple at 40%. */
  sleepSegments?: Array<{ startMs: number; endMs: number }>;
  /** After going to sleep, the gap at the bottom turns purple too. */
  slept?: boolean;
  /** Shown in the middle of the ring. */
  children?: ReactNode;
}

// Horseshoe ring (rebuild-plan 4.5): 300° arc, 60° gap at the bottom for sleep.
const ARC = 300;
const START = 180 + (360 - ARC) / 2; // lower-left tip = wake; degrees clockwise from 12 o'clock
const HALF_GAP_RAD = (((360 - ARC) / 2) * Math.PI) / 180;
const LABEL_GAP = 14;

export function Ring({
  wakeMs,
  sleepMs,
  records,
  plans,
  now,
  diameter = 248,
  stroke = 10,
  wakeLabel,
  sleepLabel,
  onWakeClick,
  onSleepClick,
  sleepSegments = [],
  slept = false,
  children,
}: RingProps) {
  const r = diameter / 2;
  const pad = stroke / 2 + 4; // room for round caps and the now dot
  const size = diameter + pad * 2;
  const c = size / 2;
  const hasLabels = wakeLabel !== undefined || sleepLabel !== undefined;
  const height = c + r * Math.cos(HALF_GAP_RAD) + pad + (hasLabels ? LABEL_GAP + 8 : 0);

  const point = (angle: number) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return { x: c + r * Math.cos(rad), y: c + r * Math.sin(rad) };
  };
  const arcPath = (fromDeg: number, toDeg: number) => {
    const a = point(START + fromDeg);
    const b = point(START + toDeg);
    const large = toDeg - fromDeg > 180 ? 1 : 0;
    return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
  };

  const span = sleepMs - wakeMs;
  const deg = (ms: number) => ((Math.min(Math.max(ms, wakeMs), sleepMs) - wakeMs) / span) * ARC;
  const toArcs = (segments: RingSegment[]) =>
    segments
      .map((s) => ({ key: s.key, from: deg(s.startMs), to: deg(s.endMs), color: s.color }))
      .filter((a) => a.to > a.from);

  const nowDeg = deg(now);
  const nowPoint = point(START + nowDeg);
  const wakeTip = point(START);
  const sleepTip = point(START + ARC);

  return (
    <div className="ring" style={{ width: size }}>
      <svg viewBox={`0 0 ${size} ${height}`} width={size} height={height} aria-hidden>
        {/* Track: elapsed part darker than the future part. */}
        <path className="ring-track-future" d={arcPath(0, ARC)} strokeWidth={stroke} />
        {nowDeg > 0 && <path className="ring-track-past" d={arcPath(0, nowDeg)} strokeWidth={stroke} />}
        {sleepSegments
          .map((s, i) => ({ key: i, from: deg(s.startMs), to: deg(s.endMs) }))
          .filter((a) => a.to > a.from)
          .map((a) => (
            <path key={`sleep-${a.key}`} className="ring-sleep" d={arcPath(a.from, a.to)} strokeWidth={stroke} />
          ))}
        {slept && <path className="ring-sleep" d={arcPath(ARC, 360)} strokeWidth={stroke} />}
        {toArcs(plans).map((a) => (
          <path key={a.key} className="ring-plan" d={arcPath(a.from, a.to)} stroke={activityColorVar(a.color)} strokeWidth={stroke} />
        ))}
        {toArcs(records).map((a) => (
          <path key={a.key} className="ring-record" d={arcPath(a.from, a.to)} stroke={activityColorVar(a.color)} strokeWidth={stroke} />
        ))}
        {now >= wakeMs && now <= sleepMs && (
          <circle className="ring-now" cx={nowPoint.x} cy={nowPoint.y} r={Math.max(stroke * 0.4, 3)} />
        )}
        {wakeLabel !== undefined && (
          <EndLabel x={wakeTip.x} y={wakeTip.y + stroke / 2 + LABEL_GAP} text={wakeLabel} onClick={onWakeClick} />
        )}
        {sleepLabel !== undefined && (
          <EndLabel x={sleepTip.x} y={sleepTip.y + stroke / 2 + LABEL_GAP} text={sleepLabel} onClick={onSleepClick} />
        )}
      </svg>
      {children && (
        <div className="ring-center" style={{ top: c }}>
          {children}
        </div>
      )}
    </div>
  );
}

function EndLabel({ x, y, text, onClick }: { x: number; y: number; text: string; onClick?: () => void }) {
  if (!onClick) {
    return (
      <text className="ring-end-label" x={x} y={y} textAnchor="middle">
        {text}
      </text>
    );
  }
  return (
    <text
      className="ring-end-label is-button"
      x={x}
      y={y}
      textAnchor="middle"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onClick()}
    >
      {text}
    </text>
  );
}

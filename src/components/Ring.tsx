import { useState, type ReactNode } from "react";
import { activityColorVar } from "../lib/activity";
import type { ActivityColor } from "../lib/bindings";
import { bead, layoutSegments, type Bead, type DrawnSegment } from "../lib/ringGeometry";
import { hoverStateOf } from "../lib/useHover";
import { useUi } from "../stores/ui";
import "./Ring.css";

export interface RingSegment {
  key: string;
  /** Hover group: every segment with the same group lights up together (a record with pauses). */
  group: string;
  /**
   * Top-level activity. Neighbouring records with the same merge key at most two minutes apart in
   * time are drawn as one capsule (rebuild-plan 11.3). Omitted = never merged.
   */
  mergeKey?: string;
  startMs: number;
  endMs: number;
  color: ActivityColor | undefined;
  /** Shown when the pointer is on this segment, e.g. "Study · 9:00–10:30 · 1 h 30 min". */
  tooltip?: string;
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
  /** Thickness of the ring (the "ring width" setting). Records are coloured stretches of the ring itself, so they share it. */
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
  /** Segments react to the pointer and share the hover key with lists (rebuild-plan 11.2). */
  interactive?: boolean;
  /** Shown in the middle of the ring. */
  children?: ReactNode;
}

// Horseshoe ring (rebuild-plan 4.5): 300° arc, 60° gap at the bottom for sleep.
const ARC = 300;
const START = 180 + (360 - ARC) / 2; // lower-left tip = wake; degrees clockwise from 12 o'clock
const HALF_GAP_RAD = (((360 - ARC) / 2) * Math.PI) / 180;
const LABEL_GAP = 14;
// rebuild-plan 11.3: a hit area 6px wider than the visible stroke.
const HIT_EXTRA_PX = 6;
// Hover widens a bead by 3px, outward only.
const HOVER_EXTRA_PX = 3;
const NOW_STROKE_PX = 2;

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
  interactive = false,
  children,
}: RingProps) {
  const hoverKey = useUi((s) => s.hoverKey);
  const hoverAlso = useUi((s) => s.hoverAlso);
  const setHoverKey = useUi((s) => s.setHoverKey);
  // Only the pointer on the ring itself shows a label; hovering the list just highlights.
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);

  const r = diameter / 2;
  // Room for a hovered bead (outer edge at r + stroke/2 + 3) and the now marker (r + stroke/2 + 2).
  const pad = stroke / 2 + 4 + (interactive ? HOVER_EXTRA_PX : 0);
  const size = diameter + pad * 2;
  const c = size / 2;
  const hasLabels = wakeLabel !== undefined || sleepLabel !== undefined;
  const height = c + r * Math.cos(HALF_GAP_RAD) + pad + (hasLabels ? LABEL_GAP + 8 : 0);
  const arcPx = (ARC * Math.PI * r) / 180;
  const degPerPx = ARC / arcPx;

  const point = (angle: number, radius = r) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return { x: c + radius * Math.cos(rad), y: c + radius * Math.sin(rad) };
  };
  const arcPath = (fromDeg: number, toDeg: number, radius = r) => {
    const a = point(START + fromDeg, radius);
    const b = point(START + toDeg, radius);
    const large = toDeg - fromDeg > 180 ? 1 : 0;
    return `M ${a.x} ${a.y} A ${radius} ${radius} 0 ${large} 1 ${b.x} ${b.y}`;
  };
  const pxPoint = (px: number, radius = r) => point(START + px * degPerPx, radius);

  const span = sleepMs - wakeMs;
  const toPx = (ms: number) => ((Math.min(Math.max(ms, wakeMs), sleepMs) - wakeMs) / span) * arcPx;

  /** One bead as SVG: a round-capped arc or a circle. */
  const shapeEl = (b: Bead, width: number, className: string, color?: string, radius = r) => {
    if (b.kind === "dot") {
      const p = pxPoint(b.at, radius);
      return <circle className={className} cx={p.x} cy={p.y} r={width / 2} fill={color} />;
    }
    return (
      <path
        className={className}
        d={arcPath(b.from * degPerPx, b.to * degPerPx, radius)}
        stroke={color}
        strokeWidth={width}
      />
    );
  };

  /**
   * The hovered bead: 3px thicker, outward only. Its path ends move in by the extra half-width so
   * the caps still end on the true times.
   */
  const hovered = (b: Bead): Bead => {
    if (b.kind === "dot") return b;
    const from = b.from + HOVER_EXTRA_PX / 2;
    const to = b.to - HOVER_EXTRA_PX / 2;
    return to > from ? { kind: "capsule", from, to } : { kind: "dot", at: (b.from + b.to) / 2 };
  };

  const drawSegment = (s: DrawnSegment, className: string) => {
    const b = bead(s.startPx, s.endPx, stroke, arcPx);
    const hover = hoverStateOf(hoverKey, hoverAlso, s.groups);
    const on = hover === "on";
    const color = activityColorVar(s.color);
    const mid = b.kind === "dot" ? b.at : (b.from + b.to) / 2;
    const enter = () => {
      setHoverKey(s.groups[0] ?? null, s.groups);
      if (s.tooltip) {
        const p = pxPoint(mid, r + stroke / 2 + HOVER_EXTRA_PX + 4);
        setTooltip({ text: s.tooltip, x: p.x, y: p.y });
      }
    };
    const leave = () => {
      setHoverKey(null);
      setTooltip(null);
    };
    return (
      <g key={s.key} className={className} data-hover={hover}>
        {on
          ? shapeEl(hovered(b), stroke + HOVER_EXTRA_PX, "ring-segment", color, r + HOVER_EXTRA_PX / 2)
          : shapeEl(b, stroke, "ring-segment", color)}
        {interactive && (
          <g tabIndex={0} className="ring-hit" onMouseEnter={enter} onMouseLeave={leave} onFocus={enter} onBlur={leave}>
            {shapeEl(b, stroke + HIT_EXTRA_PX, "ring-hit-shape")}
          </g>
        )}
      </g>
    );
  };

  const recordShapes = layoutSegments(records, toPx, arcPx, true);
  const planShapes = layoutSegments(plans, toPx, arcPx, false);

  const nowPx = toPx(now);
  const nowDeg = nowPx * degPerPx;
  const nowPoint = point(START + nowDeg);
  const wakeTip = point(START);
  const sleepTip = point(START + ARC);

  return (
    <div className="ring" style={{ width: size }}>
      <svg viewBox={`0 0 ${size} ${height}`} width={size} height={height} aria-hidden={!interactive}>
        {/* Thin track: elapsed part darker than the future part. */}
        <path className="ring-track-future" d={arcPath(0, ARC)} strokeWidth={stroke} />
        {nowDeg > 0 && <path className="ring-track-past" d={arcPath(0, nowDeg)} strokeWidth={stroke} />}
        {/* After sleep the bottom gap closes the track in purple, at track width. */}
        {slept && <path className="ring-sleep-gap" d={arcPath(ARC, 360)} strokeWidth={stroke} />}
        {sleepSegments.map((s, i) => {
          const startPx = toPx(s.startMs);
          const endPx = toPx(s.endMs);
          if (endPx <= startPx) return null;
          return (
            <g key={`sleep-${i}`} className="ring-sleep">
              {shapeEl(bead(startPx, endPx, stroke, arcPx), stroke, "ring-sleep-shape")}
            </g>
          );
        })}
        {planShapes.map((s) => drawSegment(s, "ring-plan"))}
        {recordShapes.map((s) => drawSegment(s, "ring-record"))}
        {now >= wakeMs && now <= sleepMs && (
          <circle
            className="ring-now"
            cx={nowPoint.x}
            cy={nowPoint.y}
            r={stroke / 2 + 1}
            strokeWidth={NOW_STROKE_PX}
          />
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
      {tooltip && (
        <span className="chart-tooltip ring-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          {tooltip.text}
        </span>
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

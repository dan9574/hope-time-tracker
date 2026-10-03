import type { ActivityColor } from "./bindings";
import type { RingSegment } from "../components/Ring";

// Pure geometry for the Today ring (rebuild-plan 11.3): records sit on a thin track as
// round-capped capsules, or as dots when too short. All lengths are px along the arc's centre line.

/** Visible gap between neighbouring beads. */
const SEGMENT_GAP_PX = 2;

/**
 * A drawn shape, in px measured along the centre line from the wake tip.
 * `capsule`: a path from `from` to `to` whose round caps add half a stroke at each end.
 * `dot`: a circle (diameter = stroke) centred at `at`.
 */
export type Bead = { kind: "capsule"; from: number; to: number } | { kind: "dot"; at: number };

/**
 * Data span (px along the arc) → shape. Each end is pulled in by half a stroke so the cap's outer
 * edge lands on the true time, plus half the visible gap. Anything shorter than that becomes a dot
 * centred on its midpoint, kept inside the arc.
 */
export function bead(startPx: number, endPx: number, width: number, arcPx: number): Bead {
  const inset = width / 2 + SEGMENT_GAP_PX / 2;
  const from = startPx + inset;
  const to = endPx - inset;
  if (to > from) return { kind: "capsule", from, to };
  const lo = Math.min(inset, arcPx / 2);
  return { kind: "dot", at: Math.min(Math.max((startPx + endPx) / 2, lo), arcPx - lo) };
}

/** A capsule (or dot) after merging neighbours of one activity, with every hover group it stands for. */
export interface DrawnSegment {
  key: string;
  groups: string[];
  startPx: number;
  endPx: number;
  color: ActivityColor | undefined;
  tooltip?: string;
}

/**
 * Segments in px, clipped to the arc. With `merge`, consecutive segments sharing a merge key whose
 * on-screen gap is below one stroke width become one capsule; the data itself is untouched.
 */
export function layoutSegments(
  segments: RingSegment[],
  toPx: (ms: number) => number,
  arcPx: number,
  width: number,
  merge: boolean,
): DrawnSegment[] {
  const out: Array<DrawnSegment & { mergeKey?: string; tips: string[] }> = [];
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs);
  for (const s of sorted) {
    const startPx = toPx(s.startMs);
    const endPx = toPx(s.endMs);
    if (endPx <= 0 || startPx >= arcPx || endPx <= startPx) continue;
    const last = out[out.length - 1];
    if (merge && last && s.mergeKey !== undefined && last.mergeKey === s.mergeKey && startPx - last.endPx < width) {
      last.endPx = Math.max(last.endPx, endPx);
      if (!last.groups.includes(s.group)) last.groups.push(s.group);
      if (s.tooltip && !last.tips.includes(s.tooltip)) last.tips.push(s.tooltip);
      continue;
    }
    out.push({
      key: s.key,
      groups: [s.group],
      mergeKey: s.mergeKey,
      startPx,
      endPx,
      color: s.color,
      tips: s.tooltip ? [s.tooltip] : [],
    });
  }
  return out.map(({ tips, mergeKey: _mergeKey, ...d }) => ({ ...d, tooltip: tips.length > 0 ? tips.join("\n") : undefined }));
}

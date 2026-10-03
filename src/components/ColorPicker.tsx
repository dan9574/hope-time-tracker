import { Check } from "lucide-react";
import { activityColorVar } from "../lib/activity";
import type { ActivityColor } from "../lib/bindings";
import "./ColorPicker.css";

export const PALETTE: ActivityColor[] = ["blue", "green", "orange", "pink", "purple", "teal", "yellow", "gray"];

interface Props {
  value: ActivityColor;
  onChange: (color: ActivityColor) => void;
  label: string;
}

/** The fixed 8-color palette (rebuild-plan 4.3); no free color picking. */
export function ColorPicker({ value, onChange, label }: Props) {
  return (
    <div className="color-picker" role="radiogroup" aria-label={label}>
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c === value}
          aria-label={c}
          className="color-swatch"
          style={{ background: activityColorVar(c) }}
          onClick={() => onChange(c)}
        >
          {c === value && <Check size={12} strokeWidth={3} aria-hidden />}
        </button>
      ))}
    </div>
  );
}

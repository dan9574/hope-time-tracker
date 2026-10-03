import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import "./PeriodNav.css";

interface Props {
  offset: number;
  onChange: (offset: number) => void;
  /** Label of the button that jumps back to the current period. */
  currentLabel: string;
}

/** ‹ › to browse past weeks/months; the future is not reachable. */
export function PeriodNav({ offset, onChange, currentLabel }: Props) {
  const { t } = useTranslation();
  return (
    <div className="period-nav">
      {offset < 0 && (
        <button type="button" className="period-nav-current" onClick={() => onChange(0)}>
          {currentLabel}
        </button>
      )}
      <button type="button" className="period-nav-step" aria-label={t("period.previous")} onClick={() => onChange(offset - 1)}>
        <ChevronLeft size={16} strokeWidth={2} aria-hidden />
      </button>
      <button
        type="button"
        className="period-nav-step"
        aria-label={t("period.next")}
        disabled={offset >= 0}
        onClick={() => onChange(offset + 1)}
      >
        <ChevronRight size={16} strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}

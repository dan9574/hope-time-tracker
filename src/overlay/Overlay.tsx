import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands, events } from "../lib/bindings";
import { useQuery, useSetting } from "../lib/data";
import { useNow } from "../lib/useNow";
import { useLocalePreference } from "../lib/preferences";
import { useToday } from "../lib/useToday";
import { NowCard } from "./NowCard";
import { TodayCard } from "./TodayCard";
import { WeekCard } from "./WeekCard";
import { OVERLAY_CARDS, OVERLAY_OPACITY, parseCards, parseOpacity } from "./settings";
import "./Overlay.css";

export function Overlay() {
  const { t } = useTranslation();
  const cards = parseCards(useSetting(OVERLAY_CARDS));
  const opacity = parseOpacity(useSetting(OVERLAY_OPACITY));
  const editing = useEditing();
  useLocalePreference();

  const timer = useQuery(() => commands.sessionCurrent(), []);
  const now = useNow(timer?.running ? 1000 : 30_000);
  const today = useToday(now);

  const stackRef = useRef<HTMLDivElement>(null);
  useCardBackdrops(stackRef);

  return (
    <main className="overlay" style={{ opacity }}>
      <div ref={stackRef} className={editing ? "overlay-stack is-editing" : "overlay-stack"}>
        {cards.has("now") && <NowCard timer={timer} activities={today.activities} todayMs={today.summary.totalMs} now={now} />}
        {cards.has("today") && <TodayCard today={today} now={now} />}
        {cards.has("week") && <WeekCard now={now} activities={today.activities} />}
        {editing && <p className="overlay-hint">{t("overlay.dragHint")}</p>}
      </div>
      {/* While editing, the whole window is a drag handle. */}
      {editing && <div className="overlay-drag" data-tauri-drag-region />}
    </main>
  );
}

function useEditing(): boolean {
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const unlisten = events.overlayEditing.listen((e) => setEditing(e.payload));
    return () => void unlisten.then((f) => f());
  }, []);
  return editing;
}

/**
 * Tells Rust where each card is so it can place a blurred native backdrop under it.
 * Re-measures whenever a card can move, resize, appear or disappear; unchanged frames are not resent.
 */
function useCardBackdrops(stackRef: React.RefObject<HTMLDivElement>) {
  const last = useRef("");
  const report = useCallback(() => {
    const stack = stackRef.current;
    if (!stack) return;
    const frames = [...stack.querySelectorAll<HTMLElement>(".overlay-card")].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    });
    const key = JSON.stringify(frames);
    if (key === last.current) return;
    last.current = key;
    void commands.overlayLayout(frames);
  }, [stackRef]);

  // After every render: cards toggled, data changed, the edit hint appeared.
  useLayoutEffect(report);

  // Between renders: text/font size changes, cards mounting or unmounting, the window resizing
  // (which re-centers the stack without changing its size).
  useEffect(() => {
    const stack = stackRef.current;
    if (!stack) return;
    const resize = new ResizeObserver(report);
    const observeCards = () => {
      resize.disconnect();
      resize.observe(stack);
      stack.querySelectorAll(".overlay-card").forEach((el) => resize.observe(el));
    };
    observeCards();
    const mutation = new MutationObserver(() => {
      observeCards();
      report();
    });
    mutation.observe(stack, { childList: true });
    window.addEventListener("resize", report);
    return () => {
      resize.disconnect();
      mutation.disconnect();
      window.removeEventListener("resize", report);
    };
  }, [stackRef, report]);
}

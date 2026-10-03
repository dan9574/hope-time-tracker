import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands, events } from "../lib/bindings";
import { useQuery, useSetting } from "../lib/data";
import { useNow } from "../lib/useNow";
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

/** Tells Rust where each card is so it can place a blurred native backdrop under it. */
function useCardBackdrops(stackRef: React.RefObject<HTMLDivElement>) {
  const last = useRef("");
  useLayoutEffect(() => {
    const stack = stackRef.current;
    if (!stack) return;
    const report = () => {
      const frames = [...stack.querySelectorAll<HTMLElement>(".overlay-card")].map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height };
      });
      const key = JSON.stringify(frames);
      if (key === last.current) return;
      last.current = key;
      void commands.overlayLayout(frames);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(stack);
    stack.querySelectorAll(".overlay-card").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  });
}

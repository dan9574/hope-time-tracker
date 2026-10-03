import { useEffect, useState } from "react";
import type { Activity } from "./bindings";

/**
 * Live HTML5 drag reordering for one list of siblings; `onCommit` gets the new id order on drop.
 * Each list keeps its own state, so dragging a child never reorders top-level rows and vice versa.
 */
export function useDragOrder(items: Activity[], onCommit: (ids: string[]) => void) {
  const [order, setOrder] = useState(items);
  const [dragging, setDragging] = useState<string | null>(null);
  // Depend on content, not array identity, so refetches during a drag do not reset it.
  const key = items.map((a) => `${a.id}:${a.name}:${a.color}:${a.symbol}:${a.parent_id}`).join("|");
  useEffect(() => setOrder(items), [key]);

  return {
    items: order,
    dragging,
    start: (e: React.DragEvent, id: string) => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
      setDragging(id);
    },
    over: (id: string) => {
      if (!dragging || dragging === id || !order.some((a) => a.id === id)) return;
      setOrder((prev) => {
        const from = prev.findIndex((a) => a.id === dragging);
        const to = prev.findIndex((a) => a.id === id);
        const next = [...prev];
        next.splice(to, 0, ...next.splice(from, 1));
        return next;
      });
    },
    end: (e: React.DragEvent) => {
      e.stopPropagation();
      if (!dragging) return;
      setDragging(null);
      const ids = order.map((a) => a.id);
      if (ids.join() !== items.map((a) => a.id).join()) onCommit(ids);
    },
  };
}

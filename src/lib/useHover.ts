import { useUi } from "../stores/ui";

/** Props that make an element drive the shared hover key; focus counts as hover. */
export function hoverProps(key: string) {
  const set = useUi.getState().setHoverKey;
  return {
    onMouseEnter: () => set(key),
    onMouseLeave: () => set(null),
    onFocus: () => set(key),
    onBlur: () => set(null),
  };
}

/**
 * `"on"` when the hovered key (or a key lit along with it) is one of `keys`, `"off"` for everything
 * else while something is hovered.
 */
export function hoverStateOf(hoverKey: string | null, hoverAlso: string[], keys: string[]): "on" | "off" | undefined {
  if (hoverKey === null) return undefined;
  return keys.some((k) => k === hoverKey || hoverAlso.includes(k)) ? "on" : "off";
}

/** Hover state of an element standing for `key`. */
export function useHoverState(key: string): "on" | "off" | undefined {
  const hoverKey = useUi((s) => s.hoverKey);
  const hoverAlso = useUi((s) => s.hoverAlso);
  return hoverStateOf(hoverKey, hoverAlso, [key]);
}

import { useEffect, useState, useSyncExternalStore } from "react";
import { commands, events } from "./bindings";

type Result<T> = { status: "ok"; data: T } | { status: "error"; error: string };

// Bumped whenever Rust reports a data change (from a command or the tray).
let version = 0;
const listeners = new Set<() => void>();
void events.dataChanged.listen(() => {
  version += 1;
  listeners.forEach((l) => l());
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDataVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}

/**
 * Fetch from a Rust command and refetch when `deps` change or data changes anywhere.
 * Keeps the previous value while refetching so views don't flicker.
 */
export function useQuery<T>(fetcher: () => Promise<Result<T>>, deps: unknown[]): T | undefined {
  const dataVersion = useDataVersion();
  const [data, setData] = useState<T>();

  useEffect(() => {
    let cancelled = false;
    fetcher().then((res) => {
      if (cancelled) return;
      if (res.status === "ok") setData(res.data);
      else console.error(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [dataVersion, ...deps]);

  return data;
}

/** Report a failed command; mutations refresh views through the DataChanged event. */
export async function run<T>(promise: Promise<Result<T>>): Promise<T | undefined> {
  const res = await promise;
  if (res.status === "ok") return res.data;
  console.error(res.error);
  return undefined;
}

/** A local setting that re-reads whenever it is written from any window. */
export function useSetting(key: string): string | null | undefined {
  const [value, setValue] = useState<string | null>();
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      commands.settingGet(key).then((res) => {
        if (!cancelled && res.status === "ok") setValue(res.data);
      });
    void load();
    const unlisten = events.settingChanged.listen((e) => {
      if (e.payload.key === key) void load();
    });
    return () => {
      cancelled = true;
      void unlisten.then((f) => f());
    };
  }, [key]);
  return value;
}

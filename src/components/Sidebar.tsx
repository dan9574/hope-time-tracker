// src/components/Sidebar.tsx
import { Link, useLocation, matchPath } from "react-router-dom";
import { useEffect, useState } from "react";
import "./Sidebar.css";

function Slot({ to, label, active }: { to: string; label: string; active: boolean }) {
  return (
    <Link to={to} className={`slot${active ? " active" : ""}`} draggable={false}>
      {label}
    </Link>
  );
}

export default function Sidebar() {
  const { pathname } = useLocation();
  const [devMode, setDevMode] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const s = await (window.api as any).getSettings();
        setDevMode(!!s?.devMode);
      } catch {}
    })();
  }, []);

  // Explicit matches: ensure /center/day/* and the brief moment when /center/day redirects are handled
  const isDay =
    !!matchPath({ path: "/center/day/*", end: false }, pathname) || pathname === "/center/day";
  const isMonth = !!matchPath({ path: "/center/month*", end: false }, pathname);
  const isSettings = !!matchPath({ path: "/center/settings*", end: false }, pathname);
  const isStart = !!matchPath({ path: "/center/start*", end: false }, pathname);
  const isDev = !!matchPath({ path: "/center/dev*", end: false }, pathname);

  return (
    <aside className="sidebar-slab">
      <div className="sidebar-slots">
  <Slot to="/center/day" label="Daily" active={isDay} />
  <Slot to="/center/month" label="Monthly" active={isMonth} />
  <Slot to="/center/settings" label="Settings" active={isSettings} />
  <Slot to="/center/start" label="Start" active={isStart} />
  {devMode && <Slot to="/center/dev" label="Developer" active={isDev} />}
      </div>
    </aside>
  );
}

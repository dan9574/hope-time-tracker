// src/App.tsx
import { Routes, Route, Navigate, Outlet, useLocation, matchPath } from "react-router-dom";
import { useEffect, useState } from "react";
import dayjs from "dayjs";

import Sidebar from "./components/Sidebar";
import TitleBar from "./components/TitleBar";
import StartCenter from "./pages/StartCenter";
import StatsMonth from "./pages/StatsMonth";
import Settings from "./pages/Settings";
import Developer from "./pages/Developer";
import RunHUD from "./pages/RunHUD";
import StatsDay from "./pages/StatsDay";

import "./App.css"; // ⬅️ 布局样式（下面第 3 部分）

function AmbientIn() {
  return (
    <div className="ambient-in">
      <i className="blob b1" /><i className="blob b2" /><i className="blob b3" />
      <i className="blob b4" /><i className="blob b5" /><i className="blob b6" />
    </div>
  );
}

function CenterLayout() {
  const location = useLocation();
  // 判断当前是否为 StatsDay 页面
  const isStatsDay = !!matchPath({ path: "/center/day/:isoDate", end: true }, location.pathname);
  return (
    <div className="viewport">
      <div className="window">
        <AmbientIn />
        <div className={"ambient-mask" + (isStatsDay ? " statsday" : "")} />
        <TitleBar />
        <div className="shell-center nodrag">
          <Sidebar />
          <main className="center-content">
            <div className="center-body">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

function HudLayout({ isWallpaperMode }: { isWallpaperMode: boolean }) {
  return (
    <div className="viewport">
      <div className="window glass">
        {!isWallpaperMode && (
          <>
            <AmbientIn />
            <div className="ambient-mask" />
          </>
        )}
        <TitleBar glass />
        <div className="hud-inner nodrag">
          <RunHUD />
        </div>
      </div>
    </div>
  );
}

function DayIndexRedirect() {
  const today = dayjs().format("YYYY-MM-DD");
  return <Navigate to={`/center/day/${today}`} replace />;
}

export default function App() {
  const [isWallpaperMode, setIsWallpaperMode] = useState(false);

  useEffect(() => {
    (async () => {
      const settings: any = await window.api.getSettings();
      setIsWallpaperMode(!!settings?.isOpaque);
    })();
  }, []);

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/center/start" replace />} />

      <Route path="/center" element={<CenterLayout />}>
        <Route path="start" element={<StartCenter />} />
        <Route path="month" element={<StatsMonth />} />
        <Route
          path="settings"
          element={<Settings isWallpaperMode={isWallpaperMode} setIsWallpaperMode={setIsWallpaperMode} />}
        />
        <Route path="dev" element={<Developer />} />
  {/* Grouped entry + dynamic date */}
        <Route path="day" element={<DayIndexRedirect />} />
        <Route path="day/:isoDate" element={<StatsDay />} />
      </Route>

      <Route path="/hud" element={<HudLayout isWallpaperMode={isWallpaperMode} />} />
    </Routes>
  );
}

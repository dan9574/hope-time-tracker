import { useEffect, useState } from "react";

export default function TitleBar({ glass = false }: { glass?: boolean }) {
  const [maxed, setMaxed] = useState(false);

  useEffect(() => {
    (async () => setMaxed(await (window.api as any).window.isMaximized()))();
  }, []);

  return (
    <div className={`titlebar ${glass ? "glass" : ""}`}>
      <div className="title">Hope</div>
      <div className="win-controls">
        <button
          className="win-btn nodrag"
          onClick={() => (window.api as any).window.minimize()}
          title="Minimize"
        >
          —
        </button>

        <button
          className="win-btn nodrag"
          onClick={async () => {
            const m = await (window.api as any).window.toggleMaximize();
            setMaxed(m);
          }}
          title={maxed ? "Restore" : "Maximize"}
        >
          {maxed ? "▭" : "□"}
        </button>

        <button
          className="win-btn close nodrag"
          onClick={() => (window.api as any).window.close()}
          title="Close"
        >
          ×
        </button>
      </div>
    </div>
  );
}

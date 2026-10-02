import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/base.css";
import "./lib/i18n";
import { App } from "./app/App";

document.documentElement.dataset.platform = navigator.userAgent.includes("Mac") ? "mac" : "other";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

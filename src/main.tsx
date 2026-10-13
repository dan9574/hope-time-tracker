import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/base.css";
import "./lib/i18n";
import { App } from "./app/App";
import { applyPlatform } from "./lib/platform";

applyPlatform();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

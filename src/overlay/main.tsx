import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/tokens.css";
import "../styles/base.css";
import "../lib/i18n";
import { applyPlatform } from "../lib/platform";
import { Overlay } from "./Overlay";

applyPlatform();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Overlay />
  </StrictMode>,
);

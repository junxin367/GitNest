import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@gitnest/design-system/tokens.css";
import "./shared/ui/primitives.css";
import "./app/styles/global.css";
import "./pages/diff-viewer/diff-viewer.css";
import "./widgets/diff-workspace/diff-workspace.css";

import { App } from "./app/App";
import { DiffViewerApp } from "./pages/diff-viewer/DiffViewerApp";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("GitNest renderer root was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    {new URLSearchParams(window.location.search).get("view") ===
    "diff" ? (
      <DiffViewerApp />
    ) : (
      <App />
    )}
  </StrictMode>
);

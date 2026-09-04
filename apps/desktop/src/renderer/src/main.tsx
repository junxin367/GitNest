import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@gitnest/design-system/tokens.css";
import "./app/styles/global.css";

import { App } from "./app/App";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("GitNest renderer root was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);

/// <reference lib="dom" />

import { ipcRenderer } from "electron";
import { TRAY_MENU_IPC } from "@gitnest/contracts";

window.addEventListener("DOMContentLoaded", () => {
  const items = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-tray-action]")
  );
  for (const item of items) {
    item.addEventListener("click", () => {
      const action = item.dataset.trayAction;
      if (action === "show" || action === "quit") {
        ipcRenderer.send(TRAY_MENU_IPC.action, action);
      }
    });
  }
  document.addEventListener("contextmenu", (event) => event.preventDefault());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      ipcRenderer.send(TRAY_MENU_IPC.action, "dismiss");
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End", "Tab"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const current = items.findIndex((item) => item === document.activeElement);
    const backwards = event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
      : (current + (backwards ? -1 : 1) + items.length) % items.length;
    items[next]?.focus();
  });
  const applyTheme = (dark: boolean) => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  };
  ipcRenderer.on(TRAY_MENU_IPC.theme, (_event, dark: boolean) => applyTheme(dark));
  ipcRenderer.on(TRAY_MENU_IPC.shown, (_event, dark: boolean) => {
    applyTheme(dark);
    items[0]?.focus();
  });
  ipcRenderer.send(TRAY_MENU_IPC.ready);
});

import {
  BaseWindow,
  ipcMain,
  nativeTheme,
  screen,
  WebContentsView,
  type IpcMainEvent,
  type Point,
  type Rectangle
} from "electron";
import { TRAY_MENU_IPC } from "@gitnest/contracts";

import type { RotatingDiagnosticLogger } from "../adapters/diagnostic-logger.adapter";
import designTokens from "../../../../../packages/design-system/src/tokens/tokens.css?raw";
import menuHtml from "./tray-menu.html?raw";

interface TrayMenuOptions {
  preloadPath: string;
  diagnostics?: Pick<RotatingDiagnosticLogger, "info" | "warning">;
  quitApplication(): void;
  showMainWindow(): void;
}

const TRAY_MENU_WIDTH = 144;
const TRAY_MENU_HEIGHT = 83;
const TRAY_MENU_CURSOR_OFFSET = 4;
const TRAY_MENU_PARKING_GAP = 100;
const TRAY_MENU_OPENING_MS = 400;

export function getTrayMenuBounds(point: Point, workArea: Rectangle): Rectangle {
  const width = Math.min(TRAY_MENU_WIDTH, workArea.width);
  const height = Math.min(TRAY_MENU_HEIGHT, workArea.height);
  return {
    x: Math.round(Math.max(
      workArea.x,
      Math.min(point.x + TRAY_MENU_CURSOR_OFFSET, workArea.x + workArea.width - width)
    )),
    y: Math.round(Math.max(workArea.y, Math.min(point.y, workArea.y + workArea.height - height))),
    width,
    height
  };
}

// Hiding this transparent window drops its composited frame: the next show()
// stays blank for about 200 ms on Windows and can flash a stale frame first.
// A closed menu therefore stays shown, parked above every display.
export function getTrayMenuParkingBounds(anchor: Rectangle, displays: Rectangle[]): Rectangle {
  const top = Math.min(anchor.y, ...displays.map((display) => display.y));
  return {
    x: Math.round(anchor.x),
    y: Math.round(top - anchor.height - TRAY_MENU_PARKING_GAP),
    width: anchor.width,
    height: anchor.height
  };
}

export function createTrayMenu({
  preloadPath,
  diagnostics,
  quitApplication,
  showMainWindow
}: TrayMenuOptions) {
  const backgroundColor = "#00000000";
  // BaseWindow keeps this popup out of BrowserWindow.getAllWindows(), so it
  // does not receive workspace broadcasts or become the app's main window.
  const window = new BaseWindow({
    width: TRAY_MENU_WIDTH,
    height: TRAY_MENU_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    thickFrame: false,
    hasShadow: false,
    roundedCorners: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // WS_EX_TOOLWINDOW keeps the parked menu out of Alt+Tab and Task View.
    type: "toolbar",
    backgroundColor,
    title: "GitNest 托盘菜单"
  });
  const view = new WebContentsView({
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      backgroundThrottling: false,
      devTools: false
    }
  });
  window.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: TRAY_MENU_WIDTH, height: TRAY_MENU_HEIGHT });
  view.setBackgroundColor(backgroundColor);

  let ready = false;
  let disposed = false;
  let visible = false;
  let sequence = 0;
  let pending: {
    point: Point;
    triggerBounds: Rectangle;
    requestedAt: number;
    requestId: number;
  } | undefined;
  let focusCheck: ReturnType<typeof setInterval> | undefined;
  let focusActivation: ReturnType<typeof setTimeout> | undefined;
  let pendingClose: ReturnType<typeof setTimeout> | undefined;
  let focusAcquired = false;
  let openingUntil = 0;
  let triggerBounds: Rectangle | undefined;
  let anchor: Rectangle | undefined;
  const trace = (event: string, context: Record<string, unknown> = {}) => {
    void diagnostics?.info(event, context).catch(() => undefined);
  };
  const park = () => {
    if (disposed || window.isDestroyed()) {
      return;
    }
    const displays = screen.getAllDisplays();
    if (!anchor) {
      const workArea = screen.getPrimaryDisplay().workArea;
      anchor = {
        x: workArea.x + workArea.width - TRAY_MENU_WIDTH,
        y: workArea.y + workArea.height - TRAY_MENU_HEIGHT,
        width: TRAY_MENU_WIDTH,
        height: TRAY_MENU_HEIGHT
      };
    }
    window.setBounds(
      getTrayMenuParkingBounds(anchor, displays.map((display) => display.bounds)),
      false
    );
  };
  const arm = () => {
    park();
    if (!disposed && !window.isDestroyed() && !window.isVisible()) {
      window.showInactive();
    }
  };
  const cancelPendingClose = () => {
    if (pendingClose) {
      clearTimeout(pendingClose);
      pendingClose = undefined;
    }
  };
  const stopFocusCheck = () => {
    cancelPendingClose();
    if (focusActivation) {
      clearTimeout(focusActivation);
      focusActivation = undefined;
    }
    if (focusCheck) {
      clearInterval(focusCheck);
      focusCheck = undefined;
    }
    focusAcquired = false;
    openingUntil = 0;
  };
  const hide = (reason: string) => {
    pending = undefined;
    stopFocusCheck();
    if (disposed || window.isDestroyed() || !visible) {
      return;
    }
    visible = false;
    // Never hide() here, even when Esc closes a focused menu: focus stays with
    // the parked window, as it does with a native tray menu's hidden owner,
    // and onAction ignores input while the menu is closed.
    arm();
    trace("tray.menu-closed", { requestId: sequence, reason });
  };
  const pointerWithin = (bounds: Rectangle) => {
    const point = screen.getCursorScreenPoint();
    return point.x >= bounds.x && point.x < bounds.x + bounds.width &&
      point.y >= bounds.y && point.y < bounds.y + bounds.height;
  };
  // Explorer takes focus while our own tray icon is pressed (the opening
  // click's release, a long press, or another click). The tray click handlers
  // decide what happens next, so focus loss there is not an outside dismissal.
  const isOpeningInteraction = () =>
    Boolean(triggerBounds && pointerWithin(triggerBounds)) ||
    (Date.now() < openingUntil && pointerWithin(window.getBounds()));
  const scheduleFocus = () => {
    if (focusActivation) {
      return;
    }
    // Let the native tray notification finish before asking for focus again.
    focusActivation = setTimeout(() => {
      focusActivation = undefined;
      if (disposed || !visible || window.isDestroyed() || window.isFocused() ||
        !isOpeningInteraction()) {
        return;
      }
      window.focus();
      view.webContents.focus();
      focusAcquired ||= window.isFocused();
    }, 0);
  };
  const checkFocus = () => {
    if (disposed || !visible || window.isDestroyed()) {
      return;
    }
    if (window.isFocused()) {
      focusAcquired = true;
      cancelPendingClose();
      return;
    }
    if (isOpeningInteraction()) {
      cancelPendingClose();
      scheduleFocus();
      return;
    }
    if (!focusAcquired || pendingClose) {
      return;
    }
    pendingClose = setTimeout(() => {
      pendingClose = undefined;
      if (!disposed && visible && !window.isDestroyed() &&
        !window.isFocused() && !isOpeningInteraction()) {
        hide("focus-lost");
      }
    }, 50);
  };
  const showPending = () => {
    if (disposed || !ready || !pending || window.isDestroyed()) {
      return;
    }
    const request = pending;
    pending = undefined;
    stopFocusCheck();
    openingUntil = Date.now() + TRAY_MENU_OPENING_MS;
    triggerBounds = request.triggerBounds;
    const bounds = getTrayMenuBounds(
      request.point,
      screen.getDisplayNearestPoint(request.point).workArea
    );
    anchor = bounds;
    window.setBounds(bounds, false);
    view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
    visible = true;
    if (!window.isVisible()) {
      window.show();
    }
    window.moveTop();
    window.focus();
    view.webContents.focus();
    focusAcquired = window.isFocused();
    view.webContents.send(TRAY_MENU_IPC.shown, nativeTheme.shouldUseDarkColors);
    scheduleFocus();
    focusCheck = setInterval(checkFocus, 50);
    trace("tray.menu-opened", {
      requestId: request.requestId,
      elapsedMs: Math.round(performance.now() - request.requestedAt),
      focused: window.isFocused()
    });
  };
  const isMenuSender = (event: IpcMainEvent) =>
    !disposed &&
    event.sender === view.webContents &&
    event.senderFrame === view.webContents.mainFrame;
  const onReady = (event: IpcMainEvent) => {
    if (!isMenuSender(event)) {
      return;
    }
    ready = true;
    trace("tray.menu-ready");
    if (!visible) {
      arm();
    }
    showPending();
  };
  const onAction = (event: IpcMainEvent, action: unknown) => {
    if (!isMenuSender(event) || !visible ||
      !["show", "quit", "dismiss"].includes(action as string)) {
      return;
    }
    hide(String(action));
    if (action === "show") {
      showMainWindow();
    } else if (action === "quit") {
      quitApplication();
    }
  };
  ipcMain.on(TRAY_MENU_IPC.ready, onReady);
  ipcMain.on(TRAY_MENU_IPC.action, onAction);
  // Keep the parked frame current so opening never swaps themes on screen.
  const onThemeUpdated = () => {
    if (!disposed && !view.webContents.isDestroyed()) {
      view.webContents.send(TRAY_MENU_IPC.theme, nativeTheme.shouldUseDarkColors);
    }
  };
  const onDisplaysChanged = () => {
    if (!visible) {
      park();
    }
  };
  nativeTheme.on("updated", onThemeUpdated);
  screen.on("display-added", onDisplaysChanged);
  screen.on("display-removed", onDisplaysChanged);
  screen.on("display-metrics-changed", onDisplaysChanged);
  window.on("blur", checkFocus);
  window.on("focus", cancelPendingClose);
  window.on("close", (event) => {
    if (!disposed) {
      event.preventDefault();
      hide("close");
    }
  });
  window.on("closed", () => {
    disposed = true;
    stopFocusCheck();
    ipcMain.removeListener(TRAY_MENU_IPC.ready, onReady);
    ipcMain.removeListener(TRAY_MENU_IPC.action, onAction);
    nativeTheme.removeListener("updated", onThemeUpdated);
    screen.removeListener("display-added", onDisplaysChanged);
    screen.removeListener("display-removed", onDisplaysChanged);
    screen.removeListener("display-metrics-changed", onDisplaysChanged);
    // BaseWindow does not own the WebContentsView's renderer lifetime.
    if (!view.webContents.isDestroyed()) {
      view.webContents.close();
    }
  });
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  view.webContents.on("will-navigate", (event) => event.preventDefault());
  view.webContents.on("preload-error", (_event, _path, error) => {
    void diagnostics?.warning("tray.menu-preload-failed", { error }).catch(() => undefined);
  });
  view.webContents.on("render-process-gone", (_event, details) => {
    ready = false;
    hide("renderer-gone");
    void diagnostics?.warning("tray.menu-renderer-gone", details).catch(() => undefined);
  });
  const html = menuHtml
    .replace("/*__TOKENS__*/", designTokens)
    .replace("__THEME__", nativeTheme.shouldUseDarkColors ? "dark" : "light");
  void view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    .catch((error) => {
      if (!disposed) {
        void diagnostics?.warning("tray.menu-load-failed", { error }).catch(() => undefined);
      }
    });

  return {
    show(point: Point, bounds: Rectangle = { ...point, width: 1, height: 1 }) {
      if (disposed) {
        return;
      }
      stopFocusCheck();
      pending = {
        point,
        triggerBounds: bounds,
        requestId: ++sequence,
        requestedAt: performance.now()
      };
      trace("tray.right-click", { requestId: sequence, ready });
      showPending();
    },
    hide,
    destroy() {
      if (disposed) {
        return;
      }
      pending = undefined;
      stopFocusCheck();
      visible = false;
      disposed = true;
      window.destroy();
    }
  };
}

import type { AppCloseBehaviorDto } from "@gitnest/contracts";

export interface MainWindowCloseLifecycle {
  getCloseBehavior(): Promise<AppCloseBehaviorDto>;
  isQuitting(): boolean;
  onCloseBehaviorLoadFailed(error: unknown): void;
  requestQuit(): void;
}

interface MainWindowCloseTarget {
  close(): void;
  hide(): void;
  isDestroyed(): boolean;
}

interface MainWindowCloseCoordinatorOptions {
  lifecycle?: MainWindowCloseLifecycle;
  persist(): Promise<void>;
  target: MainWindowCloseTarget;
}

interface PreventableCloseEvent {
  preventDefault(): void;
}

export interface MainWindowCloseCoordinator {
  handleClose(event: PreventableCloseEvent): void;
  isPending(): boolean;
}

export function createMainWindowCloseCoordinator({
  lifecycle,
  persist,
  target
}: MainWindowCloseCoordinatorOptions): MainWindowCloseCoordinator {
  let allowClose = false;
  let pending = false;

  const closeWindow = () => {
    allowClose = true;
    target.close();
  };

  const finishCloseRequest = async (): Promise<void> => {
    await persist();
    if (target.isDestroyed()) {
      return;
    }
    if (!lifecycle) {
      closeWindow();
      return;
    }
    if (lifecycle.isQuitting()) {
      closeWindow();
      return;
    }

    let closeBehavior: AppCloseBehaviorDto = "quit";
    try {
      closeBehavior = await lifecycle.getCloseBehavior();
    } catch (error) {
      lifecycle.onCloseBehaviorLoadFailed(error);
    }

    if (target.isDestroyed()) {
      return;
    }
    if (lifecycle.isQuitting()) {
      closeWindow();
      return;
    }
    if (closeBehavior === "tray") {
      pending = false;
      target.hide();
      return;
    }

    allowClose = true;
    lifecycle.requestQuit();
  };

  return {
    handleClose(event) {
      if (allowClose) {
        return;
      }
      event.preventDefault();
      if (pending) {
        return;
      }
      pending = true;
      void finishCloseRequest();
    },
    isPending() {
      return pending;
    }
  };
}

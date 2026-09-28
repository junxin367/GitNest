import {
  useCallback,
  useEffect,
  useState
} from "react";

import type {
  ApplicationUpdateStateDto
} from "@gitnest/contracts";

export interface ApplicationUpdateController {
  state: ApplicationUpdateStateDto | null;
  check(): Promise<void>;
  acknowledgePrompt(version: string): Promise<void>;
  downloadAndInstall(): Promise<void>;
  openProjectPage(): Promise<void>;
  openReleasePage(): Promise<void>;
}

export function useApplicationUpdate(): ApplicationUpdateController {
  const [state, setState] =
    useState<ApplicationUpdateStateDto | null>(null);

  useEffect(() => {
    let active = true;
    let eventReceived = false;
    const unsubscribe =
      window.gitnest.update.onStateChanged((nextState) => {
        eventReceived = true;
        if (active) {
          setState(nextState);
        }
      });

    void window.gitnest.update
      .getState()
      .then((initialState) => {
        if (active && !eventReceived) {
          setState(initialState);
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const run = useCallback(
    async (
      action: () => Promise<ApplicationUpdateStateDto>
    ) => {
      const nextState = await action();
      setState(nextState);
    },
    []
  );

  return {
    state,
    check: () =>
      run(() => window.gitnest.update.check()),
    acknowledgePrompt: (version) =>
      run(() =>
        window.gitnest.update.acknowledgePrompt({
          version
        })
      ),
    downloadAndInstall: () =>
      run(() =>
        window.gitnest.update.downloadAndInstall()
      ),
    openProjectPage: () =>
      run(() =>
        window.gitnest.update.openProjectPage()
      ),
    openReleasePage: () =>
      run(() =>
        window.gitnest.update.openReleasePage()
      )
  };
}

import {
  useCallback,
  useEffect,
  useRef,
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
  const revision = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const initialRevision = ++revision.current;
    const unsubscribe =
      window.gitnest.update.onStateChanged((nextState) => {
        if (mounted.current) {
          revision.current += 1;
          setState(nextState);
        }
      });

    void window.gitnest.update
      .getState()
      .then((initialState) => {
        if (mounted.current && revision.current === initialRevision) {
          setState(initialState);
        }
      })
      .catch(() => undefined);

    return () => {
      mounted.current = false;
      revision.current += 1;
      unsubscribe();
    };
  }, []);

  const run = useCallback(
    async (
      action: () => Promise<ApplicationUpdateStateDto>
    ) => {
      if (!mounted.current) {
        return;
      }
      const requestRevision = ++revision.current;
      const nextState = await action();
      if (mounted.current && revision.current === requestRevision) {
        setState(nextState);
      }
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

import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

import {
  createDefaultAppSettings,
  type AppSettingsDto,
  type GitReadErrorDto,
  type UpdateAppSettingsRequest
} from "@gitnest/contracts";

export interface AppSettingsController {
  settings: AppSettingsDto;
  loaded: boolean;
  loading: boolean;
  saving: boolean;
  clearingKey: boolean;
  error: GitReadErrorDto | null;
  notice: string | null;
  reload(): Promise<void>;
  update(
    patch: UpdateAppSettingsRequest,
    options?: {
      silent?: boolean;
      notice?: string;
    }
  ): Promise<boolean>;
  clearAiApiKey(): Promise<boolean>;
  clearFeedback(): void;
}

export function useAppSettings(): AppSettingsController {
  const [settings, setSettings] = useState<AppSettingsDto>(
    createDefaultAppSettings
  );
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingCount, setSavingCount] = useState(0);
  const [clearingKey, setClearingKey] = useState(false);
  const [error, setError] =
    useState<GitReadErrorDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);

  const update = useCallback(
    async (
      patch: UpdateAppSettingsRequest,
      options: {
        silent?: boolean;
        notice?: string;
      } = {}
    ): Promise<boolean> => {
      const requestGeneration = generation.current;
      setSavingCount((count) => count + 1);
      if (!options.silent) {
        setError(null);
        setNotice(null);
      }
      try {
        const result =
          await window.gitnest.settings.update(patch);
        if (requestGeneration !== generation.current) {
          return false;
        }
        if (!result.ok) {
          if (!options.silent) {
            setError(result.error);
          }
          return false;
        }
        setSettings(result.value);
        if (!options.silent) {
          setNotice(options.notice ?? "设置已保存。");
        }
        return true;
      } catch (reason) {
        if (
          requestGeneration === generation.current &&
          !options.silent
        ) {
          setError(unexpectedSettingsError(reason));
        }
        return false;
      } finally {
        if (requestGeneration === generation.current) {
          setSavingCount((count) => Math.max(0, count - 1));
        }
      }
    },
    []
  );

  const reload = useCallback(async () => {
    generation.current += 1;
    const requestGeneration = generation.current;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const result = await window.gitnest.settings.get();
      if (requestGeneration !== generation.current) {
        return;
      }
      if (!result.ok) {
        setSettings(createDefaultAppSettings());
        setError(result.error);
        return;
      }

      setSettings(result.value.settings);
      if (result.value.storageState === "missing") {
        const legacyTheme = readLegacyTheme();
        if (legacyTheme) {
          const migrated =
            await window.gitnest.settings.update({
              appearance: { theme: legacyTheme }
            });
          if (
            requestGeneration === generation.current &&
            migrated.ok
          ) {
            setSettings(migrated.value);
            removeLegacyTheme();
          }
        }
      }
    } catch (reason) {
      if (requestGeneration === generation.current) {
        setSettings(createDefaultAppSettings());
        setError(unexpectedSettingsError(reason));
      }
    } finally {
      if (requestGeneration === generation.current) {
        setLoading(false);
        setLoaded(true);
      }
    }
  }, []);

  useEffect(() => {
    void reload();
    return () => {
      generation.current += 1;
    };
  }, [reload]);

  const clearAiApiKey = useCallback(async (): Promise<boolean> => {
    const requestGeneration = generation.current;
    setClearingKey(true);
    setError(null);
    setNotice(null);
    try {
      const result =
        await window.gitnest.settings.clearAiApiKey({
          confirmed: true
        });
      if (requestGeneration !== generation.current) {
        return false;
      }
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      setSettings(result.value);
      setNotice("AI API Key 已清空。");
      return true;
    } catch (reason) {
      if (requestGeneration === generation.current) {
        setError(unexpectedSettingsError(reason));
      }
      return false;
    } finally {
      if (requestGeneration === generation.current) {
        setClearingKey(false);
      }
    }
  }, []);

  const clearFeedback = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  return {
    settings,
    loaded,
    loading,
    saving: savingCount > 0,
    clearingKey,
    error,
    notice,
    reload,
    update,
    clearAiApiKey,
    clearFeedback
  };
}

function readLegacyTheme(): "dark" | "light" | null {
  try {
    const value = window.localStorage.getItem("gitnest.theme");
    return value === "dark" || value === "light"
      ? value
      : null;
  } catch {
    return null;
  }
}

function removeLegacyTheme(): void {
  try {
    window.localStorage.removeItem("gitnest.theme");
  } catch {
    // Legacy preference cleanup is best-effort.
  }
}

function unexpectedSettingsError(
  reason: unknown
): GitReadErrorDto {
  return {
    code: "COMMAND_FAILED",
    message:
      reason instanceof Error
        ? reason.message
        : "应用设置操作失败。",
    details: {}
  };
}

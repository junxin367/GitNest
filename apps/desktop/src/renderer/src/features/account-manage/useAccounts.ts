import {
  useCallback,
  useEffect,
  useState
} from "react";

import type {
  AccountOverviewDto,
  AccountRemovalImpactDto,
  BindAccountRequest,
  GitReadErrorDto,
  SaveAccountRequest,
  UnbindAccountRequest
} from "@gitnest/contracts";

export type AccountAction =
  | "loading"
  | "saving"
  | "binding"
  | "testing"
  | "removing";

export interface AccountController {
  overview: AccountOverviewDto | null;
  removalImpact: AccountRemovalImpactDto | null;
  active: AccountAction | null;
  error: GitReadErrorDto | null;
  notice: string | null;
  reload(): Promise<void>;
  save(request: SaveAccountRequest): Promise<boolean>;
  bind(request: BindAccountRequest): Promise<boolean>;
  unbind(request: UnbindAccountRequest): Promise<boolean>;
  test(
    accountId: string,
    repositoryUrl: string
  ): Promise<boolean>;
  requestRemoval(accountId: string): Promise<boolean>;
  confirmRemoval(): Promise<boolean>;
  dismissRemoval(): void;
  clearFeedback(): void;
}

export function useAccounts(): AccountController {
  const [overview, setOverview] =
    useState<AccountOverviewDto | null>(null);
  const [removalImpact, setRemovalImpact] =
    useState<AccountRemovalImpactDto | null>(null);
  const [active, setActive] =
    useState<AccountAction | null>("loading");
  const [error, setError] =
    useState<GitReadErrorDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadOverview = useCallback(
    async (showLoading: boolean): Promise<boolean> => {
      if (showLoading) {
        setActive("loading");
      }
      try {
        const result = await window.gitnest.account.list();
        if (!result.ok) {
          setError(result.error);
          return false;
        }
        setOverview(result.value);
        setError(null);
        return true;
      } catch (reason) {
        setError(unexpectedAccountError(reason));
        return false;
      } finally {
        if (showLoading) {
          setActive(null);
        }
      }
    },
    []
  );

  useEffect(() => {
    void loadOverview(true);
  }, [loadOverview]);

  const runMutation = useCallback(
    async (
      action: Exclude<AccountAction, "loading">,
      invoke: () => Promise<
        | Awaited<
            ReturnType<typeof window.gitnest.account.save>
          >
        | Awaited<
            ReturnType<typeof window.gitnest.account.bind>
          >
        | Awaited<
            ReturnType<typeof window.gitnest.account.unbind>
          >
      >,
      successMessage: string
    ): Promise<boolean> => {
      if (active) {
        return false;
      }
      setActive(action);
      setError(null);
      setNotice(null);
      try {
        const result = await invoke();
        if (!result.ok) {
          setError(result.error);
          return false;
        }
        await loadOverview(false);
        setNotice(successMessage);
        return true;
      } catch (reason) {
        setError(unexpectedAccountError(reason));
        return false;
      } finally {
        setActive(null);
      }
    },
    [active, loadOverview]
  );

  const save = useCallback(
    (request: SaveAccountRequest) =>
      runMutation(
        "saving",
        () => window.gitnest.account.save(request),
        "账号元数据和安全凭据已保存。"
      ),
    [runMutation]
  );

  const bind = useCallback(
    (request: BindAccountRequest) =>
      runMutation(
        "binding",
        () => window.gitnest.account.bind(request),
        request.repositoryId
          ? "当前仓库账号绑定已更新。"
          : "主机默认账号已更新。"
      ),
    [runMutation]
  );

  const unbind = useCallback(
    (request: UnbindAccountRequest) =>
      runMutation(
        "binding",
        () => window.gitnest.account.unbind(request),
        request.repositoryId
          ? "当前仓库已恢复主机默认或系统 Git 认证。"
          : "该主机已恢复系统 Git 认证。"
      ),
    [runMutation]
  );

  const test = useCallback(
    async (
      accountId: string,
      repositoryUrl: string
    ): Promise<boolean> => {
      if (active) {
        return false;
      }
      setActive("testing");
      setError(null);
      setNotice(null);
      try {
        const result = await window.gitnest.account.test({
          accountId,
          repositoryUrl
        });
        if (!result.ok) {
          setError(result.error);
          return false;
        }
        await loadOverview(false);
        setNotice(result.value.message);
        return result.value.status === "verified";
      } catch (reason) {
        setError(unexpectedAccountError(reason));
        return false;
      } finally {
        setActive(null);
      }
    },
    [active, loadOverview]
  );

  const requestRemoval = useCallback(
    async (accountId: string): Promise<boolean> => {
      if (active) {
        return false;
      }
      setActive("removing");
      setError(null);
      setNotice(null);
      try {
        const result =
          await window.gitnest.account.getRemovalImpact({
            accountId
          });
        if (!result.ok) {
          setError(result.error);
          return false;
        }
        setRemovalImpact(result.value);
        return true;
      } catch (reason) {
        setError(unexpectedAccountError(reason));
        return false;
      } finally {
        setActive(null);
      }
    },
    [active]
  );

  const confirmRemoval = useCallback(async (): Promise<boolean> => {
    if (!removalImpact || active) {
      return false;
    }
    setActive("removing");
    setError(null);
    setNotice(null);
    try {
      const result = await window.gitnest.account.remove({
        accountId: removalImpact.accountId,
        confirmed: true
      });
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      setRemovalImpact(null);
      await loadOverview(false);
      setNotice("账号、安全凭据和关联绑定已删除。");
      return true;
    } catch (reason) {
      setError(unexpectedAccountError(reason));
      return false;
    } finally {
      setActive(null);
    }
  }, [active, loadOverview, removalImpact]);

  const dismissRemoval = useCallback(() => {
    if (!active) {
      setRemovalImpact(null);
    }
  }, [active]);

  const clearFeedback = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  return {
    overview,
    removalImpact,
    active,
    error,
    notice,
    reload: () => loadOverview(true).then(() => undefined),
    save,
    bind,
    unbind,
    test,
    requestRemoval,
    confirmRemoval,
    dismissRemoval,
    clearFeedback
  };
}

function unexpectedAccountError(
  reason: unknown
): GitReadErrorDto {
  return {
    code: "COMMAND_FAILED",
    message:
      reason instanceof Error
        ? reason.message
        : "账号操作失败。",
    details: {}
  };
}

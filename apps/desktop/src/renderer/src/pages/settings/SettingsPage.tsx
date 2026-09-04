import {
  useMemo,
  useState,
  type FormEvent
} from "react";

import type {
  AccountAuthTypeDto,
  AccountProfileDto,
  AccountProviderDto,
  ExternalTerminalProfileDto,
  GitEnvironmentDto,
  WorkspaceDetailsDto
} from "@gitnest/contracts";

import type { AccountController } from "../../features/account-manage/useAccounts";
import { Icon } from "../../shared/ui/Icon";

interface SettingsPageProps {
  workspace: WorkspaceDetailsDto | null;
  gitEnvironment: GitEnvironmentDto | null;
  terminalProfiles: ExternalTerminalProfileDto[];
  accounts: AccountController;
}

export function SettingsPage({
  workspace,
  gitEnvironment,
  terminalProfiles,
  accounts
}: SettingsPageProps) {
  const [provider, setProvider] =
    useState<AccountProviderDto>("github");
  const [host, setHost] = useState("github.com");
  const [username, setUsername] = useState("");
  const [authType, setAuthType] =
    useState<AccountAuthTypeDto>("https-token");
  const [token, setToken] = useState("");
  const [makeHostDefault, setMakeHostDefault] =
    useState(true);
  const [testUrls, setTestUrls] = useState<
    Record<string, string>
  >({});
  const selectedRepositoryId =
    workspace?.selectedTarget?.repositoryId;
  const repositoryNames = useMemo(
    () =>
      new Map(
        workspace?.repositories.map((repository) => [
          repository.id,
          repository.name
        ]) ?? []
      ),
    [workspace?.repositories]
  );

  const submitAccount = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    const saved = await accounts.save({
      provider,
      host,
      ...(username.trim() ? { username } : {}),
      authType,
      ...(authType === "https-token" && token
        ? { token }
        : {}),
      makeHostDefault
    });
    if (saved) {
      setToken("");
      setUsername("");
    }
  };

  return (
    <div className="page-scroll settings-page">
      <section className="page-heading">
        <div>
          <span className="eyebrow">安全与工具</span>
          <h1>设置</h1>
          <p>
            默认继续使用系统 Git Credential Helper、SSH Agent 和
            .ssh/config；只有显式保存并绑定的 GitNest 账号才覆盖对应主机或仓库。
          </p>
        </div>
        <div className="page-actions">
          <button
            className="button"
            disabled={accounts.active !== null}
            onClick={() => void accounts.reload()}
            type="button"
          >
            <Icon name="refresh" />
            重新读取
          </button>
        </div>
      </section>

      {(accounts.error || accounts.notice) && (
        <div
          className={`workspace-feedback ${
            accounts.error ? "error" : "success"
          }`}
          role={accounts.error ? "alert" : "status"}
        >
          <Icon
            name={accounts.error ? "warning" : "check"}
          />
          <div>
            <strong>
              {accounts.error
                ? "账号操作未完成"
                : "账号操作完成"}
            </strong>
            <span>
              {accounts.error?.message ?? accounts.notice}
            </span>
          </div>
          <button
            aria-label="关闭账号提示"
            className="icon-button"
            onClick={accounts.clearFeedback}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>
      )}

      <section className="settings-grid">
        <article className="panel account-create-panel">
          <header className="panel-header">
            <div className="panel-title">
              <Icon name="plus" />
              添加账号
            </div>
            <span className="status-pill blue">
              Token 单向提交
            </span>
          </header>
          <form
            className="account-form"
            onSubmit={submitAccount}
          >
            <div className="account-form-grid">
              <label>
                平台
                <select
                  onChange={(event) => {
                    const next =
                      event.target.value as AccountProviderDto;
                    setProvider(next);
                    setHost(defaultHost(next));
                  }}
                  value={provider}
                >
                  <option value="github">GitHub</option>
                  <option value="gitlab">GitLab</option>
                  <option value="gitee">Gitee</option>
                  <option value="custom">自建 Git</option>
                </select>
              </label>
              <label>
                主机
                <input
                  maxLength={320}
                  onChange={(event) =>
                    setHost(event.target.value)
                  }
                  placeholder="git.example.com"
                  spellCheck={false}
                  value={host}
                />
              </label>
              <label>
                认证方式
                <select
                  onChange={(event) => {
                    const next =
                      event.target.value as AccountAuthTypeDto;
                    setAuthType(next);
                    if (next === "system-ssh") {
                      setToken("");
                    }
                  }}
                  value={authType}
                >
                  <option value="https-token">
                    HTTPS Token
                  </option>
                  <option value="system-ssh">
                    系统 SSH
                  </option>
                </select>
              </label>
              <label>
                用户名（可选）
                <input
                  maxLength={255}
                  onChange={(event) =>
                    setUsername(event.target.value)
                  }
                  placeholder={
                    authType === "system-ssh"
                      ? "git"
                      : "账号用户名"
                  }
                  spellCheck={false}
                  value={username}
                />
              </label>
              {authType === "https-token" && (
                <label className="account-token-field">
                  Token
                  <input
                    autoComplete="new-password"
                    maxLength={8_192}
                    onChange={(event) =>
                      setToken(event.target.value)
                    }
                    placeholder="仅本次提交存在于 Renderer"
                    spellCheck={false}
                    type="password"
                    value={token}
                  />
                </label>
              )}
            </div>
            <label className="account-checkbox">
              <input
                checked={makeHostDefault}
                onChange={(event) =>
                  setMakeHostDefault(event.target.checked)
                }
                type="checkbox"
              />
              保存后设为该主机的默认 GitNest 账号
            </label>
            <div className="account-security-note">
              <Icon name="warning" size={14} />
              <p>
                Token 不会进入账号列表、普通 JSON、日志、Git
                参数或 IPC 返回值；保存成功后此输入立即清空。
              </p>
            </div>
            <div className="account-form-actions">
              <button
                className="button"
                disabled={accounts.active !== null}
                onClick={() => {
                  setUsername("");
                  setToken("");
                }}
                type="button"
              >
                清空敏感输入
              </button>
              <button
                className="button primary"
                disabled={
                  accounts.active !== null ||
                  !host.trim() ||
                  (authType === "https-token" &&
                    !token.trim())
                }
                type="submit"
              >
                <Icon
                  name={
                    accounts.active === "saving"
                      ? "refresh"
                      : "check"
                  }
                />
                {accounts.active === "saving"
                  ? "安全保存中…"
                  : "保存账号"}
              </button>
            </div>
          </form>
        </article>

        <article className="panel system-auth-panel">
          <header className="panel-header">
            <div className="panel-title">
              <Icon name="repository" />
              系统 Git 认证
            </div>
            <span className="status-pill green">默认</span>
          </header>
          <div className="system-auth-content">
            <strong>未绑定时不改变系统行为</strong>
            <p>
              GitNest 不修改全局 Git 配置，也不导入或保存 SSH
              私钥与口令。
            </p>
            <dl className="detail-list">
              <DetailRow
                label="Credential Helpers"
                value={`${gitEnvironment?.credentialHelpers.length ?? 0} 个`}
              />
              <DetailRow
                label="SSH Agent"
                value={
                  gitEnvironment?.ssh.authSockConfigured
                    ? "已配置"
                    : "由系统按需使用"
                }
              />
              <DetailRow
                label=".ssh/config"
                value={
                  gitEnvironment?.ssh.configExists
                    ? "已检测"
                    : "未检测"
                }
              />
            </dl>
          </div>
        </article>
      </section>

      <article className="panel account-list-panel">
        <header className="panel-header">
          <div className="panel-title">
            <Icon name="settings" />
            GitNest 账号中心
          </div>
          <span className="panel-caption">
            {accounts.overview?.accounts.length ?? 0} 个账号
          </span>
        </header>
        {accounts.active === "loading" &&
        !accounts.overview ? (
          <div className="repository-loading" role="status">
            <span className="empty-state-icon spinning">
              <Icon name="refresh" size={18} />
            </span>
            <span>正在读取账号元数据…</span>
          </div>
        ) : accounts.overview?.accounts.length ? (
          <div className="account-card-list">
            {accounts.overview.accounts.map((account) => (
              <AccountCard
                account={account}
                active={accounts.active !== null}
                bindings={
                  accounts.overview?.bindings ?? []
                }
                key={account.id}
                repositoryNames={repositoryNames}
                selectedRepositoryId={selectedRepositoryId}
                testUrl={testUrls[account.id] ?? ""}
                onBind={(repositoryId) =>
                  void accounts.bind({
                    accountId: account.id,
                    ...(repositoryId ? { repositoryId } : {})
                  })
                }
                onDelete={() =>
                  void accounts.requestRemoval(account.id)
                }
                onTest={() =>
                  void accounts.test(
                    account.id,
                    testUrls[account.id] ?? ""
                  )
                }
                onTestUrlChange={(value) =>
                  setTestUrls((current) => ({
                    ...current,
                    [account.id]: value
                  }))
                }
                onUnbind={(repositoryId) =>
                  void accounts.unbind({
                    host: account.host,
                    ...(repositoryId ? { repositoryId } : {})
                  })
                }
              />
            ))}
          </div>
        ) : (
          <div className="empty-state account-empty-state">
            <span className="empty-state-icon">
              <Icon name="repository" size={20} />
            </span>
            <div>
              <strong>尚未添加 GitNest 账号</strong>
              <p>
                当前所有仓库继续使用系统 Credential Helper 或 SSH。
              </p>
            </div>
          </div>
        )}
      </article>

      <article className="panel terminal-settings-panel">
        <header className="panel-header">
          <div className="panel-title">
            <Icon name="terminal" />
            外部终端
          </div>
          <span className="panel-caption">
            {terminalProfiles.length} 个可用
          </span>
        </header>
        <div className="terminal-profile-list">
          {terminalProfiles.map((profile) => (
            <div key={profile.kind}>
              <Icon name="terminal" size={15} />
              <span>
                <strong>{profile.label}</strong>
                <small>{profile.kind}</small>
              </span>
              <span className="status-pill green">可用</span>
            </div>
          ))}
          {terminalProfiles.length === 0 && (
            <div className="inspector-empty">
              未检测到 Windows Terminal、PowerShell、CMD 或 Git
              Bash。
            </div>
          )}
        </div>
      </article>

      {accounts.removalImpact && (
        <div className="command-dialog-backdrop">
          <section
            aria-labelledby="account-removal-title"
            aria-modal="true"
            className="command-dialog danger account-removal-dialog"
            role="dialog"
          >
            <header className="command-dialog-header">
              <span className="command-dialog-icon danger">
                <Icon name="warning" size={20} />
              </span>
              <div>
                <span className="eyebrow">删除账号</span>
                <h2 id="account-removal-title">
                  {accounts.removalImpact.host}
                </h2>
                <p>
                  将删除安全凭据和全部账号绑定，已完成的 Git
                  操作不会回滚。
                </p>
              </div>
            </header>
            <div className="command-dialog-body">
              <section>
                <h3>影响范围</h3>
                <div className="command-impact-list">
                  <article>
                    <div>
                      <strong>主机默认绑定</strong>
                      <span>
                        {accounts.removalImpact.hostDefault
                          ? "将移除"
                          : "无"}
                      </span>
                    </div>
                    <p>{accounts.removalImpact.host}</p>
                  </article>
                  <article>
                    <div>
                      <strong>仓库覆盖绑定</strong>
                      <span>
                        {
                          accounts.removalImpact.repositoryIds
                            .length
                        }{" "}
                        个
                      </span>
                    </div>
                    <p>
                      {accounts.removalImpact.repositoryIds
                        .map(
                          (id) => repositoryNames.get(id) ?? id
                        )
                        .join("、") || "无"}
                    </p>
                  </article>
                </div>
              </section>
            </div>
            <footer className="command-dialog-footer">
              <p>
                删除后这些仓库将回退到主机默认账号或系统 Git
                认证。
              </p>
              <div>
                <button
                  className="button"
                  disabled={accounts.active !== null}
                  onClick={accounts.dismissRemoval}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="button danger"
                  disabled={accounts.active !== null}
                  onClick={() =>
                    void accounts.confirmRemoval()
                  }
                  type="button"
                >
                  <Icon name="warning" />
                  确认删除账号
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

function AccountCard({
  account,
  bindings,
  selectedRepositoryId,
  repositoryNames,
  testUrl,
  active,
  onTestUrlChange,
  onTest,
  onBind,
  onUnbind,
  onDelete
}: {
  account: AccountProfileDto;
  bindings: Array<{
    host: string;
    accountId: string;
    repositoryId?: string;
  }>;
  selectedRepositoryId: string | undefined;
  repositoryNames: Map<string, string>;
  testUrl: string;
  active: boolean;
  onTestUrlChange(value: string): void;
  onTest(): void;
  onBind(repositoryId?: string): void;
  onUnbind(repositoryId?: string): void;
  onDelete(): void;
}) {
  const accountBindings = bindings.filter(
    (binding) => binding.accountId === account.id
  );
  const hostDefault = accountBindings.some(
    (binding) => !binding.repositoryId
  );
  const selectedBound = accountBindings.some(
    (binding) =>
      binding.repositoryId === selectedRepositoryId
  );
  const repositoryBindings = accountBindings.flatMap(
    (binding) =>
      binding.repositoryId ? [binding.repositoryId] : []
  );

  return (
    <article className="account-card">
      <div className="account-card-heading">
        <span className="runtime-hero-icon">
          <Icon
            name={
              account.authType === "system-ssh"
                ? "terminal"
                : "repository"
            }
            size={18}
          />
        </span>
        <div>
          <strong>
            {providerLabel(account.provider)} · {account.host}
          </strong>
          <span>
            {account.username ?? "未设置用户名"} ·{" "}
            {account.authType === "https-token"
              ? "HTTPS Token"
              : "系统 SSH"}
          </span>
        </div>
        <span
          className={`status-pill ${verificationTone(
            account.verificationStatus
          )}`}
        >
          {verificationLabel(account.verificationStatus)}
        </span>
      </div>

      <div className="account-binding-summary">
        <span>
          主机默认：{hostDefault ? "是" : "否"}
        </span>
        <span>
          仓库绑定：
          {repositoryBindings
            .map((id) => repositoryNames.get(id) ?? id)
            .join("、") || "无"}
        </span>
      </div>

      <div className="account-test-row">
        <input
          onChange={(event) =>
            onTestUrlChange(event.target.value)
          }
          placeholder={
            account.authType === "https-token"
              ? `https://${account.host}/team/repository.git`
              : `git@${account.host}:team/repository.git`
          }
          spellCheck={false}
          value={testUrl}
        />
        <button
          className="button"
          disabled={active || !testUrl.trim()}
          onClick={onTest}
          type="button"
        >
          连接测试
        </button>
      </div>

      <div className="account-card-actions">
        {hostDefault ? (
          <button
            className="mini-action"
            disabled={active}
            onClick={() => onUnbind()}
            type="button"
          >
            取消主机默认
          </button>
        ) : (
          <button
            className="mini-action"
            disabled={active}
            onClick={() => onBind()}
            type="button"
          >
            设为主机默认
          </button>
        )}
        {selectedRepositoryId &&
          (selectedBound ? (
            <button
              className="mini-action"
              disabled={active}
              onClick={() =>
                onUnbind(selectedRepositoryId)
              }
              type="button"
            >
              取消当前仓库绑定
            </button>
          ) : (
            <button
              className="mini-action"
              disabled={active}
              onClick={() => onBind(selectedRepositoryId)}
              type="button"
            >
              绑定当前仓库
            </button>
          ))}
        <button
          className="mini-action danger"
          disabled={active}
          onClick={onDelete}
          type="button"
        >
          删除
        </button>
      </div>
    </article>
  );
}

function DetailRow({
  label,
  value
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function defaultHost(provider: AccountProviderDto): string {
  return {
    github: "github.com",
    gitlab: "gitlab.com",
    gitee: "gitee.com",
    custom: ""
  }[provider];
}

function providerLabel(provider: AccountProviderDto): string {
  return {
    github: "GitHub",
    gitlab: "GitLab",
    gitee: "Gitee",
    custom: "自建 Git"
  }[provider];
}

function verificationLabel(
  status: AccountProfileDto["verificationStatus"]
): string {
  return {
    untested: "未测试",
    verified: "已验证",
    "authentication-failed": "认证失败",
    "permission-denied": "权限不足",
    unavailable: "不可用"
  }[status];
}

function verificationTone(
  status: AccountProfileDto["verificationStatus"]
): "neutral" | "green" | "yellow" | "blue" {
  if (status === "verified") {
    return "green";
  }
  if (
    status === "authentication-failed" ||
    status === "permission-denied"
  ) {
    return "yellow";
  }
  if (status === "unavailable") {
    return "blue";
  }
  return "neutral";
}

import type {
  ExternalTerminalProfileDto,
  GitEnvironmentDto
} from "@gitnest/contracts";

import { Icon } from "../../shared/ui/Icon";

interface SettingsPageProps {
  gitEnvironment: GitEnvironmentDto | null;
  terminalProfiles: ExternalTerminalProfileDto[];
  embedded?: boolean;
  cardId?: string;
}

export function SettingsPage({
  gitEnvironment,
  terminalProfiles,
  embedded = false,
  cardId
}: SettingsPageProps) {
  return (
    <div
      className={
        embedded
          ? "settings-page account-settings-embedded"
          : "page-scroll settings-page"
      }
    >
      {!embedded && (
        <section className="page-heading">
          <div>
            <span className="eyebrow">安全与工具</span>
            <h1>设置</h1>
            <p>
              GitNest 直接继承系统 Credential Helper、SSH Agent、
              .ssh/config 和全局 Git 配置。
            </p>
          </div>
        </section>
      )}

      <article
        className="panel settings-card system-auth-panel"
        id={cardId}
      >
        <header className="settings-card-header">
          <div>
            <div className="settings-card-title">
              系统 Git 认证
            </div>
            <div className="settings-card-description">
              所有远程 Git 操作均使用系统认证，不保存或注入
              GitNest 账号凭据。
            </div>
          </div>
          <span className="status-pill green">
            <Icon name="check" size={12} />
            默认
          </span>
        </header>
        <div className="settings-card-body">
          <div className="settings-info-grid system-auth-info-grid">
            <div className="settings-info-item">
              <span className="settings-info-label">
                默认用户名
              </span>
              <span className="settings-info-value">
                {gitEnvironment?.identity?.name || "未配置"}
              </span>
            </div>
            <div className="settings-info-item">
              <span className="settings-info-label">
                默认邮箱
              </span>
              <span className="settings-info-value">
                {gitEnvironment?.identity?.email || "未配置"}
              </span>
            </div>
            <div className="settings-info-item">
              <span className="settings-info-label">
                Credential Helpers
              </span>
              <span className="settings-info-value">
                {gitEnvironment?.credentialHelpers.length ?? 0} 个
              </span>
            </div>
            <div className="settings-info-item">
              <span className="settings-info-label">
                SSH Agent
              </span>
              <span className="settings-info-value">
                {gitEnvironment?.ssh.authSockConfigured
                  ? "已配置"
                  : "由系统按需使用"}
              </span>
            </div>
            <div className="settings-info-item">
              <span className="settings-info-label">
                .ssh/config
              </span>
              <span className="settings-info-value">
                {gitEnvironment?.ssh.configExists
                  ? "已检测"
                  : "未检测"}
              </span>
            </div>
            <div className="settings-info-item">
              <span className="settings-info-label">
                全局 Git 配置
              </span>
              <span className="settings-info-value">
                保持不变
              </span>
            </div>
          </div>
        </div>
      </article>

      {!embedded && (
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
      )}
    </div>
  );
}

import {
  useEffect,
  useRef,
  useState
} from "react";

import type {
  ExternalTerminalProfileDto,
  GitEnvironmentDto,
  GitReadErrorDto,
  WorkspaceDetailsDto
} from "@gitnest/contracts";

import type { AccountController } from "../../features/account-manage/useAccounts";
import type { AppSettingsController } from "../../features/settings/useAppSettings";
import { Button } from "../../shared/ui/Button";
import { Icon, type IconName } from "../../shared/ui/Icon";
import { Input } from "../../shared/ui/Input";
import { LayerPortal } from "../../shared/ui/LayerPortal";
import {
  Skeleton,
  SkeletonBoundary
} from "../../shared/ui/Skeleton";
import { Textarea } from "../../shared/ui/Textarea";
import { Toast, ToastViewport } from "../../shared/ui/Toast";
import { useModalFocusTrap } from "../../shared/ui/useModalFocusTrap";
import { SettingsPage as AccountAuthSettings } from "./SettingsPage";

type SettingsSection = "general" | "ai" | "git" | "account";

interface ApplicationSettingsPageProps {
  workspace: WorkspaceDetailsDto | null;
  gitEnvironment: GitEnvironmentDto | null;
  terminalProfiles: ExternalTerminalProfileDto[];
  accounts: AccountController;
  appSettings: AppSettingsController;
}

const SETTINGS_SECTIONS: Array<{
  id: SettingsSection;
  label: string;
  subtitle: string;
  icon: IconName;
}> = [
  {
    id: "general",
    label: "通用",
    subtitle: "应用行为与偏好",
    icon: "settings"
  },
  {
    id: "ai",
    label: "AI 提交信息",
    subtitle: "生成提交信息",
    icon: "sparkle"
  },
  {
    id: "git",
    label: "Git",
    subtitle: "运行环境与同步策略",
    icon: "branch"
  },
  {
    id: "account",
    label: "账号与认证",
    subtitle: "凭据与仓库绑定",
    icon: "repository"
  }
];

export function ApplicationSettingsPage({
  workspace,
  gitEnvironment,
  terminalProfiles,
  accounts,
  appSettings
}: ApplicationSettingsPageProps) {
  const [section, setSection] =
    useState<SettingsSection>("general");
  const [aiUrl, setAiUrl] = useState(
    appSettings.settings.ai.apiUrl
  );
  const [aiModel, setAiModel] = useState(
    appSettings.settings.ai.model
  );
  const [aiPrompt, setAiPrompt] = useState(
    appSettings.settings.ai.prompt
  );
  const [aiEnabled, setAiEnabled] = useState(
    appSettings.settings.ai.enabled
  );
  const [aiKey, setAiKey] = useState("");
  const [aiTesting, setAiTesting] = useState(false);
  const [aiFeedback, setAiFeedback] = useState<{
    title: string;
    message: string;
    tone: "success" | "error";
  } | null>(null);
  const [clearKeyConfirmOpen, setClearKeyConfirmOpen] =
    useState(false);

  useEffect(() => {
    setAiUrl(appSettings.settings.ai.apiUrl);
    setAiModel(appSettings.settings.ai.model);
    setAiPrompt(appSettings.settings.ai.prompt);
    setAiEnabled(appSettings.settings.ai.enabled);
  }, [appSettings.settings.ai]);

  const saveAiSettings = async () => {
    const url = aiUrl.trim();
    const model = aiModel.trim();
    const prompt = aiPrompt.trim();
    if (aiEnabled && (!url || !model || !prompt)) {
      setAiFeedback({
        title: "AI 设置未保存",
        message:
          "启用 AI 提交信息前，请填写 API URL、模型和提示词。",
        tone: "error"
      });
      return;
    }

    const saved = await appSettings.update(
      {
        ai: {
          enabled: aiEnabled,
          apiUrl: url,
          model,
          prompt,
          ...(aiKey.trim() ? { apiKey: aiKey } : {})
        }
      },
      {
        notice: "AI 提交信息设置已保存。"
      }
    );
    if (saved) {
      setAiKey("");
      setAiFeedback(null);
    }
  };

  const testAiConnection = async () => {
    const url = aiUrl.trim();
    const model = aiModel.trim();
    if (!url || !model) {
      setAiFeedback({
        title: "无法测试 AI 连接",
        message: "请先填写 API URL 和模型。",
        tone: "error"
      });
      return;
    }
    if (
      !aiKey.trim() &&
      !appSettings.settings.ai.apiKeyConfigured
    ) {
      setAiFeedback({
        title: "无法测试 AI 连接",
        message: "请先填写 API Key。",
        tone: "error"
      });
      return;
    }

    setAiTesting(true);
    setAiFeedback(null);
    try {
      const result =
        await window.gitnest.ai.testConnection({
          apiUrl: url,
          model,
          ...(aiKey.trim() ? { apiKey: aiKey } : {})
        });
      if (!result.ok) {
        setAiFeedback({
          title: "AI 连接测试失败",
          message: formatAiSettingsError(result.error),
          tone: "error"
        });
        return;
      }
      setAiFeedback({
        title: "AI 连接测试成功",
        message: `${result.value.model} 已通过 ${result.value.endpoint} 返回兼容响应。`,
        tone: "success"
      });
    } catch (reason) {
      setAiFeedback({
        title: "AI 连接测试失败",
        message:
          reason instanceof Error
            ? reason.message
            : "无法连接 AI 服务。",
        tone: "error"
      });
    } finally {
      setAiTesting(false);
    }
  };

  const selectedTerminal =
    terminalProfiles.find(
      (profile) =>
        profile.kind ===
        appSettings.settings.general.defaultTerminalKind
    ) ?? terminalProfiles[0];
  const savedTerminalAvailable = terminalProfiles.some(
    (profile) =>
      profile.kind ===
      appSettings.settings.general.defaultTerminalKind
  );

  return (
    <SkeletonBoundary
      fallback={<ApplicationSettingsSkeleton />}
      hasContent={appSettings.loaded}
      label="正在读取应用设置"
      loading={appSettings.loading}
      surfaceClassName="page-scroll settings-page-scroll gn-page-skeleton application-settings-skeleton"
    >
      <div className="page-scroll settings-page-scroll">
        <div className="application-settings-page">
        <section className="page-heading">
          <div>
            <span className="eyebrow">应用偏好</span>
            <h1>设置</h1>
            <p>
              管理应用行为、AI 提交信息、Git 同步策略以及账号认证。
            </p>
          </div>
          <div className="page-actions">
            <Button
              aria-busy={appSettings.loading}
              disabled={appSettings.loading}
              onClick={() => void appSettings.reload()}
              size="small"
              type="button"
            >
              <Icon name="refresh" />
              重新读取
            </Button>
          </div>
        </section>

        <ToastViewport>
          {(appSettings.error || appSettings.notice) && (
            <Toast
              closeLabel="关闭设置提示"
              icon={appSettings.error ? "warning" : "check"}
              key="application-settings-feedback"
              message={
                appSettings.error?.message ??
                appSettings.notice ??
                ""
              }
              onClose={appSettings.clearFeedback}
              title={
                appSettings.error
                  ? "设置操作未完成"
                  : "设置已更新"
              }
              tone={appSettings.error ? "error" : "success"}
            />
          )}
          {aiFeedback && (
            <Toast
              closeLabel="关闭 AI 设置提示"
              icon={
                aiFeedback.tone === "error"
                  ? "warning"
                  : "sparkle"
              }
              key="ai-settings-feedback"
              message={aiFeedback.message}
              onClose={() => setAiFeedback(null)}
              title={aiFeedback.title}
              tone={aiFeedback.tone}
            />
          )}
        </ToastViewport>

        <div className="settings-layout">
          <nav
            aria-label="设置分组"
            className="panel settings-nav"
          >
            <div className="settings-nav-label">GitNest</div>
            {SETTINGS_SECTIONS.map((item) => (
              <button
                aria-current={
                  section === item.id ? "page" : undefined
                }
                className={`settings-nav-item${
                  section === item.id ? " active" : ""
                }`}
                key={item.id}
                onClick={() => setSection(item.id)}
                type="button"
              >
                <Icon name={item.icon} size={16} />
                <span className="settings-nav-item-copy">
                  <span className="settings-nav-item-title">
                    {item.label}
                  </span>
                  <span className="settings-nav-item-subtitle">
                    {item.subtitle}
                  </span>
                </span>
              </button>
            ))}
          </nav>

          <section
            aria-live="polite"
            className="settings-content"
          >
            {section === "general" && (
              <>
                <SettingsCard
                  description="控制启动导航，并明确不可关闭的安全边界。"
                  title="应用行为"
                >
                  <SettingsToggle
                    checked={
                      appSettings.settings.general.restoreLastView
                    }
                    description="重新打开 GitNest 时恢复最近使用的 Workspace 或仓库页签；设置页和操作中心不会成为启动落点。"
                    disabled={appSettings.saving}
                    label="记住上次打开的视图"
                    onChange={(restoreLastView) =>
                      void appSettings.update({
                        general: { restoreLastView }
                      })
                    }
                  />
                  <div className="settings-safety-note">
                    <Icon name="warning" size={15} />
                    <div>
                      <strong>危险操作始终确认</strong>
                      <p>
                        删除分支、清理或移除 Worktree、删除账号等操作始终经过保护性确认，无法在设置中关闭。
                      </p>
                    </div>
                  </div>
                </SettingsCard>

                <SettingsCard
                  badge={`${terminalProfiles.length} 个可用`}
                  description="左侧活动栏的终端入口会使用这里解析出的默认终端。"
                  title="默认终端"
                >
                  <label className="settings-select-field">
                    默认终端
                    <select
                      disabled={
                        appSettings.saving ||
                        terminalProfiles.length === 0
                      }
                      onChange={(event) =>
                        void appSettings.update({
                          general: {
                            defaultTerminalKind:
                              event.target
                                .value as typeof terminalProfiles[number]["kind"]
                          }
                        })
                      }
                      value={selectedTerminal?.kind ?? ""}
                    >
                      {terminalProfiles.length === 0 && (
                        <option value="">没有可用终端</option>
                      )}
                      {terminalProfiles.map((profile) => (
                        <option
                          key={profile.kind}
                          value={profile.kind}
                        >
                          {profile.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {appSettings.settings.general
                    .defaultTerminalKind &&
                    !savedTerminalAvailable &&
                    selectedTerminal && (
                      <p className="settings-inline-warning">
                        已保存的终端当前不可用，暂时回退到{" "}
                        {selectedTerminal.label}；原选择会被保留。
                      </p>
                    )}
                </SettingsCard>

                <SettingsCard
                  description="这些偏好由应用中的主题和 Diff 控件实时更新。"
                  title="当前偏好"
                >
                  <dl className="detail-list settings-preference-list">
                    <Detail
                      label="界面主题"
                      value={
                        appSettings.settings.appearance.theme ===
                        "dark"
                          ? "深色"
                          : "浅色"
                      }
                    />
                    <Detail
                      label="文件变更视图"
                      value={
                        appSettings.settings.diff.fileView ===
                        "tree"
                          ? "树形"
                          : "列表"
                      }
                    />
                    <Detail
                      label="Diff 布局"
                      value={
                        appSettings.settings.diff.layout ===
                        "split"
                          ? "并排"
                          : "统一"
                      }
                    />
                    <Detail
                      label="自动换行"
                      value={
                        appSettings.settings.diff.wrap
                          ? "开启"
                          : "关闭"
                      }
                    />
                    <Detail
                      label="树形目录"
                      value={
                        appSettings.settings.diff
                          .treeDirectoriesCollapsed
                          ? "默认收起"
                          : "默认展开"
                      }
                    />
                    <Detail
                      label="提交区域高度"
                      value={`${appSettings.settings.diff.commitPanelHeight}px`}
                    />
                  </dl>
                </SettingsCard>
              </>
            )}

            {section === "ai" && (
              <>
                <SettingsCard
                  action={
                    <button
                      aria-label="启用 AI 提交信息"
                      aria-pressed={aiEnabled}
                      className={`settings-switch${
                        aiEnabled ? " active" : ""
                      }`}
                      onClick={() =>
                        setAiEnabled((enabled) => !enabled)
                      }
                      type="button"
                    >
                      <span className="settings-switch-thumb" />
                    </button>
                  }
                  description="根据当前提交范围生成提交信息，结果仍由你确认后提交。"
                  title="AI 提交信息"
                >
                  <div className="settings-ai-field-grid">
                    <Input
                      autoComplete="url"
                      fullWidth
                      id="ai-api-url"
                      label="API URL"
                      maxLength={2048}
                      onChange={(event) =>
                        setAiUrl(event.target.value)
                      }
                      placeholder="https://api.example.com/v1"
                      spellCheck={false}
                      value={aiUrl}
                    />
                    <Input
                      autoComplete="off"
                      fullWidth
                      id="ai-model"
                      label="模型"
                      maxLength={256}
                      onChange={(event) =>
                        setAiModel(event.target.value)
                      }
                      placeholder="gpt-4.1-mini"
                      spellCheck={false}
                      value={aiModel}
                    />
                  </div>
                  <Input
                    autoComplete="new-password"
                    fullWidth
                    helpText={
                      appSettings.settings.ai.apiKeyConfigured
                        ? "已有 Key 保存在 app-settings.json；留空会保留原值。"
                        : "Key 将按要求以明文写入 app-settings.json。"
                    }
                    id="ai-api-key"
                    label="API Key"
                    maxLength={8192}
                    onChange={(event) =>
                      setAiKey(event.target.value)
                    }
                    placeholder={
                      appSettings.settings.ai.apiKeyConfigured
                        ? "已保存；输入新值可替换"
                        : "输入 API Key"
                    }
                    spellCheck={false}
                    type="password"
                    value={aiKey}
                  />
                  <Textarea
                    fullWidth
                    id="ai-commit-prompt"
                    label="提交信息提示词"
                    maxLength={12000}
                    onChange={(event) =>
                      setAiPrompt(event.target.value)
                    }
                    placeholder="告诉 AI 如何根据变更生成提交信息。"
                    rows={7}
                    value={aiPrompt}
                  />
                  <p className="settings-field-help">
                    可填写基础地址或完整的
                    `/chat/completions` 地址；基础地址会自动补全端点。
                  </p>
                  <div className="settings-ai-actions">
                    <div className="settings-ai-actions-buttons">
                      <Button
                        aria-busy={aiTesting}
                        disabled={
                          aiTesting || appSettings.saving
                        }
                        onClick={() => void testAiConnection()}
                        size="small"
                        type="button"
                      >
                        <Icon
                          name={aiTesting ? "refresh" : "check"}
                        />
                        {aiTesting ? "测试中…" : "测试连接"}
                      </Button>
                      <Button
                        aria-busy={appSettings.saving}
                        disabled={
                          aiTesting || appSettings.saving
                        }
                        onClick={() => void saveAiSettings()}
                        size="small"
                        type="button"
                        variant="primary"
                      >
                        <Icon name="check" />
                        保存 AI 设置
                      </Button>
                    </div>
                    <Button
                      disabled={
                        !appSettings.settings.ai
                          .apiKeyConfigured ||
                        appSettings.clearingKey
                      }
                      onClick={() => setClearKeyConfirmOpen(true)}
                      size="small"
                      type="button"
                      variant="danger"
                    >
                      清空 Key
                    </Button>
                  </div>
                </SettingsCard>
              </>
            )}

            {section === "git" && (
              <>
                <SettingsCard
                  badge={gitEnvironment ? "可用" : "不可用"}
                  description="查看 GitNest 当前使用的 Git 运行环境。"
                  title="Git 运行环境"
                >
                  <dl className="detail-list settings-preference-list">
                    <Detail
                      label="Git 版本"
                      value={gitEnvironment?.version ?? "未检测"}
                    />
                    <Detail
                      label="执行文件"
                      value={
                        gitEnvironment?.executablePath ?? "不可用"
                      }
                    />
                  </dl>
                </SettingsCard>

                <SettingsCard
                  description="选择应用启动并完成 Workspace 加载后的远程检查方式。"
                  title="远程检查策略"
                >
                  <div className="settings-option-grid">
                    <SettingsOption
                      active={
                        appSettings.settings.git.fetchMode ===
                        "manual"
                      }
                      description="只有明确点击 Fetch 时才更新远程跟踪引用。"
                      icon="download"
                      onClick={() =>
                        void appSettings.update({
                          git: { fetchMode: "manual" }
                        })
                      }
                      title="手动 Fetch"
                    />
                    <SettingsOption
                      active={
                        appSettings.settings.git.fetchMode ===
                        "startup"
                      }
                      description="每次启动且 Workspace 加载完成后，对全部仓库执行一次 Fetch。"
                      icon="refresh"
                      onClick={() =>
                        void appSettings.update({
                          git: { fetchMode: "startup" }
                        })
                      }
                      title="启动时检查"
                    />
                  </div>
                  <div className="settings-safety-note">
                    <Icon name="check" size={15} />
                    <div>
                      <strong>仅更新远程跟踪引用</strong>
                      <p>
                        启动检查不会执行 Pull、Merge、Rebase，也不会修改工作区、暂存区或未提交改动。
                      </p>
                    </div>
                  </div>
                </SettingsCard>

                <SettingsCard
                  description="当 Push 发现远程分支已有更新时，先按这里的策略同步，再继续 Push。"
                  title="Push 同步策略"
                >
                  <div className="settings-option-grid">
                    <SettingsOption
                      active={
                        appSettings.settings.git.pushStrategy ===
                        "rebase"
                      }
                      description="将本地提交重新应用到远程更新之后，保持线性历史。"
                      icon="branch"
                      onClick={() =>
                        void appSettings.update({
                          git: { pushStrategy: "rebase" }
                        })
                      }
                      title="Rebase"
                    />
                    <SettingsOption
                      active={
                        appSettings.settings.git.pushStrategy ===
                        "merge"
                      }
                      description="将远程更新合并到当前分支，必要时生成 Merge 提交。"
                      icon="branch"
                      onClick={() =>
                        void appSettings.update({
                          git: { pushStrategy: "merge" }
                        })
                      }
                      title="Merge"
                    />
                  </div>
                </SettingsCard>
              </>
            )}

            {section === "account" && (
              <AccountAuthSettings
                accounts={accounts}
                embedded
                gitEnvironment={gitEnvironment}
                terminalProfiles={terminalProfiles}
                workspace={workspace}
              />
            )}
          </section>
        </div>
      </div>

        {clearKeyConfirmOpen && (
          <ClearAiKeyDialog
            busy={appSettings.clearingKey}
            onCancel={() => setClearKeyConfirmOpen(false)}
            onConfirm={async () => {
              const cleared = await appSettings.clearAiApiKey();
              if (cleared) {
                setAiKey("");
                setClearKeyConfirmOpen(false);
              }
            }}
          />
        )}
      </div>
    </SkeletonBoundary>
  );
}

function ApplicationSettingsSkeleton() {
  return (
    <div className="application-settings-page">
      <div className="gn-skeleton-heading">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
      <div className="settings-layout">
        <div className="panel settings-nav settings-nav-skeleton">
          <Skeleton height={10} variant="text" width="36%" />
          {Array.from({ length: 4 }, (_, index) => (
            <div className="settings-nav-skeleton-row" key={index}>
              <Skeleton height={18} variant="circle" width={18} />
              <div className="gn-skeleton-row-copy">
                <Skeleton height={10} />
                <Skeleton height={8} variant="text" />
              </div>
            </div>
          ))}
        </div>
        <div className="settings-content">
          {Array.from({ length: 3 }, (_, index) => (
            <div className="gn-skeleton-panel" key={index}>
              <div className="gn-skeleton-panel-header">
                <div className="gn-skeleton-row-copy">
                  <Skeleton height={12} />
                  <Skeleton height={9} variant="text" />
                </div>
              </div>
              <div className="gn-skeleton-panel-body">
                {Array.from({ length: 3 }, (_, rowIndex) => (
                  <div
                    className="settings-skeleton-control"
                    key={rowIndex}
                  >
                    <div className="gn-skeleton-row-copy">
                      <Skeleton height={10} />
                      <Skeleton height={8} variant="text" />
                    </div>
                    <Skeleton height={28} width={96} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SettingsCard({
  title,
  description,
  badge,
  action,
  children
}: {
  title: string;
  description: string;
  badge?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <article className="panel settings-card">
      <header className="settings-card-header">
        <div>
          <div className="settings-card-title">{title}</div>
          <div className="settings-card-description">
            {description}
          </div>
        </div>
        {action}
        {badge && (
          <span className="status-pill neutral">{badge}</span>
        )}
      </header>
      <div className="settings-card-body">{children}</div>
    </article>
  );
}

function SettingsToggle({
  checked,
  disabled,
  label,
  description,
  onChange
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  description: string;
  onChange(value: boolean): void;
}) {
  return (
    <div className="settings-setting-row">
      <div>
        <div className="settings-setting-title">{label}</div>
        <div className="settings-setting-description">
          {description}
        </div>
      </div>
      <button
        aria-label={label}
        aria-pressed={checked}
        className={`settings-switch${checked ? " active" : ""}`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        type="button"
      >
        <span className="settings-switch-thumb" />
      </button>
    </div>
  );
}

function SettingsOption({
  active,
  icon,
  title,
  description,
  onClick
}: {
  active: boolean;
  icon: IconName;
  title: string;
  description: string;
  onClick(): void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`settings-option${active ? " active" : ""}`}
      onClick={onClick}
      type="button"
    >
      <span className="settings-option-head">
        <span className="settings-option-icon">
          <Icon name={icon} size={15} />
        </span>
        <span className="settings-option-title">{title}</span>
      </span>
      <span className="settings-option-description">
        {description}
      </span>
    </button>
  );
}

function Detail({
  label,
  value
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd title={value}>{value}</dd>
    </div>
  );
}

function ClearAiKeyDialog({
  busy,
  onCancel,
  onConfirm
}: {
  busy: boolean;
  onCancel(): void;
  onConfirm(): void | Promise<void>;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  useModalFocusTrap(dialogRef);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel]);

  return (
    <LayerPortal>
      <div className="command-dialog-backdrop">
        <section
          aria-describedby="clear-ai-key-description"
          aria-labelledby="clear-ai-key-title"
          aria-modal="true"
          className="command-dialog danger"
          ref={dialogRef}
          role="dialog"
        >
          <header className="command-dialog-header">
            <span className="command-dialog-icon danger">
              <Icon name="warning" size={20} />
            </span>
            <div>
              <span className="eyebrow">清空凭据</span>
              <h2 id="clear-ai-key-title">清空 AI API Key？</h2>
              <p id="clear-ai-key-description">
                生成和连接测试将不可用，直到再次保存 Key。
              </p>
            </div>
          </header>
          <footer className="command-dialog-footer">
            <p>API URL、模型和提示词不会被删除。</p>
            <div>
              <Button
                data-modal-initial-focus
                disabled={busy}
                onClick={onCancel}
                size="small"
                type="button"
              >
                取消
              </Button>
              <Button
                aria-busy={busy}
                disabled={busy}
                emphasis="strong"
                onClick={() => void onConfirm()}
                size="small"
                type="button"
                variant="danger"
              >
                确认清空 Key
              </Button>
            </div>
          </footer>
        </section>
      </div>
    </LayerPortal>
  );
}

function formatAiSettingsError(
  error: GitReadErrorDto
): string {
  if (error.code === "AUTHENTICATION_FAILED") {
    return "认证失败，请检查 API Key。";
  }
  if (error.code === "COMMAND_TIMEOUT") {
    return "连接超时，请检查 API URL 和网络。";
  }
  return error.message;
}

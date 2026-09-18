import {
  useEffect,
  useRef,
  useState
} from "react";

import type {
  CodeAnalysisSettingsDto,
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
  MenuItem,
  MenuPopover
} from "../../shared/ui/Menu";
import {
  Skeleton,
  SkeletonBoundary
} from "../../shared/ui/Skeleton";
import { Textarea } from "../../shared/ui/Textarea";
import { Toast, ToastViewport } from "../../shared/ui/Toast";
import { useModalFocusTrap } from "../../shared/ui/useModalFocusTrap";
import { SettingsPage as AccountAuthSettings } from "./SettingsPage";

export type ApplicationSettingsSection =
  | "general"
  | "ai"
  | "analysis"
  | "git"
  | "account";

interface ApplicationSettingsPageProps {
  workspace: WorkspaceDetailsDto | null;
  gitEnvironment: GitEnvironmentDto | null;
  terminalProfiles: ExternalTerminalProfileDto[];
  accounts: AccountController;
  appSettings: AppSettingsController;
  initialSection?: ApplicationSettingsSection;
}

const SETTINGS_SECTIONS: Array<{
  id: ApplicationSettingsSection;
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
    id: "analysis",
    label: "LSP 与代码分析",
    subtitle: "请求链与调用关系",
    icon: "graph"
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
  appSettings,
  initialSection = "general"
}: ApplicationSettingsPageProps) {
  const [section, setSection] =
    useState<ApplicationSettingsSection>(initialSection);
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
  const [aiKeyVisible, setAiKeyVisible] = useState(true);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiFeedback, setAiFeedback] = useState<{
    title: string;
    message: string;
    tone: "success" | "error";
  } | null>(null);
  const [clearKeyConfirmOpen, setClearKeyConfirmOpen] =
    useState(false);
  const [analysisDraft, setAnalysisDraft] =
    useState<CodeAnalysisSettingsDto>(() =>
      cloneCodeAnalysisSettings(
        appSettings.settings.codeAnalysis
      )
    );

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    setAiUrl(appSettings.settings.ai.apiUrl);
    setAiModel(appSettings.settings.ai.model);
    setAiPrompt(appSettings.settings.ai.prompt);
    setAiEnabled(appSettings.settings.ai.enabled);
  }, [appSettings.settings.ai]);

  useEffect(() => {
    setAnalysisDraft(
      cloneCodeAnalysisSettings(
        appSettings.settings.codeAnalysis
      )
    );
  }, [appSettings.settings.codeAnalysis]);

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

  const saveAnalysisSettings = async () => {
    await appSettings.update(
      {
        codeAnalysis: cloneCodeAnalysisSettings(
          analysisDraft
        )
      },
      {
        notice:
          "LSP 与代码分析设置已保存；已有分析结果会在下次运行时按新设置重建。"
      }
    );
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
              管理应用行为、AI、LSP 代码分析、Git 同步策略以及账号认证。
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
                  <TerminalProfileDropdown
                    disabled={
                      appSettings.saving ||
                      terminalProfiles.length === 0
                    }
                    onChange={(defaultTerminalKind) =>
                      void appSettings.update({
                        general: { defaultTerminalKind }
                      })
                    }
                    profiles={terminalProfiles}
                    value={selectedTerminal?.kind}
                  />
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
                  description="按类别查看当前文件浏览、差异与提交偏好。"
                  title="当前偏好"
                >
                  <div className="settings-preference-groups">
                    <section
                      aria-labelledby="file-browsing-preference-title"
                      className="settings-preference-group"
                    >
                      <div className="settings-preference-group-header">
                        <Icon name="folder" size={14} />
                        <h3
                          className="settings-preference-group-title"
                          id="file-browsing-preference-title"
                        >
                          文件浏览
                        </h3>
                      </div>
                      <dl className="detail-list settings-preference-list">
                        <Detail
                          label="变更文件视图"
                          value={
                            appSettings.settings.diff
                              .fileView === "tree"
                              ? "树形"
                              : "列表"
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
                      </dl>
                    </section>

                    <section
                      aria-labelledby="diff-preference-title"
                      className="settings-preference-group"
                    >
                      <div className="settings-preference-group-header">
                        <Icon name="fileCode" size={14} />
                        <h3
                          className="settings-preference-group-title"
                          id="diff-preference-title"
                        >
                          差异查看
                        </h3>
                      </div>
                      <dl className="detail-list settings-preference-list">
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
                      </dl>
                    </section>

                    <section
                      aria-labelledby="commit-preference-title"
                      className="settings-preference-group"
                    >
                      <div className="settings-preference-group-header">
                        <Icon name="commit" size={14} />
                        <h3
                          className="settings-preference-group-title"
                          id="commit-preference-title"
                        >
                          提交体验
                        </h3>
                      </div>
                      <dl className="detail-list settings-preference-list">
                        <Detail
                          label="提交区域高度"
                          value={`${appSettings.settings.diff.commitPanelHeight}px`}
                        />
                      </dl>
                    </section>
                  </div>
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
                    trailing={
                      <Button
                        aria-label={
                          aiKeyVisible
                            ? "隐藏 API Key"
                            : "显示 API Key"
                        }
                        aria-pressed={aiKeyVisible}
                        className="gn-input__action"
                        onClick={() =>
                          setAiKeyVisible((visible) => !visible)
                        }
                        title={
                          aiKeyVisible
                            ? "隐藏 API Key"
                            : "显示 API Key"
                        }
                        type="button"
                        variant="unstyled"
                      >
                        <Icon name="eye" size={14} />
                      </Button>
                    }
                    type={aiKeyVisible ? "text" : "password"}
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

            {section === "analysis" && (
              <>
                <SettingsCard
                  action={
                    <button
                      aria-label="启用代码分析"
                      aria-pressed={analysisDraft.enabled}
                      className={`settings-switch${
                        analysisDraft.enabled ? " active" : ""
                      }`}
                      disabled={appSettings.saving}
                      onClick={() =>
                        setAnalysisDraft((current) => ({
                          ...current,
                          enabled: !current.enabled
                        }))
                      }
                      type="button"
                    >
                      <span className="settings-switch-thumb" />
                    </button>
                  }
                  description="分析当前选中的 Workspace 条目，不在项目目录写入索引或配置。"
                  title="代码分析"
                >
                  <div className="settings-option-grid">
                    <SettingsOption
                      active={
                        analysisDraft.defaultScope === "changed"
                      }
                      description="只读取 Git 变动文件，并从现有索引补充直接相关关系。"
                      icon="diff"
                      onClick={() =>
                        setAnalysisDraft((current) => ({
                          ...current,
                          defaultScope: "changed"
                        }))
                      }
                      title="默认分析变动代码"
                    />
                    <SettingsOption
                      active={
                        analysisDraft.defaultScope ===
                        "workspace"
                      }
                      description="默认选中全部代码；仍需在代码分析页手动启动。"
                      icon="files"
                      onClick={() =>
                        setAnalysisDraft((current) => ({
                          ...current,
                          defaultScope: "workspace"
                        }))
                      }
                      title="默认分析全部代码"
                    />
                  </div>
                  <SettingsToggle
                    checked={analysisDraft.staticFallback}
                    description="Language Server 未安装、超时或失败时，继续使用内置框架分析器生成请求链。"
                    disabled={appSettings.saving}
                    label="允许内置分析降级"
                    onChange={(staticFallback) =>
                      setAnalysisDraft((current) => ({
                        ...current,
                        staticFallback
                      }))
                    }
                  />
                  <div className="settings-safety-note">
                    <Icon name="check" size={15} />
                    <div>
                      <strong>Workspace 保持只读</strong>
                      <p>
                        源码只执行目录遍历与读取；分析缓存和 Java LSP
                        数据统一保存在 GitNest 应用数据目录。
                      </p>
                    </div>
                  </div>
                </SettingsCard>

                <LanguageServerSettingsCard
                  description="用于 JavaScript、TypeScript、TSX、JSX 和 Vue 的符号增强。"
                  disabled={appSettings.saving}
                  label="TypeScript Language Server"
                  settings={analysisDraft.typescript}
                  onChange={(typescript) =>
                    setAnalysisDraft((current) => ({
                      ...current,
                      typescript
                    }))
                  }
                />

                <LanguageServerSettingsCard
                  description="用于 Java/Spring 的符号和调用层级增强；GitNest 会自动设置独立 -data 目录。"
                  disabled={appSettings.saving}
                  label="Java Language Server"
                  settings={analysisDraft.java}
                  onChange={(java) =>
                    setAnalysisDraft((current) => ({
                      ...current,
                      java
                    }))
                  }
                />

                <SettingsCard
                  description="限制大型项目的文件读取、内存占用和关系图展开规模。"
                  title="性能预算"
                >
                  <div className="analysis-settings-number-grid">
                    <Input
                      fullWidth
                      id="analysis-max-files"
                      label="最大文件数"
                      max={50000}
                      min={100}
                      onChange={(event) =>
                        setAnalysisDraft((current) => ({
                          ...current,
                          maxFiles: Number(event.target.value)
                        }))
                      }
                      type="number"
                      value={analysisDraft.maxFiles}
                    />
                    <Input
                      fullWidth
                      id="analysis-max-file-size"
                      label="单文件上限（KiB）"
                      max={4096}
                      min={64}
                      onChange={(event) =>
                        setAnalysisDraft((current) => ({
                          ...current,
                          maxFileSizeKb: Number(
                            event.target.value
                          )
                        }))
                      }
                      type="number"
                      value={analysisDraft.maxFileSizeKb}
                    />
                    <Input
                      fullWidth
                      id="analysis-concurrency"
                      label="读取并发数"
                      max={4}
                      min={1}
                      onChange={(event) =>
                        setAnalysisDraft((current) => ({
                          ...current,
                          readConcurrency: Number(
                            event.target.value
                          )
                        }))
                      }
                      type="number"
                      value={analysisDraft.readConcurrency}
                    />
                    <Input
                      fullWidth
                      id="analysis-graph-depth"
                      label="默认关系深度"
                      max={12}
                      min={1}
                      onChange={(event) =>
                        setAnalysisDraft((current) => ({
                          ...current,
                          graphDepth: Number(
                            event.target.value
                          )
                        }))
                      }
                      type="number"
                      value={analysisDraft.graphDepth}
                    />
                    <Input
                      fullWidth
                      id="analysis-lsp-timeout"
                      label="LSP 超时（ms）"
                      max={60000}
                      min={1000}
                      onChange={(event) =>
                        setAnalysisDraft((current) => ({
                          ...current,
                          lspTimeoutMs: Number(
                            event.target.value
                          )
                        }))
                      }
                      type="number"
                      value={analysisDraft.lspTimeoutMs}
                    />
                  </div>
                  <Textarea
                    fullWidth
                    helpText="每行一个目录名；匹配目录后不会继续向下扫描。"
                    id="analysis-ignore-directories"
                    label="忽略目录"
                    onChange={(event) =>
                      setAnalysisDraft((current) => ({
                        ...current,
                        ignoreDirectories: splitLines(
                          event.target.value
                        )
                      }))
                    }
                    rows={7}
                    value={analysisDraft.ignoreDirectories.join(
                      "\n"
                    )}
                  />
                  <div className="settings-ai-actions">
                    <p className="settings-field-help">
                      全部代码分析始终需要在代码分析页手动启动。
                    </p>
                    <Button
                      aria-busy={appSettings.saving}
                      disabled={appSettings.saving}
                      onClick={() =>
                        void saveAnalysisSettings()
                      }
                      size="small"
                      type="button"
                      variant="primary"
                    >
                      <Icon name="check" />
                      保存代码分析设置
                    </Button>
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
                setAiKeyVisible(true);
                setClearKeyConfirmOpen(false);
              }
            }}
          />
        )}
      </div>
    </SkeletonBoundary>
  );
}

function TerminalProfileDropdown({
  disabled,
  onChange,
  profiles,
  value
}: {
  disabled: boolean;
  onChange(
    value: ExternalTerminalProfileDto["kind"]
  ): void;
  profiles: ExternalTerminalProfileDto[];
  value: ExternalTerminalProfileDto["kind"] | undefined;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected =
    profiles.find((profile) => profile.kind === value) ??
    profiles[0];

  useEffect(() => {
    if (!open) {
      return;
    }

    const close = () => setOpen(false);
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !triggerRef.current?.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      ) {
        close();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      close();
      triggerRef.current?.focus();
    };
    const focusFrame = window.requestAnimationFrame(() => {
      const items =
        menuRef.current?.querySelectorAll<HTMLButtonElement>(
          '[role="menuitemradio"]'
        ) ?? [];
      const current = [...items].find(
        (item) => item.getAttribute("aria-checked") === "true"
      );
      (current ?? items[0])?.focus();
    });

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener(
        "pointerdown",
        handlePointerDown
      );
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  return (
    <div className="settings-tool-select">
      <span className="settings-tool-select-label">
        默认终端
      </span>
      <div className="settings-tool-menu">
        <Button
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="选择默认终端"
          className="settings-tool-menu-trigger"
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
          onKeyDown={(event) => {
            if (
              event.key === "ArrowDown" ||
              event.key === "ArrowUp"
            ) {
              event.preventDefault();
              setOpen(true);
            }
          }}
          ref={triggerRef}
          type="button"
          variant="unstyled"
        >
          <span className="settings-tool-menu-trigger-value">
            <Icon name="terminal" size={15} />
            <span>{selected?.label ?? "没有可用终端"}</span>
          </span>
          <Icon name="chevron" size={14} />
        </Button>
        {open && selected && (
          <MenuPopover
            align="start"
            anchor={triggerRef.current}
            aria-label="默认终端选项"
            className="settings-tool-menu-surface"
            ref={menuRef}
            side="bottom"
          >
            {profiles.map((profile) => (
              <MenuItem
                aria-checked={profile.kind === selected.kind}
                className={
                  profile.kind === selected.kind
                    ? "is-selected"
                    : undefined
                }
                key={profile.kind}
                leading={<Icon name="terminal" size={14} />}
                onClick={() => {
                  onChange(profile.kind);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                role="menuitemradio"
              >
                {profile.label}
              </MenuItem>
            ))}
          </MenuPopover>
        )}
      </div>
    </div>
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

function LanguageServerSettingsCard({
  label,
  description,
  settings,
  disabled,
  onChange
}: {
  label: string;
  description: string;
  settings: CodeAnalysisSettingsDto["typescript"];
  disabled: boolean;
  onChange(
    settings: CodeAnalysisSettingsDto["typescript"]
  ): void;
}) {
  return (
    <SettingsCard
      action={
        <button
          aria-label={`启用 ${label}`}
          aria-pressed={settings.enabled}
          className={`settings-switch${
            settings.enabled ? " active" : ""
          }`}
          disabled={disabled}
          onClick={() =>
            onChange({
              ...settings,
              enabled: !settings.enabled
            })
          }
          type="button"
        >
          <span className="settings-switch-thumb" />
        </button>
      }
      description={description}
      title={label}
    >
      <Input
        autoComplete="off"
        fullWidth
        id={`lsp-command-${label
          .toLocaleLowerCase("en-US")
          .replaceAll(" ", "-")}`}
        label="启动命令"
        maxLength={2048}
        onChange={(event) =>
          onChange({
            ...settings,
            command: event.target.value
          })
        }
        placeholder={
          label.startsWith("Java")
            ? "jdtls"
            : "typescript-language-server"
        }
        spellCheck={false}
        value={settings.command}
      />
      <Textarea
        fullWidth
        helpText="每行一个参数；进程通过 stdio 启动，不使用 Shell 拼接。"
        id={`lsp-args-${label
          .toLocaleLowerCase("en-US")
          .replaceAll(" ", "-")}`}
        label="启动参数"
        onChange={(event) =>
          onChange({
            ...settings,
            args: splitLines(event.target.value)
          })
        }
        placeholder={
          label.startsWith("Java")
            ? "通常留空，GitNest 会自动追加 -data"
            : "--stdio"
        }
        rows={4}
        value={settings.args.join("\n")}
      />
    </SettingsCard>
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

function cloneCodeAnalysisSettings(
  settings: CodeAnalysisSettingsDto
): CodeAnalysisSettingsDto {
  return {
    ...settings,
    ignoreDirectories: [...settings.ignoreDirectories],
    typescript: {
      ...settings.typescript,
      args: [...settings.typescript.args]
    },
    java: {
      ...settings.java,
      args: [...settings.java.args]
    }
  };
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
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

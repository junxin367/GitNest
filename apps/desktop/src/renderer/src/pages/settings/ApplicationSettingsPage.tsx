import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

import type {
  CodeAnalysisSettingsDto,
  ExternalTerminalProfileDto,
  GitEnvironmentDto,
  GitReadErrorDto
} from "@gitnest/contracts";
import {
  MAX_CODE_ANALYSIS_DIAGNOSTICS,
  MAX_CODE_ANALYSIS_GRAPH_EDGES,
  MAX_CODE_ANALYSIS_GRAPH_NODES,
  MAX_CODE_ANALYSIS_REQUEST_CHAINS,
  MAX_CODE_ANALYSIS_TOTAL_SOURCE_MB,
  MAX_MCP_MAX_RESPONSE_KB,
  MAX_MCP_MAX_STALE_AGE_DAYS,
  MAX_CODE_ANALYSIS_AUTO_REFRESH_DEBOUNCE_MS,
  MAX_CODE_ANALYSIS_PERIODIC_REFRESH_MINUTES,
  MIN_MCP_MAX_RESPONSE_KB,
  MIN_MCP_MAX_STALE_AGE_DAYS,
  MIN_CODE_ANALYSIS_AUTO_REFRESH_DEBOUNCE_MS,
  MIN_CODE_ANALYSIS_PERIODIC_REFRESH_MINUTES,
  MAX_LSP_DOCUMENTS,
  MAX_LSP_REFERENCES_PER_SYMBOL,
  MAX_LSP_REQUESTS,
  MAX_LSP_SYMBOLS_PER_DOCUMENT,
  MIN_CODE_ANALYSIS_DIAGNOSTICS,
  MIN_CODE_ANALYSIS_GRAPH_EDGES,
  MIN_CODE_ANALYSIS_GRAPH_NODES,
  MIN_CODE_ANALYSIS_REQUEST_CHAINS,
  MIN_CODE_ANALYSIS_TOTAL_SOURCE_MB,
  MIN_LSP_DOCUMENTS,
  MIN_LSP_REFERENCES_PER_SYMBOL,
  MIN_LSP_REQUESTS,
  MIN_LSP_SYMBOLS_PER_DOCUMENT,
  createDefaultCodeAnalysisSettings,
  type LanguageServerCommandSettingsDto,
  type McpRegistrationStatusDto,
  type McpServerSettingsDto
} from "@gitnest/contracts";

import type { AppSettingsController } from "../../features/settings/useAppSettings";
import { Button } from "../../shared/ui/Button";
import { Icon, type IconName } from "../../shared/ui/Icon";
import { Input } from "../../shared/ui/Input";
import { Select } from "../../shared/ui/Select";
import {
  Skeleton,
  SkeletonBoundary
} from "../../shared/ui/Skeleton";
import { Textarea } from "../../shared/ui/Textarea";
import { Toast, ToastViewport } from "../../shared/ui/Toast";
import { SettingsPage as AccountAuthSettings } from "./SettingsPage";

export type ApplicationSettingsSection =
  | "general"
  | "ai"
  | "analysis"
  | "git"
  | "account";

interface ApplicationSettingsPageProps {
  gitEnvironment: GitEnvironmentDto | null;
  terminalProfiles: ExternalTerminalProfileDto[];
  appSettings: AppSettingsController;
  initialSection?: ApplicationSettingsSection;
}

interface SettingsCardLink {
  id: string;
  label: string;
}

interface SettingsSectionDefinition {
  id: ApplicationSettingsSection;
  label: string;
  subtitle: string;
  icon: IconName;
  cards: SettingsCardLink[];
}

const GENERAL_SETTINGS_SECTION: SettingsSectionDefinition = {
  id: "general",
  label: "通用",
  subtitle: "应用行为与偏好",
  icon: "settings",
  cards: [
    { id: "settings-general-behavior", label: "应用行为" },
    { id: "settings-general-terminal", label: "默认终端" },
    { id: "settings-general-preferences", label: "当前偏好" }
  ]
};

const SETTINGS_SECTIONS: SettingsSectionDefinition[] = [
  GENERAL_SETTINGS_SECTION,
  {
    id: "analysis",
    label: "代码分析",
    subtitle: "索引、LSP 与 MCP",
    icon: "graph",
    cards: [
      { id: "settings-analysis-overview", label: "代码分析" },
      { id: "settings-analysis-budget", label: "性能预算" },
      {
        id: "settings-analysis-language-servers",
        label: "Language Server 配置"
      },
      { id: "settings-analysis-mcp", label: "MCP 服务" },
      { id: "settings-analysis-codex", label: "Codex 连接" }
    ]
  },
  {
    id: "ai",
    label: "AI 提交信息",
    subtitle: "生成提交信息",
    icon: "sparkle",
    cards: [
      { id: "settings-ai-commit-message", label: "AI 提交信息" }
    ]
  },
  {
    id: "git",
    label: "Git",
    subtitle: "运行环境与同步策略",
    icon: "branch",
    cards: [
      { id: "settings-git-environment", label: "Git 运行环境" },
      { id: "settings-git-fetch", label: "远程检查策略" },
      { id: "settings-git-push", label: "Push 同步策略" }
    ]
  },
  {
    id: "account",
    label: "账号与认证",
    subtitle: "系统 Git 凭据",
    icon: "repository",
    cards: [
      { id: "settings-account-system", label: "系统 Git 认证" }
    ]
  }
];

function findSettingsSection(
  section: ApplicationSettingsSection
): SettingsSectionDefinition {
  return (
    SETTINGS_SECTIONS.find((item) => item.id === section) ??
    GENERAL_SETTINGS_SECTION
  );
}

const LANGUAGE_SERVER_CONFIGURATIONS = [
  {
    id: "typescript",
    label: "TypeScript",
    title: "TypeScript Language Server",
    description:
      "用于 JavaScript、TypeScript、TSX 和 JSX 的符号增强。",
    commandPlaceholder: "typescript-language-server"
  },
  {
    id: "java",
    label: "Java",
    title: "Java Language Server",
    description:
      "用于 Java/Spring 的符号和调用层级增强；GitNest 会自动设置独立 -data 目录。",
    commandPlaceholder: "jdtls"
  },
  {
    id: "vue",
    label: "Vue",
    title: "Vue Language Server",
    description:
      "用于 Vue 单文件组件的符号和调用层级增强，与 TypeScript Language Server 独立运行。",
    commandPlaceholder: "vue-language-server"
  },
  {
    id: "python",
    label: "Python",
    title: "Python Language Server",
    description:
      "用于 Python 文件的符号和调用层级增强；默认命令兼容 Pyright。",
    commandPlaceholder: "pyright-langserver"
  },
  {
    id: "go",
    label: "Go",
    title: "Go Language Server",
    description: "用于 Go 文件的符号和调用层级增强。",
    commandPlaceholder: "gopls"
  },
  {
    id: "kotlin",
    label: "Kotlin",
    title: "Kotlin Language Server",
    description: "用于 Kotlin 文件的符号和调用层级增强。",
    commandPlaceholder: "kotlin-lsp"
  },
  {
    id: "csharp",
    label: "C#",
    title: "C# Language Server",
    description: "用于 C# 文件的符号和调用层级增强。",
    commandPlaceholder: "csharp-ls"
  },
  {
    id: "rust",
    label: "Rust",
    title: "Rust Language Server",
    description: "用于 Rust 文件的符号和调用层级增强。",
    commandPlaceholder: "rust-analyzer"
  }
] as const;

type LanguageServerId =
  (typeof LANGUAGE_SERVER_CONFIGURATIONS)[number]["id"];

export function ApplicationSettingsPage({
  gitEnvironment,
  terminalProfiles,
  appSettings,
  initialSection = "general"
}: ApplicationSettingsPageProps) {
  const initialSettingsSection = findSettingsSection(initialSection);
  const [section, setSection] =
    useState<ApplicationSettingsSection>(
      initialSettingsSection.id
    );
  const [settingsCard, setSettingsCard] = useState(
    initialSettingsSection.cards[0]?.id ?? ""
  );
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
  const [revealedAiKey, setRevealedAiKey] = useState<
    string | null
  >(null);
  const [aiKeyVisible, setAiKeyVisible] = useState(false);
  const [aiKeyLength, setAiKeyLength] = useState(0);
  const [aiKeyLoading, setAiKeyLoading] = useState(false);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiFeedback, setAiFeedback] = useState<{
    title: string;
    message: string;
    tone: "success" | "error";
  } | null>(null);
  const [analysisDraft, setAnalysisDraft] =
    useState<CodeAnalysisSettingsDto>(() =>
      cloneCodeAnalysisSettings(
        appSettings.settings.codeAnalysis
      )
    );
  const [mcpDraft, setMcpDraft] =
    useState<McpServerSettingsDto>(() => ({
      ...appSettings.settings.codeAnalysis.mcp
    }));
  const [selectedLanguageServer, setSelectedLanguageServer] =
    useState<LanguageServerId>("typescript");
  const aiDraftDirtyRef = useRef(false);
  const analysisDraftDirtyRef = useRef(false);
  const mcpDraftDirtyRef = useRef(false);
  const settingsScrollRef = useRef<HTMLDivElement>(null);
  const pendingSettingsCardScrollRef = useRef<string | null>(
    null
  );
  const programmaticSettingsCardRef = useRef<string | null>(null);
  const settingsScrollUnlockTimerRef = useRef<number | null>(
    null
  );
  const aiDraftVersionRef = useRef(0);
  const analysisDraftVersionRef = useRef(0);
  const mcpDraftVersionRef = useRef(0);
  const mcpResponseLimitValid =
    Number.isInteger(mcpDraft.maxResponseKb) &&
    mcpDraft.maxResponseKb >= MIN_MCP_MAX_RESPONSE_KB &&
    mcpDraft.maxResponseKb <= MAX_MCP_MAX_RESPONSE_KB;
  const mcpStaleAgeValid =
    Number.isInteger(mcpDraft.maxStaleAgeDays) &&
    mcpDraft.maxStaleAgeDays >=
      MIN_MCP_MAX_STALE_AGE_DAYS &&
    mcpDraft.maxStaleAgeDays <=
      MAX_MCP_MAX_STALE_AGE_DAYS;
  const periodicRefreshIntervalValid =
    Number.isInteger(
      analysisDraft.autoRefresh.periodicIntervalMinutes
    ) &&
    analysisDraft.autoRefresh.periodicIntervalMinutes >=
      MIN_CODE_ANALYSIS_PERIODIC_REFRESH_MINUTES &&
    analysisDraft.autoRefresh.periodicIntervalMinutes <=
      MAX_CODE_ANALYSIS_PERIODIC_REFRESH_MINUTES;

  const scrollToSettingsCard = useCallback(
    (cardId: string) => {
      const scrollHost = settingsScrollRef.current;
      const target = document.getElementById(cardId);
      if (!scrollHost || !target || !scrollHost.contains(target)) {
        return;
      }
      if (settingsScrollUnlockTimerRef.current !== null) {
        window.clearTimeout(
          settingsScrollUnlockTimerRef.current
        );
      }
      programmaticSettingsCardRef.current = cardId;
      const releaseScrollTracking = () => {
        if (programmaticSettingsCardRef.current !== cardId) {
          return;
        }
        programmaticSettingsCardRef.current = null;
        if (settingsScrollUnlockTimerRef.current !== null) {
          window.clearTimeout(
            settingsScrollUnlockTimerRef.current
          );
          settingsScrollUnlockTimerRef.current = null;
        }
      };
      scrollHost.addEventListener(
        "scrollend",
        releaseScrollTracking,
        { once: true }
      );
      settingsScrollUnlockTimerRef.current = window.setTimeout(
        releaseScrollTracking,
        900
      );
      const reducedMotion =
        window.matchMedia?.(
          "(prefers-reduced-motion: reduce)"
        ).matches ?? false;
      target.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "start"
      });
    },
    []
  );

  const selectSettingsCard = useCallback(
    (cardId: string) => {
      if (
        !findSettingsSection(section).cards.some(
          (card) => card.id === cardId
        )
      ) {
        return;
      }
      setSettingsCard(cardId);
      scrollToSettingsCard(cardId);
    },
    [scrollToSettingsCard, section]
  );

  const selectSettingsSection = useCallback(
    (nextSectionId: ApplicationSettingsSection) => {
      const nextSection = findSettingsSection(nextSectionId);
      const nextCardId = nextSection.cards[0]?.id ?? "";
      setSettingsCard(nextCardId);
      if (nextSection.id === section) {
        scrollToSettingsCard(nextCardId);
        return;
      }
      pendingSettingsCardScrollRef.current = nextCardId;
      setSection(nextSection.id);
    },
    [scrollToSettingsCard, section]
  );

  const syncSettingsCardFromScroll = useCallback(() => {
    const scrollHost = settingsScrollRef.current;
    if (
      !scrollHost ||
      programmaticSettingsCardRef.current !== null
    ) {
      return;
    }
    const cards = findSettingsSection(section).cards
      .map((card) => ({
        ...card,
        element: document.getElementById(card.id)
      }))
      .filter(
        (
          card
        ): card is SettingsCardLink & {
          element: HTMLElement;
        } =>
          card.element instanceof HTMLElement &&
          scrollHost.contains(card.element)
      );
    const firstCard = cards[0];
    if (!firstCard) {
      return;
    }

    const scrollHostTop =
      scrollHost.getBoundingClientRect().top;
    const activationLine =
      scrollHostTop +
      Math.min(
        120,
        Math.max(72, scrollHost.clientHeight * 0.18)
      );
    let nextCardId = firstCard.id;
    for (const card of cards) {
      if (
        card.element.getBoundingClientRect().top <=
        activationLine
      ) {
        nextCardId = card.id;
      }
    }
    const lastCard = cards[cards.length - 1];
    if (
      lastCard &&
      scrollHost.scrollHeight > scrollHost.clientHeight + 8 &&
      scrollHost.scrollHeight -
        scrollHost.scrollTop -
        scrollHost.clientHeight <=
      8
    ) {
      nextCardId = lastCard.id;
    }
    setSettingsCard((current) =>
      current === nextCardId ? current : nextCardId
    );
  }, [section]);

  useEffect(() => {
    const nextSection = findSettingsSection(initialSection);
    setSection(nextSection.id);
    setSettingsCard(nextSection.cards[0]?.id ?? "");
  }, [initialSection]);

  useEffect(() => {
    const pendingCardId =
      pendingSettingsCardScrollRef.current;
    if (!pendingCardId) {
      return;
    }
    pendingSettingsCardScrollRef.current = null;
    scrollToSettingsCard(pendingCardId);
  }, [scrollToSettingsCard, section]);

  useEffect(
    () => () => {
      if (settingsScrollUnlockTimerRef.current !== null) {
        window.clearTimeout(
          settingsScrollUnlockTimerRef.current
        );
      }
    },
    []
  );

  useEffect(() => {
    if (aiDraftDirtyRef.current) {
      return;
    }
    setAiUrl(appSettings.settings.ai.apiUrl);
    setAiModel(appSettings.settings.ai.model);
    setAiPrompt(appSettings.settings.ai.prompt);
    setAiEnabled(appSettings.settings.ai.enabled);
    setAiKey("");
    setRevealedAiKey(null);
    setAiKeyVisible(false);
  }, [appSettings.settings.ai]);

  useEffect(() => {
    if (section !== "ai") {
      setRevealedAiKey(null);
      setAiKeyVisible(false);
    }
  }, [section]);

  useEffect(() => {
    let active = true;
    if (!appSettings.settings.ai.apiKeyConfigured) {
      setAiKeyLength(0);
      return () => {
        active = false;
      };
    }
    void window.gitnest.settings
      .readAiApiKey({ reveal: false })
      .then((result) => {
        if (active && result.ok) {
          setAiKeyLength(result.value.length);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [appSettings.settings.ai]);

  useEffect(() => {
    if (analysisDraftDirtyRef.current) {
      return;
    }
    setAnalysisDraft(
      cloneCodeAnalysisSettings(
        appSettings.settings.codeAnalysis
      )
    );
  }, [appSettings.settings.codeAnalysis]);

  useEffect(() => {
    if (mcpDraftDirtyRef.current) {
      return;
    }
    setMcpDraft({
      ...appSettings.settings.codeAnalysis.mcp
    });
  }, [appSettings.settings.codeAnalysis.mcp]);

  const updateAnalysisDraft = (
    update: (
      current: CodeAnalysisSettingsDto
    ) => CodeAnalysisSettingsDto
  ) => {
    analysisDraftDirtyRef.current = true;
    analysisDraftVersionRef.current += 1;
    setAnalysisDraft(update);
  };

  const updateMcpDraft = (
    update: (current: McpServerSettingsDto) => McpServerSettingsDto
  ) => {
    mcpDraftDirtyRef.current = true;
    mcpDraftVersionRef.current += 1;
    setMcpDraft(update);
  };

  const markAiDraftDirty = () => {
    aiDraftDirtyRef.current = true;
    aiDraftVersionRef.current += 1;
  };

  const toggleAiKeyVisibility = async () => {
    if (aiKeyVisible) {
      setAiKeyVisible(false);
      setRevealedAiKey(null);
      return;
    }
    if (
      aiKey ||
      !appSettings.settings.ai.apiKeyConfigured
    ) {
      setAiKeyVisible(true);
      return;
    }

    setAiKeyLoading(true);
    setAiFeedback(null);
    try {
      const result =
        await window.gitnest.settings.readAiApiKey({
          reveal: true
        });
      if (!result.ok) {
        setAiFeedback({
          title: "无法显示 API Key",
          message: formatAiSettingsError(result.error),
          tone: "error"
        });
        return;
      }
      if (result.value.apiKey === null) {
        setAiFeedback({
          title: "无法显示 API Key",
          message: "未找到已保存的 API Key。",
          tone: "error"
        });
        return;
      }
      setAiKeyLength(result.value.length);
      setRevealedAiKey(result.value.apiKey);
      setAiKeyVisible(true);
    } catch (reason) {
      setAiFeedback({
        title: "无法显示 API Key",
        message:
          reason instanceof Error
            ? reason.message
            : "读取 API Key 失败。",
        tone: "error"
      });
    } finally {
      setAiKeyLoading(false);
    }
  };

  const saveAiSettings = async () => {
    const draftVersion = aiDraftVersionRef.current;
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
      if (draftVersion === aiDraftVersionRef.current) {
        aiDraftDirtyRef.current = false;
        setAiUrl(url);
        setAiModel(model);
        setAiPrompt(prompt);
        setAiKey("");
        setRevealedAiKey(null);
        setAiKeyVisible(false);
      }
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
    if (!periodicRefreshIntervalValid) {
      return;
    }
    const draftVersion =
      analysisDraftVersionRef.current;
    const saved = await appSettings.update(
      {
        codeAnalysis: cloneCodeAnalysisSettings(
          {
            ...analysisDraft,
            mcp: appSettings.settings.codeAnalysis.mcp
          }
        )
      },
      {
        notice:
          "LSP 与代码分析设置已保存；已有分析结果会在下次运行时按新设置重建。"
      }
    );
    if (
      saved &&
      draftVersion === analysisDraftVersionRef.current
    ) {
      analysisDraftDirtyRef.current = false;
    }
  };

  const saveMcpSettings = async () => {
    if (!mcpResponseLimitValid || !mcpStaleAgeValid) {
      return;
    }
    const draftVersion = mcpDraftVersionRef.current;
    const saved = await appSettings.update(
      {
        codeAnalysis: {
          mcp: { ...mcpDraft }
        }
      },
      { notice: "MCP 设置已保存。" }
    );
    if (saved && draftVersion === mcpDraftVersionRef.current) {
      mcpDraftDirtyRef.current = false;
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
  const aiKeyValue =
    revealedAiKey ??
    (aiKey ||
      (appSettings.settings.ai.apiKeyConfigured
        ? "*".repeat(aiKeyLength)
        : ""));
  const aiKeyReadOnly =
    appSettings.settings.ai.apiKeyConfigured &&
    revealedAiKey === null &&
    !aiKey;

  return (
    <SkeletonBoundary
      fallback={<ApplicationSettingsSkeleton />}
      hasContent={appSettings.loaded}
      label="正在读取应用设置"
      loading={appSettings.loading}
      surfaceClassName="page-scroll settings-page-scroll gn-page-skeleton application-settings-skeleton"
    >
      <div
        className="page-scroll settings-page-scroll"
        onScroll={syncSettingsCardFromScroll}
        ref={settingsScrollRef}
      >
        <div className="application-settings-page">
        <section className="page-heading">
          <div>
            <h1>设置</h1>
            <p>
              管理应用行为、AI、代码分析、Git 同步策略以及系统认证。
            </p>
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
            {SETTINGS_SECTIONS.map((item) => {
              const active = section === item.id;
              return (
                <div
                  className={`settings-nav-group${
                    active ? " is-active" : ""
                  }`}
                  key={item.id}
                >
                  <button
                    aria-controls={`settings-subnav-${item.id}`}
                    aria-current={active ? "page" : undefined}
                    aria-expanded={active}
                    className={`settings-nav-item${
                      active ? " active" : ""
                    }`}
                    onClick={() =>
                      selectSettingsSection(item.id)
                    }
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
                    <span
                      aria-hidden="true"
                      className="settings-nav-item-chevron"
                    >
                      <Icon name="chevron" size={14} />
                    </span>
                  </button>
                  {active && (
                    <div
                      aria-label={`${item.label}卡片`}
                      className="settings-nav-subnav"
                      id={`settings-subnav-${item.id}`}
                      role="group"
                    >
                      {item.cards.map((card) => (
                        <button
                          aria-current={
                            settingsCard === card.id
                              ? "location"
                              : undefined
                          }
                          className={`settings-nav-subitem${
                            settingsCard === card.id
                              ? " active"
                              : ""
                          }`}
                          key={card.id}
                          onClick={() =>
                            selectSettingsCard(card.id)
                          }
                          type="button"
                        >
                          {card.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          <section
            aria-live="polite"
            className="settings-content"
          >
            {section === "general" && (
              <>
                <SettingsCard
                  description="控制启动导航，并明确不可关闭的安全边界。"
                  id="settings-general-behavior"
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
                </SettingsCard>

                <SettingsCard
                  badge={`${terminalProfiles.length} 个可用`}
                  description="左侧活动栏的终端入口会使用这里解析出的默认终端。"
                  id="settings-general-terminal"
                  title="默认终端"
                >
                  <Select<ExternalTerminalProfileDto["kind"]>
                    ariaLabel="选择默认终端"
                    className="settings-terminal-select"
                    disabled={
                      appSettings.saving ||
                      terminalProfiles.length === 0
                    }
                    fullWidth
                    label="默认终端"
                    menuAriaLabel="默认终端选项"
                    onChange={(defaultTerminalKind) =>
                      void appSettings.update({
                        general: { defaultTerminalKind }
                      })
                    }
                    options={terminalProfiles.map((profile) => ({
                      label: profile.label,
                      leading: <Icon name="terminal" size={14} />,
                      value: profile.kind
                    }))}
                    placeholder="没有可用终端"
                    size="medium"
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
                  id="settings-general-preferences"
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
                      onClick={() => {
                        markAiDraftDirty();
                        setAiEnabled((enabled) => !enabled);
                      }}
                      type="button"
                    >
                      <span className="settings-switch-thumb" />
                    </button>
                  }
                  description="根据当前提交范围生成提交信息，结果仍由你确认后提交。"
                  id="settings-ai-commit-message"
                  title="AI 提交信息"
                >
                  <div className="settings-ai-field-grid">
                    <Input
                      autoComplete="url"
                      fullWidth
                      id="ai-api-url"
                      label="API URL"
                      maxLength={2048}
                      onChange={(event) => {
                        markAiDraftDirty();
                        setAiUrl(event.target.value);
                      }}
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
                      onChange={(event) => {
                        markAiDraftDirty();
                        setAiModel(event.target.value);
                      }}
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
                        ? "已有 Key 保存在 Windows 安全存储。"
                        : "Key 将通过 Windows 安全存储加密保存，不会写入 app-settings.json。"
                    }
                    id="ai-api-key"
                    label="API Key"
                    maxLength={8192}
                    onChange={(event) => {
                      markAiDraftDirty();
                      setRevealedAiKey(null);
                      setAiKey(event.target.value);
                    }}
                    placeholder={
                      appSettings.settings.ai.apiKeyConfigured
                        ? "已保存"
                        : "输入 API Key"
                    }
                    readOnly={aiKeyReadOnly}
                    spellCheck={false}
                    trailing={
                      <Button
                        aria-busy={aiKeyLoading}
                        aria-label={
                          aiKeyVisible
                            ? "隐藏 API Key"
                            : "显示 API Key"
                        }
                        aria-pressed={aiKeyVisible}
                        className="gn-input__action"
                        disabled={aiKeyLoading}
                        onClick={() =>
                          void toggleAiKeyVisibility()
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
                    value={aiKeyValue}
                  />
                  <Textarea
                    fullWidth
                    id="ai-commit-prompt"
                    label="提交信息提示词"
                    maxLength={12000}
                    onChange={(event) => {
                      markAiDraftDirty();
                      setAiPrompt(event.target.value);
                    }}
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
                  </div>
                </SettingsCard>
              </>
            )}

            {section === "git" && (
              <>
                <SettingsCard
                  badge={gitEnvironment ? "可用" : "不可用"}
                  badgeIcon={
                    gitEnvironment ? "check" : "warning"
                  }
                  badgeTone={gitEnvironment ? "green" : "red"}
                  description="查看当前 Git 版本与运行环境。"
                  id="settings-git-environment"
                  title="Git 运行环境"
                >
                  <div className="settings-info-grid">
                    <div className="settings-info-item">
                      <span className="settings-info-label">
                        Git 版本
                      </span>
                      <span
                        className="settings-info-value"
                        title={
                          gitEnvironment?.version ?? "未检测"
                        }
                      >
                        {gitEnvironment?.version ?? "未检测"}
                      </span>
                    </div>
                    <div className="settings-info-item">
                      <span className="settings-info-label">
                        执行文件
                      </span>
                      <span
                        className="settings-info-value"
                        title={
                          gitEnvironment?.executablePath ??
                          "不可用"
                        }
                      >
                        {gitEnvironment?.executablePath ?? "不可用"}
                      </span>
                    </div>
                  </div>
                </SettingsCard>

                <SettingsCard
                  description="选择应用启动并完成 Workspace 加载后的远程检查方式。"
                  id="settings-git-fetch"
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
                  id="settings-git-push"
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
                        updateAnalysisDraft((current) => ({
                          ...current,
                          enabled: !current.enabled
                        }))
                      }
                      type="button"
                    >
                      <span className="settings-switch-thumb" />
                    </button>
                  }
                  description="分析当前 Workspace，不在项目目录写入索引或配置。"
                  id="settings-analysis-overview"
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
                        updateAnalysisDraft((current) => ({
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
                        updateAnalysisDraft((current) => ({
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
                      updateAnalysisDraft((current) => ({
                        ...current,
                        staticFallback
                      }))
                    }
                  />
                  <SettingsToggle
                    checked={analysisDraft.autoRefresh.enabled}
                    description="后台读取 Git 变动文件并复用完整索引，同时刷新 MCP 全量快照与变动视图；完整索引不可复用时自动重建。"
                    disabled={appSettings.saving}
                    label="文件变更后增量更新"
                    onChange={(enabled) =>
                      updateAnalysisDraft((current) => ({
                        ...current,
                        autoRefresh: {
                          ...current.autoRefresh,
                          enabled
                        }
                      }))
                    }
                  />
                  <SettingsToggle
                    checked={
                      analysisDraft.autoRefresh.periodicEnabled
                    }
                    description="应用运行期间按间隔在后台更新分析快照；优先复用完整索引，无法复用时再执行全量分析。"
                    disabled={appSettings.saving}
                    label="定时更新分析快照"
                    onChange={(periodicEnabled) =>
                      updateAnalysisDraft((current) => ({
                        ...current,
                        autoRefresh: {
                          ...current.autoRefresh,
                          periodicEnabled
                        }
                      }))
                    }
                  />
                  <div className="mcp-registration-grid">
                    <Input
                      fullWidth
                      id="analysis-auto-refresh-debounce-ms"
                      label="自动刷新去抖（毫秒）"
                      max={MAX_CODE_ANALYSIS_AUTO_REFRESH_DEBOUNCE_MS}
                      min={MIN_CODE_ANALYSIS_AUTO_REFRESH_DEBOUNCE_MS}
                      onChange={(event) => {
                        const parsed = Number(event.target.value);
                        if (!Number.isFinite(parsed)) {
                          return;
                        }
                        updateAnalysisDraft((current) => ({
                          ...current,
                          autoRefresh: {
                            ...current.autoRefresh,
                            debounceMs: parsed
                          }
                        }));
                      }}
                      reserveHelpSpace
                      type="number"
                      value={analysisDraft.autoRefresh.debounceMs}
                    />
                    <Input
                      disabled={
                        appSettings.saving ||
                        !analysisDraft.autoRefresh.periodicEnabled
                      }
                      fullWidth
                      helpText={
                        periodicRefreshIntervalValid
                          ? "最短 5 分钟；更新在后台运行，不切换当前代码分析视图。"
                          : `请输入 ${MIN_CODE_ANALYSIS_PERIODIC_REFRESH_MINUTES}～${MAX_CODE_ANALYSIS_PERIODIC_REFRESH_MINUTES} 之间的整数。`
                      }
                      id="analysis-periodic-refresh-minutes"
                      label="定时更新间隔（分钟）"
                      max={
                        MAX_CODE_ANALYSIS_PERIODIC_REFRESH_MINUTES
                      }
                      min={
                        MIN_CODE_ANALYSIS_PERIODIC_REFRESH_MINUTES
                      }
                      onChange={(event) => {
                        const parsed = Number(event.target.value);
                        if (!Number.isFinite(parsed)) {
                          return;
                        }
                        updateAnalysisDraft((current) => ({
                          ...current,
                          autoRefresh: {
                            ...current.autoRefresh,
                            periodicIntervalMinutes: parsed
                          }
                        }));
                      }}
                      reserveHelpSpace
                      state={
                        periodicRefreshIntervalValid
                          ? "default"
                          : "error"
                      }
                      step={1}
                      type="number"
                      value={
                        analysisDraft.autoRefresh
                          .periodicIntervalMinutes
                      }
                    />
                  </div>
                </SettingsCard>

                <SettingsCard
                  description="限制大型项目的文件读取、内存占用和关系图展开规模。"
                  id="settings-analysis-budget"
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
                        updateAnalysisDraft((current) => ({
                          ...current,
                          maxFiles: Number(event.target.value)
                        }))
                      }
                      reserveHelpSpace
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
                        updateAnalysisDraft((current) => ({
                          ...current,
                          maxFileSizeKb: Number(
                            event.target.value
                          )
                        }))
                      }
                      reserveHelpSpace
                      type="number"
                      value={analysisDraft.maxFileSizeKb}
                    />
                    <Input
                      fullWidth
                      helpText="限制本轮读取的源码总量，避免大型 Workspace 占用过多内存。"
                      id="analysis-max-total-source"
                      label="源码总量上限（MiB）"
                      max={MAX_CODE_ANALYSIS_TOTAL_SOURCE_MB}
                      min={MIN_CODE_ANALYSIS_TOTAL_SOURCE_MB}
                      onChange={(event) =>
                        updateAnalysisDraft((current) => ({
                          ...current,
                          maxTotalSourceMb: Number(
                            event.target.value
                          )
                        }))
                      }
                      reserveHelpSpace
                      type="number"
                      value={analysisDraft.maxTotalSourceMb}
                    />
                    <Input
                      fullWidth
                      helpText="提高上限会增加分析耗时、内存占用和快照体积。"
                      id="analysis-max-graph-nodes"
                      label="关系图节点上限"
                      max={MAX_CODE_ANALYSIS_GRAPH_NODES}
                      min={MIN_CODE_ANALYSIS_GRAPH_NODES}
                      onChange={(event) =>
                        updateAnalysisDraft((current) => ({
                          ...current,
                          maxGraphNodes: Number(
                            event.target.value
                          )
                        }))
                      }
                      reserveHelpSpace
                      step={1000}
                      type="number"
                      value={analysisDraft.maxGraphNodes}
                    />
                    <Input
                      fullWidth
                      helpText="限制调用、引用、包含等关系边总量。"
                      id="analysis-max-graph-edges"
                      label="关系图边上限"
                      max={MAX_CODE_ANALYSIS_GRAPH_EDGES}
                      min={MIN_CODE_ANALYSIS_GRAPH_EDGES}
                      onChange={(event) =>
                        updateAnalysisDraft((current) => ({
                          ...current,
                          maxGraphEdges: Number(
                            event.target.value
                          )
                        }))
                      }
                      reserveHelpSpace
                      step={1000}
                      type="number"
                      value={analysisDraft.maxGraphEdges}
                    />
                    <Input
                      fullWidth
                      helpText="限制最终保存并展示的请求链数量。"
                      id="analysis-max-request-chains"
                      label="请求链上限"
                      max={MAX_CODE_ANALYSIS_REQUEST_CHAINS}
                      min={MIN_CODE_ANALYSIS_REQUEST_CHAINS}
                      onChange={(event) =>
                        updateAnalysisDraft((current) => ({
                          ...current,
                          maxRequestChains: Number(
                            event.target.value
                          )
                        }))
                      }
                      reserveHelpSpace
                      step={100}
                      type="number"
                      value={analysisDraft.maxRequestChains}
                    />
                    <Input
                      fullWidth
                      helpText="限制本轮保留的分析提示和诊断数量。"
                      id="analysis-max-diagnostics"
                      label="分析提示上限"
                      max={MAX_CODE_ANALYSIS_DIAGNOSTICS}
                      min={MIN_CODE_ANALYSIS_DIAGNOSTICS}
                      onChange={(event) =>
                        updateAnalysisDraft((current) => ({
                          ...current,
                          maxDiagnostics: Number(
                            event.target.value
                          )
                        }))
                      }
                      reserveHelpSpace
                      step={100}
                      type="number"
                      value={analysisDraft.maxDiagnostics}
                    />
                    <Input
                      fullWidth
                      id="analysis-concurrency"
                      label="读取并发数"
                      max={4}
                      min={1}
                      onChange={(event) =>
                        updateAnalysisDraft((current) => ({
                          ...current,
                          readConcurrency: Number(
                            event.target.value
                          )
                        }))
                      }
                      reserveHelpSpace
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
                        updateAnalysisDraft((current) => ({
                          ...current,
                          graphDepth: Number(
                            event.target.value
                          )
                        }))
                      }
                      reserveHelpSpace
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
                        updateAnalysisDraft((current) => ({
                          ...current,
                          lspTimeoutMs: Number(
                            event.target.value
                          )
                        }))
                      }
                      reserveHelpSpace
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
                      updateAnalysisDraft((current) => ({
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
                      后台刷新优先复用完整索引；只有索引不可复用时才重建全部代码。
                    </p>
                    <Button
                      aria-busy={appSettings.saving}
                      disabled={
                        appSettings.saving ||
                        !periodicRefreshIntervalValid
                      }
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

                <LanguageServerSettingsPanel
                  disabled={appSettings.saving}
                  onChange={(language, settings) =>
                    updateAnalysisDraft((current) =>
                      updateLanguageServerSettings(
                        current,
                        language,
                        settings
                      )
                    )
                  }
                  onSelectLanguage={(language) =>
                    setSelectedLanguageServer(language)
                  }
                  selectedLanguage={selectedLanguageServer}
                  settings={analysisDraft}
                />
                <SettingsCard
                  action={
                    <SettingsSwitch
                      checked={mcpDraft.enabled}
                      disabled={appSettings.saving}
                      label="启用 MCP 服务"
                      onChange={(enabled) =>
                        updateMcpDraft((current) => ({
                          ...current,
                          enabled
                        }))
                      }
                    />
                  }
                  description="将代码分析快照提供给本机 MCP 客户端；关闭后仅停止返回 MCP 数据，不影响 GitNest 内的代码分析。"
                  id="settings-analysis-mcp"
                  title="MCP 服务"
                >
                  <div className="mcp-registration-grid">
                    <Input
                      disabled={appSettings.saving}
                      fullWidth
                      helpText={
                        mcpResponseLimitValid
                          ? ""
                          : `请输入 ${MIN_MCP_MAX_RESPONSE_KB}～${MAX_MCP_MAX_RESPONSE_KB} 之间的整数。`
                      }
                      id="analysis-mcp-response-kb"
                      label="单次响应上限（KiB）"
                      min={MIN_MCP_MAX_RESPONSE_KB}
                      max={MAX_MCP_MAX_RESPONSE_KB}
                      onChange={(event) => {
                        const parsed = Number(event.target.value);
                        if (!Number.isFinite(parsed)) {
                          return;
                        }
                        updateMcpDraft((current) => ({
                          ...current,
                          maxResponseKb: parsed
                        }));
                      }}
                      reserveHelpSpace
                      step={1}
                      state={
                        mcpResponseLimitValid ? "default" : "error"
                      }
                      type="number"
                      value={mcpDraft.maxResponseKb}
                    />
                    <Input
                      disabled={appSettings.saving}
                      fullWidth
                      helpText={
                        mcpStaleAgeValid
                          ? "仅限制已确认陈旧或无法验证的快照；与当前源码一致的快照不会因时间过期。"
                          : `请输入 ${MIN_MCP_MAX_STALE_AGE_DAYS}～${MAX_MCP_MAX_STALE_AGE_DAYS} 之间的整数。`
                      }
                      id="analysis-mcp-max-stale-age-days"
                      label="陈旧快照最长使用（天）"
                      max={MAX_MCP_MAX_STALE_AGE_DAYS}
                      min={MIN_MCP_MAX_STALE_AGE_DAYS}
                      onChange={(event) => {
                        const parsed = Number(event.target.value);
                        if (!Number.isFinite(parsed)) {
                          return;
                        }
                        updateMcpDraft((current) => ({
                          ...current,
                          maxStaleAgeDays: parsed
                        }));
                      }}
                      reserveHelpSpace
                      state={
                        mcpStaleAgeValid ? "default" : "error"
                      }
                      step={1}
                      type="number"
                      value={mcpDraft.maxStaleAgeDays}
                    />
                  </div>
                  <div className="settings-ai-actions">
                    <Button
                      aria-busy={appSettings.saving}
                      disabled={
                        appSettings.saving ||
                        !mcpResponseLimitValid ||
                        !mcpStaleAgeValid
                      }
                      onClick={() => void saveMcpSettings()}
                      size="small"
                      type="button"
                      variant="primary"
                    >
                      <Icon name="check" />
                      保存 MCP 设置
                    </Button>
                  </div>
                </SettingsCard>

                <McpRegistrationPanel />
              </>
            )}

            {section === "account" && (
              <AccountAuthSettings
                cardId="settings-account-system"
                embedded
                gitEnvironment={gitEnvironment}
                terminalProfiles={terminalProfiles}
              />
            )}
          </section>
        </div>
      </div>

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
                    <Skeleton height={32} width={96} />
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

function LanguageServerSettingsPanel({
  settings,
  selectedLanguage,
  disabled,
  onSelectLanguage,
  onChange
}: {
  settings: CodeAnalysisSettingsDto;
  selectedLanguage: LanguageServerId;
  disabled: boolean;
  onSelectLanguage(language: LanguageServerId): void;
  onChange(
    language: LanguageServerId,
    settings: LanguageServerCommandSettingsDto
  ): void;
}) {
  const configuration =
    LANGUAGE_SERVER_CONFIGURATIONS.find(
      ({ id }) => id === selectedLanguage
    ) ?? LANGUAGE_SERVER_CONFIGURATIONS[0];
  const languageSettings = resolvedLanguageServerSettings(
    settings,
    selectedLanguage
  );
  const fieldId = `${configuration.id}-language-server`;

  return (
    <SettingsCard
      description="在同一区域切换并配置各语言 Server；未显示的配置和未保存草稿会继续保留。"
      id="settings-analysis-language-servers"
      title="Language Server 配置"
    >
      <nav
        aria-label="Language Server 配置导航"
        className="settings-lsp-breadcrumb"
      >
        <ol>
          {LANGUAGE_SERVER_CONFIGURATIONS.map(
            (server, index) => {
              const serverSettings =
                resolvedLanguageServerSettings(
                  settings,
                  server.id
                );
              return (
                <li key={server.id}>
                  {index > 0 && (
                    <span
                      aria-hidden="true"
                      className="settings-lsp-breadcrumb-separator"
                    >
                      &gt;
                    </span>
                  )}
                  <button
                    aria-current={
                      server.id === selectedLanguage
                        ? "page"
                        : undefined
                    }
                    aria-label={`${server.label}，${
                      serverSettings.enabled
                        ? "已启用"
                        : "已停用"
                    }`}
                    data-language-server-id={server.id}
                    onClick={() =>
                      onSelectLanguage(server.id)
                    }
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className={`settings-lsp-breadcrumb-state${
                        serverSettings.enabled
                          ? " enabled"
                          : ""
                      }`}
                    />
                    <span>{server.label}</span>
                  </button>
                </li>
              );
            }
          )}
        </ol>
      </nav>

      <div
        aria-label={`${configuration.title} 配置`}
        className="settings-lsp-editor"
        role="region"
      >
        <div className="settings-lsp-editor-header">
          <div>
            <h3 className="settings-lsp-editor-title">
              {configuration.title}
            </h3>
            <p className="settings-lsp-editor-description">
              {configuration.description}
            </p>
          </div>
          <button
            aria-label={`启用 ${configuration.title}`}
            aria-pressed={languageSettings.enabled}
            className={`settings-switch${
              languageSettings.enabled ? " active" : ""
            }`}
            disabled={disabled}
            onClick={() =>
              onChange(selectedLanguage, {
                ...languageSettings,
                enabled: !languageSettings.enabled
              })
            }
            type="button"
          >
            <span className="settings-switch-thumb" />
          </button>
        </div>

        <div className="settings-lsp-editor-fields">
          <Input
            autoComplete="off"
            fullWidth
            id={`lsp-command-${fieldId}`}
            label="启动命令"
            maxLength={2048}
            onChange={(event) =>
              onChange(selectedLanguage, {
                ...languageSettings,
                command: event.target.value
              })
            }
            placeholder={configuration.commandPlaceholder}
            spellCheck={false}
            value={languageSettings.command}
          />
          <Textarea
            fullWidth
            helpText="每行一个参数；自定义命令保存时需在系统窗口确认，进程通过 stdio 启动。"
            id={`lsp-args-${fieldId}`}
            label="启动参数"
            onChange={(event) =>
              onChange(selectedLanguage, {
                ...languageSettings,
                args: splitLines(event.target.value)
              })
            }
            placeholder={
              configuration.id === "java"
                ? "通常留空，GitNest 会自动追加 -data"
                : "--stdio"
            }
            rows={4}
            value={languageSettings.args.join("\n")}
          />

          <section
            aria-label={`${configuration.title} 高级预算`}
            className="settings-lsp-budget"
          >
            <div className="settings-lsp-budget-heading">
              <h4>高级预算</h4>
              <p>
                控制该语言每轮分析的文档覆盖和语义请求数量；达到上限后会在分析状态中提示。
              </p>
            </div>
            <div className="analysis-settings-number-grid">
              <Input
                fullWidth
                helpText="本轮最多送入该 Language Server 的文件数。"
                id={`lsp-max-documents-${fieldId}`}
                label="文档上限"
                max={MAX_LSP_DOCUMENTS}
                min={MIN_LSP_DOCUMENTS}
                onChange={(event) =>
                  onChange(selectedLanguage, {
                    ...languageSettings,
                    maxDocuments: Number(event.target.value)
                  })
                }
                reserveHelpSpace
                type="number"
                value={languageSettings.maxDocuments}
              />
              <Input
                fullWidth
                helpText="限制单个文件接收并保留的符号数量。"
                id={`lsp-max-symbols-${fieldId}`}
                label="单文档符号上限"
                max={MAX_LSP_SYMBOLS_PER_DOCUMENT}
                min={MIN_LSP_SYMBOLS_PER_DOCUMENT}
                onChange={(event) =>
                  onChange(selectedLanguage, {
                    ...languageSettings,
                    maxSymbolsPerDocument: Number(
                      event.target.value
                    )
                  })
                }
                reserveHelpSpace
                step={100}
                type="number"
                value={languageSettings.maxSymbolsPerDocument}
              />
              <Input
                fullWidth
                helpText="限制调用层级查询次数，0 表示本轮不发起调用层级查询。"
                id={`lsp-max-call-hierarchy-${fieldId}`}
                label="调用层级请求上限"
                max={MAX_LSP_REQUESTS}
                min={MIN_LSP_REQUESTS}
                onChange={(event) =>
                  onChange(selectedLanguage, {
                    ...languageSettings,
                    maxCallHierarchyRequests: Number(
                      event.target.value
                    )
                  })
                }
                reserveHelpSpace
                type="number"
                value={
                  languageSettings.maxCallHierarchyRequests
                }
              />
              <Input
                fullWidth
                helpText="限制类型层级和实现关系查询次数，0 表示本轮不补充继承、实现和重写关系。"
                id={`lsp-max-type-hierarchy-${fieldId}`}
                label="类型关系请求上限"
                max={MAX_LSP_REQUESTS}
                min={MIN_LSP_REQUESTS}
                onChange={(event) =>
                  onChange(selectedLanguage, {
                    ...languageSettings,
                    maxTypeHierarchyRequests: Number(
                      event.target.value
                    )
                  })
                }
                reserveHelpSpace
                type="number"
                value={
                  languageSettings.maxTypeHierarchyRequests ??
                  languageSettings.maxCallHierarchyRequests
                }
              />
              <Input
                fullWidth
                helpText="限制查找引用请求次数，0 表示本轮不发起引用查询。"
                id={`lsp-max-reference-requests-${fieldId}`}
                label="引用查询请求上限"
                max={MAX_LSP_REQUESTS}
                min={MIN_LSP_REQUESTS}
                onChange={(event) =>
                  onChange(selectedLanguage, {
                    ...languageSettings,
                    maxReferenceRequests: Number(
                      event.target.value
                    )
                  })
                }
                reserveHelpSpace
                type="number"
                value={languageSettings.maxReferenceRequests}
              />
              <Input
                fullWidth
                helpText="限制悬停文档查询次数，0 表示本轮不补充文档说明。"
                id={`lsp-max-documentation-${fieldId}`}
                label="文档查询请求上限"
                max={MAX_LSP_REQUESTS}
                min={MIN_LSP_REQUESTS}
                onChange={(event) =>
                  onChange(selectedLanguage, {
                    ...languageSettings,
                    maxDocumentationRequests: Number(
                      event.target.value
                    )
                  })
                }
                reserveHelpSpace
                type="number"
                value={
                  languageSettings.maxDocumentationRequests
                }
              />
              <Input
                fullWidth
                helpText="限制单个符号返回并保留的引用位置数量。"
                id={`lsp-max-references-per-symbol-${fieldId}`}
                label="单符号引用上限"
                max={MAX_LSP_REFERENCES_PER_SYMBOL}
                min={MIN_LSP_REFERENCES_PER_SYMBOL}
                onChange={(event) =>
                  onChange(selectedLanguage, {
                    ...languageSettings,
                    maxReferencesPerSymbol: Number(
                      event.target.value
                    )
                  })
                }
                reserveHelpSpace
                type="number"
                value={languageSettings.maxReferencesPerSymbol}
              />
            </div>
          </section>
        </div>
      </div>
    </SettingsCard>
  );
}

function SettingsCard({
  title,
  description,
  id,
  badge,
  badgeIcon,
  badgeTone = "neutral",
  action,
  children
}: {
  title: string;
  description: string;
  id?: string;
  badge?: string;
  badgeIcon?: IconName;
  badgeTone?: "neutral" | "blue" | "green" | "yellow" | "red";
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <article className="panel settings-card" id={id}>
      <header className="settings-card-header">
        <div>
          <div className="settings-card-title">{title}</div>
          <div className="settings-card-description">
            {description}
          </div>
        </div>
        {action}
        {badge && (
          <span className={`status-pill ${badgeTone}`}>
            {badgeIcon && <Icon name={badgeIcon} size={12} />}
            {badge}
          </span>
        )}
      </header>
      <div className="settings-card-body">{children}</div>
    </article>
  );
}

function cloneCodeAnalysisSettings(
  settings: CodeAnalysisSettingsDto
): CodeAnalysisSettingsDto {
  const defaults = createDefaultCodeAnalysisSettings();
  return {
    ...settings,
    ignoreDirectories: [...settings.ignoreDirectories],
    autoRefresh: {
      ...settings.autoRefresh
    },
    mcp: {
      ...settings.mcp
    },
    typescript: {
      ...settings.typescript,
      args: [...settings.typescript.args]
    },
    java: {
      ...settings.java,
      args: [...settings.java.args]
    },
    vue: cloneLanguageServerSettings(
      settings.vue ?? defaults.vue!
    ),
    python: cloneLanguageServerSettings(
      settings.python ?? defaults.python!
    ),
    go: cloneLanguageServerSettings(
      settings.go ?? defaults.go!
    ),
    kotlin: cloneLanguageServerSettings(
      settings.kotlin ?? defaults.kotlin!
    ),
    csharp: cloneLanguageServerSettings(
      settings.csharp ?? defaults.csharp!
    ),
    rust: cloneLanguageServerSettings(
      settings.rust ?? defaults.rust!
    )
  };
}

function cloneLanguageServerSettings(
  settings: LanguageServerCommandSettingsDto
): LanguageServerCommandSettingsDto {
  return {
    ...settings,
    args: [...settings.args]
  };
}

function resolvedLanguageServerSettings(
  settings: CodeAnalysisSettingsDto,
  language: LanguageServerId
): LanguageServerCommandSettingsDto {
  const defaults = createDefaultCodeAnalysisSettings();
  return (
    settings[language] ??
    defaults[language]!
  );
}

function updateLanguageServerSettings(
  settings: CodeAnalysisSettingsDto,
  language: LanguageServerId,
  languageSettings: LanguageServerCommandSettingsDto
): CodeAnalysisSettingsDto {
  return {
    ...settings,
    [language]: languageSettings
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
      <SettingsSwitch
        checked={checked}
        disabled={disabled}
        label={label}
        onChange={onChange}
      />
    </div>
  );
}

function SettingsSwitch({
  checked,
  disabled,
  label,
  onChange
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange(value: boolean): void;
}) {
  return (
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

function McpRegistrationPanel() {
  const [status, setStatus] = useState<McpRegistrationStatusDto | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    title: string;
    message: string;
    tone: "success" | "error";
  } | null>(null);

  const load = useCallback(async () => {
    const bridge = window.gitnest?.codeAnalysis;
    if (!bridge || typeof bridge.getMcpRegistration !== "function") {
      setFeedback({
        title: "无法读取 MCP 注册状态",
        message: "当前环境无法读取 MCP 注册状态。",
        tone: "error"
      });
      return;
    }
    try {
      const result = await bridge.getMcpRegistration();
      if (result.ok) {
        setStatus(result.value);
        setFeedback(
          result.value.serverAvailable &&
            result.value.codexAvailable
            ? null
            : {
                title: "Codex 连接不可用",
                message: result.value.message,
                tone: "error"
              }
        );
      } else {
        setFeedback({
          title: "无法读取 MCP 注册状态",
          message: result.error.message,
          tone: "error"
        });
      }
    } catch (reason) {
      setFeedback({
        title: "无法读取 MCP 注册状态",
        message:
          reason instanceof Error
            ? reason.message
            : "无法读取 MCP 注册状态。",
        tone: "error"
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (registered: boolean) => {
    setBusy(true);
    setFeedback(null);
    try {
      const bridge = window.gitnest?.codeAnalysis;
      if (!bridge || typeof bridge.setMcpRegistration !== "function") {
        setFeedback({
          title: registered ? "MCP 注册失败" : "MCP 卸载失败",
          message: "当前环境无法修改 MCP 注册状态。",
          tone: "error"
        });
        return;
      }
      const result = await bridge.setMcpRegistration({
        registered
      });
      if (result.ok) {
        setStatus(result.value);
        setFeedback({
          title: registered ? "MCP 已注册" : "MCP 已卸载",
          message: result.value.message,
          tone: "success"
        });
      } else {
        setFeedback({
          title: registered ? "MCP 注册失败" : "MCP 卸载失败",
          message: result.error.message,
          tone: "error"
        });
      }
    } catch (reason) {
      setFeedback({
        title: registered ? "MCP 注册失败" : "MCP 卸载失败",
        message:
          reason instanceof Error
            ? reason.message
            : "MCP 注册操作失败。",
        tone: "error"
      });
    } finally {
      setBusy(false);
    }
  };

  const registrationBadge =
    status === null
      ? feedback
        ? "状态不可用"
        : "正在读取"
      : status.registered
        ? "已注册"
        : status.serverAvailable && status.codexAvailable
          ? "未注册"
          : "注册不可用";
  const registrationBadgeTone =
    status?.registered
      ? "green"
      : status === null
        ? feedback
          ? "red"
          : "neutral"
        : status.serverAvailable && status.codexAvailable
          ? "neutral"
          : "red";

  return (
    <>
      <ToastViewport>
        {feedback && (
          <Toast
            closeLabel="关闭 MCP 注册提示"
            key="mcp-registration-feedback"
            message={feedback.message}
            onClose={() => setFeedback(null)}
            title={feedback.title}
            tone={feedback.tone}
          />
        )}
      </ToastViewport>
      <SettingsCard
        badge={registrationBadge}
        badgeTone={registrationBadgeTone}
        description="管理本机 Codex 的 GitNest MCP 注册。"
        id="settings-analysis-codex"
        title="Codex 连接"
      >
        <div className="mcp-registration">
          <div className="mcp-registration-path">
            <span>名称</span>
            <code>GitNest_code_lsp</code>
          </div>
          {status ? (
            <div className="mcp-registration-path">
              <span>数据目录</span>
              <code>{status.dataDirectory}</code>
            </div>
          ) : null}
          <div className="mcp-registration-actions">
            <Button
              disabled={
                busy ||
                !status?.codexAvailable ||
                (!status.registered && !status.serverAvailable)
              }
              onClick={() => void toggle(!status?.registered)}
              size="small"
              type="button"
            >
              <Icon
                name={status?.registered ? "minus" : "plus"}
              />
              {status?.registered ? "卸载" : "一键注册"}
            </Button>
          </div>
        </div>
      </SettingsCard>
    </>
  );
}

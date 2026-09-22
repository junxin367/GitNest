import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type {
  AppSettingsDto,
  CodeAnalysisDiagnosticDto,
  CodeAnalysisSnapshotDto,
  CodeAnalysisScopeDto,
  CodeGraphNodeDto,
  CodeRequestChainDto,
  ExternalApplicationKindDto,
  InstallableLanguageServerDto,
  LanguageServerLanguageDto,
  RepositoryDiffDto,
  WorkspaceDetailsDto
} from "@gitnest/contracts";

import { useCodeAnalysis } from "../../entities/code-analysis/useCodeAnalysis";
import { useExternalApplications } from "../../features/external-application/useExternalApplications";
import { Button } from "../../shared/ui/Button";
import { Icon } from "../../shared/ui/Icon";
import { Input } from "../../shared/ui/Input";
import {
  isEventInsideMenu,
  MenuItem,
  MenuPopover
} from "../../shared/ui/Menu";
import {
  Skeleton,
  SkeletonBoundary
} from "../../shared/ui/Skeleton";
import { Toast, ToastViewport } from "../../shared/ui/Toast";
import {
  DiffPanel,
  type DiffPanelState
} from "../../widgets/diff-workspace/DiffPanel";
import { repositoryDiffWorkspaceConfiguration } from "../../widgets/diff-workspace/diffWorkspaceConfiguration";
import {
  codeNodeDisplayName,
  countSearchableCodeNodes,
  deduplicateRequestChains,
  filterChainsWithMetadata,
  MAX_VISIBLE_CODE_NODES,
  MAX_VISIBLE_REQUEST_CHAINS,
  searchCodeNodesWithMetadata
} from "./codeAnalysisNavigation";
import { CodeRelationGraph } from "./CodeRelationGraph";
import { NodeSourceViewer } from "./NodeSourceViewer";
import { useCodeNodeDiff } from "./useCodeNodeDiff";

interface CodeAnalysisPageProps {
  workspace: WorkspaceDetailsDto | null;
  settings: AppSettingsDto;
  onOpenSettings(): void;
  onReloadSettings(): Promise<void>;
}

type AnalysisNavigationMode = "chains" | "symbols";

interface AnalysisProgressPresentation {
  stage: string;
  message: string;
  startedAt: string | undefined;
  completed: number;
  total: number;
  ratio: number;
  countLabel: string;
}

interface AnalysisNotice {
  title: string;
  message: string;
  tone: "success" | "error" | "info";
}

const ANALYSIS_METHOD_OPTIONS = [
  { value: "all", label: "全部类型" },
  { value: "GET", label: "GET" },
  { value: "POST", label: "POST" },
  { value: "PUT", label: "PUT" },
  { value: "DELETE", label: "DELETE" },
  { value: "PATCH", label: "PATCH" },
  { value: "RPC", label: "RPC" }
] as const;

type AnalysisFocus =
  | {
      kind: "chain";
      id: string;
    }
  | {
      kind: "node";
      id: string;
    }
  | null;

export function CodeAnalysisPage({
  workspace,
  settings,
  onOpenSettings,
  onReloadSettings
}: CodeAnalysisPageProps) {
  const analysis = useCodeAnalysis(true);
  const [scope, setScope] =
    useState<CodeAnalysisScopeDto>(
      settings.codeAnalysis.defaultScope
    );
  const [navigationMode, setNavigationMode] =
    useState<AnalysisNavigationMode>("chains");
  const [chainQuery, setChainQuery] = useState("");
  const [nodeQuery, setNodeQuery] = useState("");
  const [method, setMethod] = useState("all");
  const chainFilterRef = useRef<HTMLInputElement>(null);
  const nodeFilterRef = useRef<HTMLInputElement>(null);
  const [graphFocus, setGraphFocus] =
    useState<AnalysisFocus>(null);
  const [
    graphSelectionCleared,
    setGraphSelectionCleared
  ] = useState(false);
  const [inspectedNodeId, setInspectedNodeId] = useState<
    string | null
  >(null);
  const [nodeFileExpanded, setNodeFileExpanded] =
    useState(false);
  const [graphFullscreen, setGraphFullscreen] =
    useState(false);
  const [installNotice, setInstallNotice] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const [actionNotice, setActionNotice] =
    useState<AnalysisNotice | null>(null);
  const selectedEntry =
    workspace?.entries.find(
      (entry) => entry.id === workspace.selectedEntryId
    ) ??
    workspace?.entries[0];
  const availableSnapshot = analysis.snapshot;
  const snapshot =
    availableSnapshot?.scope === scope &&
    availableSnapshot.workspaceId ===
      analysis.state.workspaceId &&
    availableSnapshot.entryId === analysis.state.entryId &&
    (
      analysis.state.state !== "ready" ||
      (
        availableSnapshot.analysisId ===
          analysis.state.analysisId &&
        availableSnapshot.generatedAt ===
          analysis.state.generatedAt
      )
    )
      ? availableSnapshot
      : null;
  const requestChains = useMemo(
    () =>
      deduplicateRequestChains(
        snapshot?.requestChains ?? []
      ),
    [snapshot?.requestChains]
  );
  const chainFilterResult = useMemo(
    () =>
      filterChainsWithMetadata(
        requestChains,
        snapshot?.nodes ?? [],
        chainQuery,
        method,
        MAX_VISIBLE_REQUEST_CHAINS
      ),
    [
      chainQuery,
      method,
      requestChains,
      snapshot?.nodes
    ]
  );
  const chains = chainFilterResult.chains;
  const nodeFilterResult = useMemo(
    () =>
      searchCodeNodesWithMetadata(
        snapshot?.nodes ?? [],
        nodeQuery,
        MAX_VISIBLE_CODE_NODES
      ),
    [nodeQuery, snapshot?.nodes]
  );
  const nodeResults = nodeFilterResult.nodes;
  const searchableNodeCount = useMemo(
    () => countSearchableCodeNodes(snapshot?.nodes ?? []),
    [snapshot?.nodes]
  );
  const selectedChain =
    graphFocus?.kind === "chain"
      ? requestChains.find(
          (chain) => chain.id === graphFocus.id
        ) ?? null
      : null;
  const graphFocusNodeId =
    graphFocus?.kind === "node"
      ? graphFocus.id
      : selectedChain?.clientNodeId ?? null;
  const graphFocusNode =
    snapshot?.nodes.find(
      (node) => node.id === graphFocusNodeId
    ) ?? null;
  const selectedNode = snapshot?.nodes.find(
    (node) => node.id === inspectedNodeId
  ) ?? null;
  const graphSelectedNodeId = graphSelectionCleared
    ? null
    : selectedNode?.id ?? graphFocusNodeId;
  const externalApplications = useExternalApplications(
    selectedNode
      ? {
          scope: "repository",
          target: {
            repositoryId:
              selectedNode.location.repositoryId,
            worktreeId: selectedNode.location.worktreeId
          }
        }
      : undefined
  );
  const editorProfile = useMemo(() => {
    const editors = externalApplications.profiles.filter(
      (profile) => isEditorApplication(profile.kind)
    );
    return (
      editors.find(
        (profile) =>
          profile.kind ===
          externalApplications.preferredProfile?.kind
      ) ?? editors[0]
    );
  }, [
    externalApplications.preferredProfile?.kind,
    externalApplications.profiles
  ]);

  useEffect(() => {
    if (!availableSnapshot) {
      setScope(settings.codeAnalysis.defaultScope);
    }
  }, [
    availableSnapshot,
    settings.codeAnalysis.defaultScope
  ]);

  useEffect(() => {
    if (
      availableSnapshot &&
      analysis.state.state !== "running" &&
      (
        analysis.state.state !== "ready" ||
        !analysis.state.analysisId ||
        (
          availableSnapshot.analysisId ===
            analysis.state.analysisId &&
          availableSnapshot.generatedAt ===
            analysis.state.generatedAt
        )
      )
    ) {
      setScope(availableSnapshot.scope);
    }
  }, [
    analysis.state.state,
    analysis.state.analysisId,
    analysis.state.generatedAt,
    availableSnapshot?.analysisId,
    availableSnapshot?.generatedAt,
    availableSnapshot?.scope
  ]);

  useEffect(() => {
    if (!snapshot) {
      setGraphFocus(null);
      setGraphSelectionCleared(false);
      setInspectedNodeId(null);
      setNodeFileExpanded(false);
      setGraphFullscreen(false);
      return;
    }
    const nextChain = requestChains[0];
    if (nextChain) {
      setNavigationMode("chains");
      setGraphFocus({
        kind: "chain",
        id: nextChain.id
      });
      setGraphSelectionCleared(false);
      setInspectedNodeId(null);
      setNodeFileExpanded(false);
      return;
    }
    const nextNode =
      snapshot.nodes.find(
        (node) =>
          node.kind !== "file" && node.changed
      ) ??
      snapshot.nodes.find((node) => node.kind !== "file");
    setNavigationMode("symbols");
    setGraphFocus(
      nextNode
        ? {
            kind: "node",
            id: nextNode.id
          }
        : null
    );
    setGraphSelectionCleared(false);
    setInspectedNodeId(null);
    setNodeFileExpanded(false);
  }, [snapshot?.analysisId]);

  useEffect(() => {
    if (!graphFullscreen) {
      return;
    }
    const exitFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setGraphFullscreen(false);
      }
    };
    document.addEventListener("keydown", exitFromKeyboard);
    return () =>
      document.removeEventListener(
        "keydown",
        exitFromKeyboard
      );
  }, [graphFullscreen]);

  const running = analysis.state.state === "running";
  const connectedLanguageServers =
    snapshot?.languageServers.filter(
      (server) => server.state === "connected"
    ) ?? [];
  const visibleLanguageServers =
    connectedLanguageServers.length > 1
      ? (snapshot?.languageServers.filter(
          (server) => server.state !== "connected"
        ) ?? [])
      : (snapshot?.languageServers ?? []);
  const scopeDataPending =
    availableSnapshot !== null &&
    availableSnapshot.scope !== scope;
  const progress = analysis.state.progress;
  const progressVisible =
    running || analysis.action === "starting";
  const progressRatio =
    progress && progress.total > 0
      ? Math.min(
          1,
          Math.max(0, progress.completed / progress.total)
        )
      : 0;
  const progressPresentation: AnalysisProgressPresentation | null =
    progressVisible
      ? {
          stage: progress
            ? stageLabel(progress.stage)
            : "准备分析",
          message:
            progress?.message ??
            (analysis.action === "starting"
              ? "正在启动代码分析"
              : analysis.action === "cancelling"
                ? "正在取消代码分析"
                : "正在准备代码分析"),
          startedAt: analysis.state.startedAt,
          completed: progress?.completed ?? 0,
          total: progress?.total ?? 1,
          ratio: progressRatio,
          countLabel: progress
            ? `${progress.completed}/${progress.total}`
            : "准备中"
        }
      : null;
  const focusChain = (chain: CodeRequestChainDto) => {
    setNavigationMode("chains");
    setGraphFocus({
      kind: "chain",
      id: chain.id
    });
    setGraphSelectionCleared(false);
    setInspectedNodeId(null);
    setNodeFileExpanded(false);
  };
  const focusNode = (nodeId: string) => {
    setNavigationMode("symbols");
    setGraphFocus({
      kind: "node",
      id: nodeId
    });
    setGraphSelectionCleared(false);
    setInspectedNodeId(nodeId);
    setNodeFileExpanded(false);
  };
  const inspectNode = (nodeId: string) => {
    if (nodeId !== inspectedNodeId) {
      setNodeFileExpanded(false);
    }
    setGraphSelectionCleared(false);
    setInspectedNodeId(nodeId);
  };
  const clearNodeInspection = () => {
    setGraphSelectionCleared(true);
    setInspectedNodeId(null);
    setNodeFileExpanded(false);
  };
  const changeScope = async (
    nextScope: CodeAnalysisScopeDto
  ) => {
    if (
      nextScope === scope ||
      running ||
      analysis.action === "starting"
    ) {
      return;
    }

    const previousScope = scope;
    setScope(nextScope);
    setNavigationMode("chains");
    setChainQuery("");
    setNodeQuery("");
    setMethod("all");
    setGraphFocus(null);
    setGraphSelectionCleared(false);
    setInspectedNodeId(null);
    setNodeFileExpanded(false);
    setGraphFullscreen(false);

    if (
      !availableSnapshot ||
      availableSnapshot.scope === nextScope
    ) {
      return;
    }

    const started = await analysis.start(nextScope);
    if (!started) {
      setScope(previousScope);
    }
  };
  const installLanguageServer = async (
    language: InstallableLanguageServerDto
  ) => {
    const result =
      await analysis.installLanguageServer(language);
    if (!result) {
      return;
    }
    setInstallNotice({
      title:
        result.status === "already-installed"
          ? "Language Server 已检测到"
          : "Language Server 安装完成",
      message: `${result.message} 请手动运行代码分析以使用该服务。`
    });
    await onReloadSettings();
  };
  const buildFullIndex = async () => {
    if (running || analysis.action === "starting") {
      return;
    }
    const previousScope = scope;
    setScope("workspace");
    setNavigationMode("chains");
    setChainQuery("");
    setNodeQuery("");
    setMethod("all");
    setGraphFocus(null);
    setGraphSelectionCleared(false);
    setInspectedNodeId(null);
    setNodeFileExpanded(false);
    setGraphFullscreen(false);
    const started = await analysis.start("workspace");
    if (!started) {
      setScope(previousScope);
    }
  };
  const openSelectedNodeInEditor = async () => {
    if (!selectedNode || !editorProfile) {
      return;
    }
    const opened = await externalApplications.openFile(
      editorProfile.kind,
      selectedNode.location.path,
      selectedNode.location.line,
      selectedNode.location.column
    );
    if (!opened) {
      setActionNotice({
        title: "无法在编辑器中定位",
        message:
          externalApplications.error?.message ??
          `未能通过 ${editorProfile.label} 打开该代码位置。`,
        tone: "error"
      });
    }
  };

  const content = (
    <div className="page-scroll code-analysis-page">
      <ToastViewport>
        {analysis.error && (
          <Toast
            closeLabel="关闭代码分析错误"
            icon="warning"
            message={analysis.error.message}
            onClose={analysis.clearError}
            title="代码分析操作未完成"
            tone="error"
          />
        )}
        {installNotice && (
          <Toast
            closeLabel="关闭安装提示"
            message={installNotice.message}
            onClose={() => setInstallNotice(null)}
            title={installNotice.title}
            tone="success"
          />
        )}
        {actionNotice && (
          <Toast
            closeLabel="关闭操作提示"
            message={actionNotice.message}
            onClose={() => setActionNotice(null)}
            title={actionNotice.title}
            tone={actionNotice.tone}
          />
        )}
      </ToastViewport>

      <header className="analysis-page-header">
        <div className="analysis-page-title-row">
          <h1>代码分析</h1>
          <div className="analysis-header-actions">
            <div
              aria-label="代码分析范围"
              className="analysis-scope-switch"
              role="group"
            >
              <button
                aria-pressed={scope === "changed"}
                className={scope === "changed" ? "active" : ""}
                disabled={
                  running || analysis.action === "starting"
                }
                onClick={() => void changeScope("changed")}
                type="button"
              >
                变动代码
              </button>
              <button
                aria-pressed={scope === "workspace"}
                className={scope === "workspace" ? "active" : ""}
                disabled={
                  running || analysis.action === "starting"
                }
                onClick={() => void changeScope("workspace")}
                type="button"
              >
                全部代码
              </button>
            </div>
            <Button
              onClick={onOpenSettings}
              size="small"
              type="button"
            >
              <Icon name="settings" />
              LSP 设置
            </Button>
            {running ? (
              <Button
                disabled={analysis.action === "cancelling"}
                onClick={() => void analysis.cancel()}
                size="small"
                type="button"
                variant="danger"
              >
                <Icon name="close" />
                {analysis.action === "cancelling"
                  ? "正在取消…"
                  : "取消分析"}
              </Button>
            ) : (
              <Button
                disabled={
                  !selectedEntry ||
                  !settings.codeAnalysis.enabled ||
                  analysis.action === "starting"
                }
                onClick={() => void analysis.start(scope)}
                size="small"
                type="button"
                variant="primary"
              >
                <Icon name="refresh" />
                {analysis.action === "starting"
                  ? "正在启动…"
                  : snapshot
                    ? "重新分析"
                    : "开始分析"}
              </Button>
            )}
          </div>
        </div>
        <p>
          {selectedEntry
            ? `当前范围：${selectedEntry.displayName}`
            : "请先在 Workspace 中选择一个项目条目。"}
        </p>
      </header>

      {!settings.codeAnalysis.enabled && (
        <div className="analysis-disabled-banner" role="status">
          <Icon name="warning" size={17} />
          <div>
            <strong>代码分析已在设置中关闭</strong>
            <p>
              启用后才能启动内置分析器和 Language Server。
            </p>
          </div>
          <Button
            onClick={onOpenSettings}
            size="small"
            type="button"
          >
            前往设置
          </Button>
        </div>
      )}

      {snapshot && progressPresentation && (
        <AnalysisProgressPanel
          presentation={progressPresentation}
        />
      )}

      {snapshot ? (
        <>
          <section
            aria-label="代码分析摘要"
            className="analysis-summary-grid"
          >
            <SummaryCard
              label="分析文件"
              value={snapshot.stats.analyzedFiles}
            />
            <SummaryCard
              label="代码节点"
              value={searchableNodeCount}
            />
            <SummaryCard
              label="关系边"
              value={snapshot.stats.edgeCount}
            />
            <SummaryCard
              label="请求链"
              value={requestChains.length}
            />
            <SummaryCard
              label="缓存复用"
              value={snapshot.stats.cachedFiles}
            />
          </section>

          <section className="analysis-runtime-strip">
            <span>
              分析时间{" "}
              {new Date(
                snapshot.generatedAt
              ).toLocaleString()}
            </span>
            <span>
              {snapshot.scope === "changed"
                ? "变动代码"
                : "全部代码"}
            </span>
            <span>
              耗时 {formatDuration(snapshot.stats.durationMs)}
            </span>
            {connectedLanguageServers.length > 1 && (
              <span
                aria-label={`已连接的 Language Server：${connectedLanguageServers
                  .map((server) =>
                    languageServerName(server.language)
                  )
                  .join("、")}`}
                className="analysis-server-state state-connected"
                title={`已连接：${connectedLanguageServers
                  .map((server) =>
                    languageServerName(server.language)
                  )
                  .join("、")}`}
              >
                LSP：{connectedLanguageServers.length} 个已连接
              </span>
            )}
            {visibleLanguageServers.map((server) => (
              <span
                className={`analysis-server-state state-${server.state}`}
                key={server.language}
                title={server.message}
              >
                <span>
                  {languageServerLabel(server.language)}
                  ：{serverStateLabel(server.state)}
                </span>
                {(server.state === "unavailable" ||
                  (server.state === "disabled" &&
                    settings.codeAnalysis[server.language]
                      ?.enabled === false)) && (
                  <Button
                    aria-label={`${
                      server.state === "disabled"
                        ? "安装并启用"
                        : "安装"
                    } ${languageServerName(
                      server.language
                    )} Language Server`}
                    className="analysis-server-install"
                    disabled={
                      running ||
                      (analysis.installingLanguage !== null &&
                        analysis.installingLanguage !==
                          server.language)
                    }
                    loading={
                      analysis.installingLanguage ===
                      server.language
                    }
                    onClick={() =>
                      void installLanguageServer(
                        server.language
                      )
                    }
                    type="button"
                    variant="unstyled"
                  >
                    <Icon name="download" size={12} />
                    {analysis.installingLanguage ===
                    server.language
                      ? "安装中…"
                      : server.state === "disabled"
                        ? "安装并启用"
                        : "安装"}
                  </Button>
                )}
              </span>
            ))}
            {snapshot.warnings.length > 0 && (
              <details className="analysis-warning-panel">
                <summary
                  aria-label={`查看 ${snapshot.warnings.length} 条分析提示`}
                >
                  <Icon name="warning" size={13} />
                  <span>
                    {snapshot.warnings.length} 条分析提示
                  </span>
                </summary>
                <ul className="analysis-warning-menu menu-surface">
                  {snapshot.warnings.map((warning, index) => (
                    <li key={`${warning}-${index}`}>{warning}</li>
                  ))}
                </ul>
              </details>
            )}
            {snapshot.indexStatus?.resultCompleteness ===
            "partial" ? (
              <AnalysisIndexStatusMenu
                disabled={
                  running ||
                  analysis.action === "starting"
                }
                onBuildFullIndex={() =>
                  void buildFullIndex()
                }
                status={snapshot.indexStatus}
                truncated={snapshot.stats.truncated}
              />
            ) : (
              snapshot.stats.truncated && (
                <span className="analysis-truncated">
                  结果已按性能上限截断
                </span>
              )
            )}
          </section>

          <div
            aria-label="代码分析工作区"
            className={`analysis-workbench${
              graphFullscreen ? " is-fullscreen" : ""
            }`}
          >
            <aside
              className={`panel analysis-chain-panel${
                selectedNode ? " is-node-detail" : ""
              }`}
            >
              {selectedNode ? (
                <>
                  <header className="analysis-node-detail-header">
                    <div>
                      <strong>节点详情</strong>
                      <span>
                        {nodeKindLabel(selectedNode)} ·{" "}
                        {selectedNode.location.path}:
                        {selectedNode.location.line}
                      </span>
                    </div>
                    <Button
                      aria-label="返回代码导航"
                      className="analysis-node-detail-back"
                      icon={<Icon name="undo" size={14} />}
                      onClick={clearNodeInspection}
                      size="small"
                      title="返回代码导航"
                      variant="icon"
                    />
                  </header>
                  <NodeDetails
                    diagnostics={diagnosticsForNode(
                      snapshot,
                      selectedNode.id
                    )}
                    editorBusy={
                      externalApplications.loading ||
                      externalApplications.active !== null
                    }
                    {...(editorProfile
                      ? {
                          editorLabel: editorProfile.label
                        }
                      : {})}
                    fileExpanded={nodeFileExpanded}
                    node={selectedNode}
                    onOpenInEditor={() =>
                      void openSelectedNodeInEditor()
                    }
                    onToggleFile={() =>
                      setNodeFileExpanded(
                        (current) => !current
                      )
                    }
                  />
                </>
              ) : (
                <>
                  <header>
                <div>
                  <strong>代码导航</strong>
                  <span>
                    {navigationMode === "chains"
                      ? `${chains.length} 条请求链`
                      : `${nodeResults.length}/${searchableNodeCount} 个节点`}
                  </span>
                </div>
                <div
                  aria-label="代码导航类型"
                  className="analysis-navigation-tabs"
                  role="tablist"
                >
                  <button
                    aria-selected={
                      navigationMode === "chains"
                    }
                    className={
                      navigationMode === "chains"
                        ? "active"
                        : ""
                    }
                    onClick={() =>
                      setNavigationMode("chains")
                    }
                    role="tab"
                    type="button"
                  >
                    请求链
                    <span>
                      {requestChains.length}
                    </span>
                  </button>
                  <button
                    aria-selected={
                      navigationMode === "symbols"
                    }
                    className={
                      navigationMode === "symbols"
                        ? "active"
                        : ""
                    }
                    onClick={() =>
                      setNavigationMode("symbols")
                    }
                    role="tab"
                    type="button"
                  >
                    代码节点
                    <span>{searchableNodeCount}</span>
                  </button>
                </div>
                {navigationMode === "chains" ? (
                  <>
                    <Input
                      aria-label="筛选请求链"
                      clearLabel="清空请求链筛选"
                      fieldClassName="analysis-chain-filter"
                      fullWidth
                      leading={<Icon name="search" size={14} />}
                      onChange={(event) =>
                        setChainQuery(event.target.value)
                      }
                      {...(chainQuery
                        ? {
                            onClear: () => {
                              setChainQuery("");
                              requestAnimationFrame(() =>
                                chainFilterRef.current?.focus()
                              );
                            }
                          }
                        : {})}
                      placeholder="搜索路径或文件"
                      ref={chainFilterRef}
                      size="small"
                      value={chainQuery}
                    />
                    <AnalysisMethodDropdown
                      onChange={setMethod}
                      value={method}
                    />
                  </>
                ) : (
                  <Input
                    aria-label="搜索代码节点"
                    clearLabel="清空代码节点筛选"
                    fieldClassName="analysis-chain-filter"
                    fullWidth
                    leading={<Icon name="search" size={14} />}
                    onChange={(event) =>
                      setNodeQuery(event.target.value)
                    }
                    {...(nodeQuery
                      ? {
                          onClear: () => {
                            setNodeQuery("");
                            requestAnimationFrame(() =>
                              nodeFilterRef.current?.focus()
                            );
                          }
                        }
                      : {})}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        nodeResults[0]
                      ) {
                        event.preventDefault();
                        focusNode(nodeResults[0].id);
                      }
                    }}
                    placeholder="搜索节点名称、限定名或文件路径"
                    ref={nodeFilterRef}
                    size="small"
                    value={nodeQuery}
                  />
                )}
              </header>
              <div className="analysis-chain-list">
                {navigationMode === "chains" ? (
                  <>
                    {chains.map((chain) => (
                      <button
                        aria-current={
                          chain.id === selectedChain?.id
                            ? "true"
                            : undefined
                        }
                        className={
                          chain.id === selectedChain?.id
                            ? "active"
                            : ""
                        }
                        key={chain.id}
                        onClick={() => focusChain(chain)}
                        type="button"
                      >
                        <span
                          className={`analysis-chain-method method-${chain.method.toLocaleLowerCase(
                            "en-US"
                          )}`}
                        >
                          {chain.method}
                        </span>
                        <strong title={chain.operationKey}>
                          {chain.route}
                        </strong>
                        <small>
                          {chain.nodeIds.length} 个节点
                          {" · "}
                          Profile: {chain.profileId}
                          {chain.ambiguous
                            ? " · 多个候选目标"
                            : ""}
                        </small>
                      </button>
                    ))}
                    {chains.length === 0 && (
                      <div className="analysis-list-empty">
                        <Icon name="search" size={20} />
                        <strong>没有匹配的请求链</strong>
                        <p>
                          可清除筛选、切换到函数搜索，或重新运行全部代码分析。
                        </p>
                      </div>
                    )}
                    {chainFilterResult.truncated && (
                      <div
                        className="analysis-list-limit"
                        role="status"
                      >
                        为保持搜索和滚动流畅，仅显示前{" "}
                        {MAX_VISIBLE_REQUEST_CHAINS} 条匹配结果；请继续缩小筛选范围。
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {nodeResults.map((node) => (
                      <button
                        aria-current={
                          graphFocus?.kind === "node" &&
                          graphFocus.id === node.id
                            ? "true"
                            : undefined
                        }
                        className={`analysis-symbol-result${
                          graphFocus?.kind === "node" &&
                          graphFocus.id === node.id
                            ? " active"
                            : ""
                        }`}
                        key={node.id}
                        onClick={() => focusNode(node.id)}
                        type="button"
                      >
                        <span
                          className={`analysis-node-dot node-${node.kind}`}
                        />
                        <strong title={node.qualifiedName}>
                          {codeNodeDisplayName(node)}
                        </strong>
                        <small>
                          {nodeKindLabel(node)} ·{" "}
                          {node.location.path}:
                          {node.location.line}
                        </small>
                      </button>
                    ))}
                    {nodeResults.length === 0 && (
                      <div className="analysis-list-empty">
                        <Icon name="search" size={20} />
                        <strong>没有匹配的代码节点</strong>
                        <p>
                          可按名称、限定名或文件路径搜索。
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
                </>
              )}
            </aside>

            <div
              aria-label="关系图工作区"
              className="analysis-graph-workspace"
            >
              {selectedNode && nodeFileExpanded && (
                selectedNode.changed ? (
                  <NodeDiffViewer
                    key={`node-diff:${selectedNode.id}`}
                    node={selectedNode}
                    onClose={() =>
                      setNodeFileExpanded(false)
                    }
                  />
                ) : (
                  <NodeSourceViewer
                    key={`node-source:${selectedNode.id}`}
                    node={selectedNode}
                    onClose={() =>
                      setNodeFileExpanded(false)
                    }
                  />
                )
              )}

              <section
                className="panel analysis-graph-panel"
                key="relation-graph"
              >
                <header className="analysis-panel-heading">
                  <div>
                    <strong>关系图</strong>
                    <span>
                      {selectedChain
                        ? selectedChain.title
                        : graphFocusNode
                          ? `${codeNodeDisplayName(
                              graphFocusNode
                            )} 的上下游`
                          : "代码节点上下游"}
                    </span>
                  </div>
                  <div className="analysis-panel-heading-actions">
                    <span className="status-pill neutral">
                      自由拖动 · 滚轮缩放
                    </span>
                    <Button
                      aria-label={
                        graphFullscreen
                          ? "退出代码分析全屏"
                          : "全屏显示代码分析工作区"
                      }
                      aria-pressed={graphFullscreen}
                      icon={
                        <Icon
                          name={
                            graphFullscreen
                              ? "minimize"
                              : "maximize"
                          }
                          size={14}
                        />
                      }
                      onClick={() =>
                        setGraphFullscreen(
                          (current) => !current
                        )
                      }
                      size="small"
                      title={
                        graphFullscreen
                          ? "退出全屏（Esc）"
                          : "全屏显示代码分析工作区"
                      }
                      variant="icon"
                    />
                  </div>
                </header>
                <CodeRelationGraph
                  chain={selectedChain}
                  focusNodeId={graphFocusNodeId}
                  onClearSelection={clearNodeInspection}
                  onSelectNode={inspectNode}
                  selectedNodeId={graphSelectedNodeId}
                  snapshot={snapshot}
                />
              </section>
            </div>
          </div>
        </>
      ) : progressPresentation ? (
        <AnalysisProgressPanel
          fullPage
          presentation={progressPresentation}
        />
      ) : (
        <section className="panel analysis-empty-state">
          <span className="empty-state-icon">
            <Icon name="graph" size={24} />
          </span>
          <div>
            <strong>
              {scopeDataPending
                ? `正在切换到${
                    scope === "changed"
                      ? "变动代码"
                      : "全部代码"
                  }分析`
                : "尚未生成代码关系索引"}
            </strong>
            <p>
              {scopeDataPending
                ? "目标范围完成前不会展示另一范围的统计和关系图，避免两组分析数据混用。"
                : "先分析变动代码可快速查看本次修改影响；需要跨项目完整请求链时，再手动运行全部代码分析。"}
            </p>
          </div>
        </section>
      )}
    </div>
  );

  return (
    <SkeletonBoundary
      fallback={<CodeAnalysisSkeleton />}
      hasContent={Boolean(availableSnapshot)}
      label="正在读取代码分析"
      loading={analysis.loading}
      surfaceClassName="page-scroll code-analysis-page gn-page-skeleton analysis-page-skeleton"
    >
      {content}
    </SkeletonBoundary>
  );
}

function AnalysisProgressPanel({
  presentation,
  fullPage = false
}: {
  presentation: AnalysisProgressPresentation;
  fullPage?: boolean;
}) {
  const percentage = Math.round(presentation.ratio * 100);
  const elapsedTime = useAnalysisElapsedTime(
    presentation.startedAt
  );

  return (
    <section
      aria-label="代码分析进度"
      aria-live="polite"
      className={`analysis-progress-panel panel${
        fullPage
          ? " analysis-empty-state analysis-progress-empty-state"
          : ""
      }`}
    >
      {fullPage && (
        <>
          <span className="empty-state-icon">
            <Icon name="activity" size={24} />
          </span>
          <strong className="analysis-progress-title">
            正在分析代码
          </strong>
        </>
      )}
      <div className="analysis-progress-copy">
        <span>
          {presentation.stage}
          <strong>{presentation.message}</strong>
        </span>
        <span aria-live="off">
          执行时间 {formatExecutionTime(elapsedTime)} ·{" "}
          {presentation.countLabel}
        </span>
      </div>
      <div
        aria-label="代码分析完成进度"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percentage}
        aria-valuetext={`${presentation.completed}/${presentation.total}`}
        className="analysis-progress-track"
        role="progressbar"
      >
        <span
          style={{
            transform: `scaleX(${Math.max(
              presentation.ratio,
              0.02
            )})`
          }}
        />
      </div>
    </section>
  );
}

function useAnalysisElapsedTime(
  startedAt?: string
): number {
  const [fallbackStartedAt] = useState(() => Date.now());
  const [now, setNow] = useState(fallbackStartedAt);

  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const parsedStartedAt = startedAt
    ? Date.parse(startedAt)
    : Number.NaN;
  return Math.max(
    0,
    now -
      (Number.isFinite(parsedStartedAt)
        ? parsedStartedAt
        : fallbackStartedAt)
  );
}

function AnalysisIndexStatusMenu({
  status,
  truncated,
  disabled,
  onBuildFullIndex
}: {
  status: NonNullable<
    CodeAnalysisSnapshotDto["indexStatus"]
  >;
  truncated: boolean;
  disabled: boolean;
  onBuildFullIndex(): void;
}) {
  return (
    <details className="analysis-index-status-menu">
      <summary
        aria-label="查看代码索引状态"
        title={status.message}
      >
        {truncated
          ? "结果已按性能上限截断"
          : "局部索引"}
      </summary>
      <div className="analysis-index-status-popover menu-surface">
        <strong>局部索引</strong>
        <span>{status.message}</span>
        {status.lastFullIndexAt && (
          <small>
            上次完整索引：
            {new Date(
              status.lastFullIndexAt
            ).toLocaleString()}
          </small>
        )}
        <Button
          disabled={disabled}
          onClick={onBuildFullIndex}
          size="small"
          type="button"
        >
          <Icon name="refresh" size={14} />
          建立完整索引
        </Button>
      </div>
    </details>
  );
}

function DiagnosticList({
  diagnostics
}: {
  diagnostics: CodeAnalysisDiagnosticDto[];
}) {
  if (diagnostics.length === 0) {
    return null;
  }
  return (
    <section className="analysis-diagnostics">
      <h3>断链诊断</h3>
      <ul>
        {diagnostics.map((diagnostic) => (
          <li key={diagnostic.id}>
            <Icon
              name={
                diagnostic.severity === "warning"
                  ? "warning"
                  : "operations"
              }
              size={13}
            />
            <div>
              <strong>{diagnostic.message}</strong>
              <span>{diagnostic.evidence}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function diagnosticsForNode(
  snapshot: CodeAnalysisSnapshotDto,
  nodeId: string
): CodeAnalysisDiagnosticDto[] {
  return (snapshot.diagnostics ?? []).filter(
    (diagnostic) =>
      diagnostic.nodeId === nodeId ||
      diagnostic.relatedNodeIds.includes(nodeId)
  );
}

function CodeAnalysisSkeleton() {
  return (
    <>
      <header className="analysis-skeleton-header">
        <div className="analysis-skeleton-title-row">
          <Skeleton height={24} width={96} />
          <div className="analysis-skeleton-actions">
            <Skeleton height={38} width={178} />
            <Skeleton height={32} width={88} />
            <Skeleton height={32} width={96} />
          </div>
        </div>
        <div className="analysis-skeleton-description">
          <Skeleton height={10} variant="text" width={260} />
        </div>
      </header>

      <section
        aria-hidden="true"
        className="analysis-skeleton-summary-grid"
      >
        {[56, 48, 52, 46, 50].map((width, index) => (
          <article
            className="gn-skeleton-card analysis-skeleton-summary-card"
            key={index}
          >
            <div className="analysis-skeleton-summary-label">
              <Skeleton
                height={9}
                variant="text"
                width={`${width}%`}
              />
            </div>
            <div className="analysis-skeleton-summary-value">
              <Skeleton height={16} width="42%" />
            </div>
          </article>
        ))}
      </section>

      <div
        aria-hidden="true"
        className="analysis-skeleton-runtime"
      >
        {[168, 72, 88, 118, 104].map((width) => (
          <Skeleton height={28} key={width} width={width} />
        ))}
      </div>

      <div
        aria-hidden="true"
        className="analysis-skeleton-workbench"
      >
        <aside className="gn-skeleton-panel analysis-skeleton-navigation">
          <div className="analysis-skeleton-navigation-header">
            <div className="analysis-skeleton-heading-row">
              <Skeleton height={13} width={72} />
              <Skeleton
                height={9}
                variant="text"
                width={68}
              />
            </div>
            <div className="analysis-skeleton-tabs">
              <Skeleton height={28} />
              <Skeleton height={28} />
            </div>
            <Skeleton height={32} />
            <Skeleton height={32} />
          </div>
          <div className="analysis-skeleton-navigation-list">
            {[76, 62, 82, 68, 72].map((width, index) => (
              <div
                className="analysis-skeleton-navigation-row"
                key={index}
              >
                <div>
                  <Skeleton height={18} width={42} />
                  <Skeleton height={11} width={`${width}%`} />
                </div>
                <div className="analysis-skeleton-navigation-meta">
                  <Skeleton
                    height={9}
                    variant="text"
                    width={`${Math.max(44, width - 18)}%`}
                  />
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section className="gn-skeleton-panel analysis-skeleton-graph">
          <div className="analysis-skeleton-graph-header">
            <div className="analysis-skeleton-graph-heading">
              <Skeleton height={13} width={58} />
              <Skeleton
                height={9}
                variant="text"
                width={148}
              />
            </div>
            <Skeleton height={28} width={146} />
            <Skeleton height={32} variant="circle" width={32} />
          </div>
          <div className="analysis-skeleton-graph-body">
            {[2, 3, 2].map((nodeCount, columnIndex) => (
              <div
                className="analysis-skeleton-graph-column"
                key={columnIndex}
              >
                {Array.from(
                  { length: nodeCount },
                  (_, nodeIndex) => (
                    <Skeleton
                      className="analysis-skeleton-graph-node"
                      height={72}
                      key={nodeIndex}
                    />
                  )
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function SummaryCard({
  label,
  value
}: {
  label: string;
  value: number;
}) {
  return (
    <article className="panel analysis-summary-card">
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </article>
  );
}

function AnalysisMethodDropdown({
  onChange,
  value
}: {
  onChange(value: string): void;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected =
    ANALYSIS_METHOD_OPTIONS.find(
      (option) => option.value === value
    ) ?? ANALYSIS_METHOD_OPTIONS[0];

  useEffect(() => {
    if (!open) {
      return;
    }
    const close = () => setOpen(false);
    const handleScroll = (event: Event) => {
      if (isEventInsideMenu(event, menuRef.current)) {
        return;
      }
      close();
    };
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
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        triggerRef.current?.focus();
      }
    };

    document.addEventListener(
      "pointerdown",
      handlePointerDown
    );
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", handleScroll, true);
    requestAnimationFrame(() => {
      const items = menuRef.current?.querySelectorAll<
        HTMLButtonElement
      >('[role="menuitemradio"]');
      const current = Array.from(items ?? []).find(
        (item) => item.getAttribute("aria-checked") === "true"
      );
      (current ?? items?.[0])?.focus();
    });

    return () => {
      document.removeEventListener(
        "pointerdown",
        handlePointerDown
      );
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open]);

  return (
    <div className="analysis-method-dropdown">
      <Button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="按请求类型筛选"
        className="analysis-method-dropdown-trigger"
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
        <span>{selected.label}</span>
        <Icon name="chevron" size={14} />
      </Button>
      {open && (
        <MenuPopover
          align="start"
          anchor={triggerRef.current}
          aria-label="请求类型筛选选项"
          className="analysis-method-dropdown-menu"
          ref={menuRef}
          side="bottom"
        >
          {ANALYSIS_METHOD_OPTIONS.map((option) => (
            <MenuItem
              aria-checked={option.value === value}
              className={
                option.value === value
                  ? "is-selected"
                  : undefined
              }
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
                triggerRef.current?.focus();
              }}
              role="menuitemradio"
            >
              {option.label}
            </MenuItem>
          ))}
        </MenuPopover>
      )}
    </div>
  );
}

function NodeDetails({
  node,
  diagnostics,
  editorBusy,
  editorLabel,
  fileExpanded,
  onOpenInEditor,
  onToggleFile
}: {
  node: CodeGraphNodeDto;
  diagnostics: CodeAnalysisDiagnosticDto[];
  editorBusy: boolean;
  editorLabel?: string;
  fileExpanded: boolean;
  onOpenInEditor(): void;
  onToggleFile(): void;
}) {
  const endLine =
    typeof node.metadata.endLine === "number"
      ? node.metadata.endLine
      : node.location.line;
  const documentation = nodeDocumentation(node);
  const metadataEntries = Object.entries(node.metadata).filter(
    ([key]) => key !== "documentation"
  );

  return (
    <>
      <div className="analysis-node-details">
        <div className="analysis-node-overview">
          <div className="analysis-node-title">
            <span
              className={`analysis-node-dot node-${node.kind}`}
            />
            <div>
              <strong>{node.name}</strong>
              <span>{node.qualifiedName}</span>
            </div>
          </div>
          <dl className="detail-list">
            <Detail label="类型" value={nodeKindLabel(node)} />
            <Detail label="语言" value={node.language} />
            <Detail
              label="位置"
              wide
              value={`${node.location.path}:${node.location.line}`}
            />
            <Detail
              label="分析来源"
              wide
              value={sourceLabel(node.source)}
            />
            <Detail
              label="置信度"
              value={confidenceLabel(node.confidence)}
            />
            <Detail
              label="变动代码"
              value={node.changed ? "是" : "否"}
            />
          </dl>
          {documentation && (
            <section className="analysis-node-documentation">
              <h3>代码注释</h3>
              <p>{documentation}</p>
            </section>
          )}
          {metadataEntries.length > 0 && (
            <section className="analysis-metadata">
              <h3>框架信息</h3>
              {metadataEntries.map(([key, value]) => (
                <div key={key}>
                  <span>{metadataLabel(key)}</span>
                  <strong>{String(value)}</strong>
                </div>
              ))}
            </section>
          )}
          <DiagnosticList diagnostics={diagnostics} />
        </div>
      </div>
      <section className="analysis-node-diff-trigger">
        <div className="analysis-node-actions">
          <Button
            aria-controls="analysis-node-diff-drawer"
            aria-expanded={fileExpanded}
            onClick={onToggleFile}
            size="small"
            type="button"
          >
            <Icon
              name={
                fileExpanded
                  ? "close"
                  : node.changed
                    ? "diff"
                    : "fileCode"
              }
              size={14}
            />
            {fileExpanded
              ? node.changed
                ? "收起文件 Diff"
                : "收起代码"
              : node.changed
                ? "查看文件 Diff"
                : "查看代码"}
          </Button>
          {editorLabel && (
            <Button
              disabled={editorBusy}
              loading={editorBusy}
              onClick={onOpenInEditor}
              size="small"
              type="button"
            >
              <Icon name="external" size={14} />
              在 {editorLabel} 中定位
            </Button>
          )}
        </div>
        <p>
          节点范围 L{node.location.line}
          {endLine > node.location.line
            ? `–L${endLine}`
            : ""}
          {node.changed
            ? "，打开后将自动定位到对应变更行。"
            : "，打开后将读取当前文件并定位到对应行。"}
        </p>
      </section>
    </>
  );
}

function NodeDiffViewer({
  node,
  onClose
}: {
  node: CodeGraphNodeDto;
  onClose(): void;
}) {
  const nodeDiff = useCodeNodeDiff(node);
  const [activeDiffMode, setActiveDiffMode] = useState<
    RepositoryDiffDto["diff"]["mode"] | null
  >(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const diffDocuments = useMemo(
    () =>
      [...nodeDiff.documents].sort(
        (left, right) =>
          diffModeRank(left.mode) -
          diffModeRank(right.mode)
      ),
    [nodeDiff.documents]
  );
  useEffect(() => {
    setActiveDiffMode((current) =>
      current &&
      diffDocuments.some(
        (document) => document.mode === current
      )
        ? current
        : (diffDocuments[0]?.mode ?? null)
    );
  }, [diffDocuments]);
  useEffect(() => {
    setSearchOpen(false);
  }, [node.id]);
  const activeDiff =
    diffDocuments.find(
      (document) => document.mode === activeDiffMode
    ) ??
    diffDocuments[0] ??
    null;
  const diffPanelState: DiffPanelState | undefined =
    nodeDiff.loading
      ? {
          icon: "refresh",
          title: "正在读取节点 Diff",
          message: "正在检查该文件的暂存区和工作区变更。",
          busy: true
        }
      : nodeDiff.error && !activeDiff
        ? {
            icon: "warning",
            title: "无法读取节点 Diff",
            message: nodeDiff.error.message
          }
        : !activeDiff
          ? {
              icon: "check",
              title: "当前文件没有未提交差异",
              message:
                "代码关系仍可查看；产生本地修改后，这里会显示对应 Diff。"
            }
          : undefined;
  const endLine =
    typeof node.metadata.endLine === "number"
      ? node.metadata.endLine
      : node.location.line;

  return (
    <section
      aria-label="节点文件 Diff"
      className="panel analysis-node-diff-drawer"
      id="analysis-node-diff-drawer"
    >
      <header className="analysis-panel-heading">
        <div>
          <strong>节点所在文件 Diff</strong>
          <span>
            {node.location.path} · L{node.location.line}
            {endLine > node.location.line
              ? `–L${endLine}`
              : ""}
          </span>
        </div>
        <div className="analysis-panel-heading-actions">
          {nodeDiff.error && activeDiff && (
            <span
              className="analysis-node-diff-warning"
              title={nodeDiff.error.message}
            >
              部分 Diff 读取失败
            </span>
          )}
          <Button
            aria-label="搜索节点文件 Diff"
            disabled={
              !activeDiff ||
              !activeDiff.diff.content ||
              activeDiff.diff.binary ||
              activeDiff.diff.media !== undefined
            }
            icon={<Icon name="search" size={14} />}
            onClick={() => setSearchOpen(true)}
            size="small"
            title="搜索 Diff"
            variant="icon"
          />
          <Button
            aria-label="关闭节点文件 Diff"
            icon={<Icon name="close" size={14} />}
            onClick={onClose}
            size="small"
            title="关闭 Diff"
            variant="icon"
          />
        </div>
      </header>
      <div className="analysis-node-diff-content">
        <DiffPanel
          binary={activeDiff?.diff.binary}
          className="analysis-node-diff-panel"
          config={
            repositoryDiffWorkspaceConfiguration.document
          }
          content={activeDiff?.diff.content}
          deletions={activeDiff?.diff.deletions}
          additions={activeDiff?.diff.additions}
          focusLine={node.location.line}
          keyboardShortcutsEnabled={false}
          maxLines={600}
          media={activeDiff?.diff.media}
          onSearchOpenChange={setSearchOpen}
          path={activeDiff?.diff.path ?? node.location.path}
          preferredLayout="unified"
          preferredWrap
          searchOpen={searchOpen}
          scopeKey={`${node.location.repositoryId}:${node.location.worktreeId}:${node.location.path}:${activeDiff?.mode ?? "none"}`}
          state={diffPanelState}
          statsAvailable={Boolean(activeDiff)}
          truncated={activeDiff?.diff.truncated}
          headerActions={
            diffDocuments.length > 0 ? (
              <div
                aria-label="节点 Diff 类型"
                className="analysis-diff-mode-tabs"
                role="tablist"
              >
                {diffDocuments.map((document) => (
                  <button
                    aria-selected={
                      document.mode === activeDiff?.mode
                    }
                    className={
                      document.mode === activeDiff?.mode
                        ? "active"
                        : ""
                    }
                    key={document.mode}
                    onClick={() =>
                      setActiveDiffMode(document.mode)
                    }
                    role="tab"
                    type="button"
                  >
                    {diffModeLabel(document.mode)}
                  </button>
                ))}
              </div>
            ) : undefined
          }
        />
      </div>
    </section>
  );
}

function Detail({
  label,
  value,
  wide = false
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div
      className={`detail-row${
        wide ? " analysis-detail-wide" : ""
      }`}
    >
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function stageLabel(
  stage:
    | "discovering"
    | "reading"
    | "parsing"
    | "lsp"
    | "linking"
    | "caching"
): string {
  return {
    discovering: "发现文件",
    reading: "读取源码",
    parsing: "建立索引",
    lsp: "LSP 增强",
    linking: "生成关系",
    caching: "保存缓存"
  }[stage];
}

function serverStateLabel(
  state: "disabled" | "connected" | "unavailable" | "failed"
): string {
  return {
    disabled: "未启用",
    connected: "已连接",
    unavailable: "未安装",
    failed: "失败"
  }[state];
}

function languageServerLabel(
  language: LanguageServerLanguageDto
): string {
  return `${languageServerName(language)} LSP`;
}

function languageServerName(
  language: LanguageServerLanguageDto
): string {
  return {
    typescript: "TypeScript",
    vue: "Vue",
    java: "Java",
    python: "Python",
    go: "Go",
    kotlin: "Kotlin",
    csharp: "C#",
    rust: "Rust"
  }[language];
}

function nodeKindLabel(node: CodeGraphNodeDto): string {
  return {
    file: "文件",
    module: "模块",
    package: "包",
    class: "类",
    interface: "接口",
    enum: "枚举",
    property: "属性",
    function: "函数",
    method: "方法",
    "client-request": "前端请求",
    "server-endpoint": "后端接口",
    "rpc-client": "RPC 客户端",
    "rpc-handler": "RPC 处理器"
  }[node.kind];
}

function sourceLabel(
  source: "builtin" | "lsp" | "merged"
): string {
  return {
    builtin: "内置分析器",
    lsp: "Language Server",
    merged: "LSP + 内置分析"
  }[source];
}

function confidenceLabel(
  value: "exact" | "probable" | "heuristic"
): string {
  return {
    exact: "精确",
    probable: "高概率",
    heuristic: "启发式"
  }[value];
}

function isEditorApplication(
  kind: ExternalApplicationKindDto
): boolean {
  return (
    kind === "vscode" ||
    kind === "cursor" ||
    kind === "intellij-idea" ||
    kind === "sublime-text"
  );
}

function diffModeLabel(
  mode: RepositoryDiffDto["diff"]["mode"]
): string {
  return {
    staged: "已暂存",
    unstaged: "未暂存",
    untracked: "未跟踪"
  }[mode];
}

function diffModeRank(
  mode: RepositoryDiffDto["diff"]["mode"]
): number {
  return {
    untracked: 0,
    unstaged: 1,
    staged: 2
  }[mode];
}

function metadataLabel(key: string): string {
  return {
    httpMethod: "HTTP 方法",
    operationKey: "操作键",
    operationName: "操作名",
    profileId: "分析 Profile",
    serviceKey: "协议服务键",
    transport: "传输类型",
    role: "端点角色",
    rawOperation: "源码操作",
    wrapperId: "封装来源",
    bindingConfidence: "绑定置信度",
    route: "标准路径",
    rawRoute: "源码路径",
    annotation: "框架注解",
    endLine: "结束行",
    size: "文件大小"
  }[key] ?? key;
}

function nodeDocumentation(
  node: Pick<CodeGraphNodeDto, "metadata">
): string | null {
  const value = node.metadata.documentation;
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) {
    return `${milliseconds} ms`;
  }
  return `${(milliseconds / 1_000).toFixed(1)} s`;
}

function formatExecutionTime(milliseconds: number): string {
  const totalSeconds = Math.max(
    0,
    Math.floor(milliseconds / 1_000)
  );
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor(
    (totalSeconds % 3_600) / 60
  );
  const seconds = totalSeconds % 60;
  const parts =
    hours > 0
      ? [hours, minutes, seconds]
      : [minutes, seconds];
  return parts
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

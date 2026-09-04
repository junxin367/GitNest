import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";

import type {
  ChangedPathDto,
  RepositoryStatusSnapshotDto,
  RepositoryTargetDto,
  WorkspaceDetailsDto,
  WorkspaceOperationDto
} from "@gitnest/contracts";

import type { RepositoryTab } from "../../app/navigation";
import { useRepositoryDetails } from "../../entities/repository/useRepositoryDetails";
import type { RepositoryCommandController } from "../../features/repository-command/useRepositoryCommands";
import type { ExternalTerminalController } from "../../features/external-terminal/useExternalTerminals";
import { WorktreeCommandDialog } from "../../features/worktree-command/WorktreeCommandDialog";
import { useWorktreeCommands } from "../../features/worktree-command/useWorktreeCommands";
import {
  canStageChange,
  canUnstageChange,
  useRepositoryMutations
} from "../../entities/repository/useRepositoryMutations";
import {
  findTargetSnapshot,
  getSnapshotChangeCount,
  resolveWorkspaceTarget
} from "../../entities/workspace/model";
import { Icon } from "../../shared/ui/Icon";
import { RepositoryWorktrees } from "./RepositoryWorktrees";

interface RepositoryPageProps {
  workspace: WorkspaceDetailsDto | null;
  snapshots: RepositoryStatusSnapshotDto[];
  operations: WorkspaceOperationDto[];
  target: RepositoryTargetDto | undefined;
  tab: RepositoryTab;
  commands: RepositoryCommandController;
  terminals: ExternalTerminalController;
  onOpenTab(tab: RepositoryTab): void;
}

export function RepositoryPage({
  workspace,
  snapshots,
  operations,
  target,
  tab,
  commands,
  terminals,
  onOpenTab
}: RepositoryPageProps) {
  const details = useRepositoryDetails(target, tab);
  const worktreeCommands = useWorktreeCommands(
    target?.repositoryId,
    operations
  );
  const mutationHooks = useMemo(
    () => ({
      beforeMutation: details.invalidate,
      afterMutation: () => details.reload("changes")
    }),
    [details.invalidate, details.reload]
  );
  const mutations = useRepositoryMutations(
    target,
    mutationHooks
  );
  const [commitSubject, setCommitSubject] = useState("");
  const [commitBody, setCommitBody] = useState("");
  const targetKey = target
    ? `${target.repositoryId}:${target.worktreeId}`
    : "";
  const handledCommandCompletion = useRef(
    commands.completionVersion
  );

  useEffect(() => {
    setCommitSubject("");
    setCommitBody("");
    mutations.clearFeedback();
    commands.clearFeedback();
    terminals.clearFeedback();
    handledCommandCompletion.current =
      commands.completionVersion;
  }, [mutations.clearFeedback, targetKey]);

  useEffect(() => {
    if (
      handledCommandCompletion.current ===
      commands.completionVersion
    ) {
      return;
    }
    handledCommandCompletion.current =
      commands.completionVersion;
    details.invalidate();
    void details.reload(tab);
  }, [
    commands.completionVersion,
    details.invalidate,
    details.reload,
    tab
  ]);

  if (!workspace || !target) {
    return (
      <div className="page-scroll">
        <div className="empty-state">
          <span className="empty-state-icon">
            <Icon name="repository" size={20} />
          </span>
          <div>
            <strong>尚未选择仓库</strong>
            <p>请从左侧 Workspace 树选择一个精确工作目录。</p>
          </div>
        </div>
      </div>
    );
  }

  const resolved = resolveWorkspaceTarget(workspace, target);
  const snapshot = findTargetSnapshot(snapshots, target);
  const repositoryName =
    resolved.worktree?.name ??
    resolved.repository?.name ??
    "未知仓库";

  return (
    <div className="page-scroll repository-page">
      <section className="page-heading repository-page-heading">
        <div>
          <span className="eyebrow">Repository target</span>
          <h1>{repositoryName}</h1>
          <p title={resolved.worktree?.path}>
            {resolved.worktree?.path ?? "工作目录不可用"}
          </p>
        </div>
        <div className="page-actions">
          <span
            className={`status-pill ${snapshotTone(snapshot)}`}
          >
            {snapshotStatus(snapshot)}
          </span>
          {(tab === "changes" ||
            tab === "history" ||
            tab === "branches") && (
            <button
              className="button"
              onClick={() => void details.reload(tab)}
              type="button"
            >
              <Icon name="refresh" />
              重新读取
            </button>
          )}
        </div>
      </section>

      {details.error && (
        <div className="workspace-feedback error" role="alert">
          <Icon name="warning" />
          <div>
            <strong>仓库数据读取失败</strong>
            <span>{details.error.message}</span>
          </div>
        </div>
      )}

      {(mutations.error || mutations.notice) && (
        <div
          className={`workspace-feedback ${
            mutations.error ? "error" : "success"
          }`}
          role={mutations.error ? "alert" : "status"}
        >
          <Icon
            name={mutations.error ? "warning" : "check"}
          />
          <div>
            <strong>
              {mutations.error
                ? "仓库写操作未完成"
                : "仓库写操作完成"}
            </strong>
            <span>
              {mutations.error?.message ?? mutations.notice}
            </span>
          </div>
          <button
            aria-label="关闭写操作提示"
            className="icon-button"
            onClick={mutations.clearFeedback}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>
      )}

      {(commands.error || commands.notice) && (
        <div
          className={`workspace-feedback ${
            commands.error ? "error" : "success"
          }`}
          role={commands.error ? "alert" : "status"}
        >
          <Icon
            name={commands.error ? "warning" : "check"}
          />
          <div>
            <strong>
              {commands.error
                ? "仓库命令未完成"
                : "仓库命令已接受"}
            </strong>
            <span>
              {commands.error?.message ?? commands.notice}
            </span>
          </div>
          <button
            aria-label="关闭仓库命令提示"
            className="icon-button"
            onClick={commands.clearFeedback}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>
      )}

      {(terminals.error || terminals.notice) && (
        <div
          className={`workspace-feedback ${
            terminals.error ? "error" : "success"
          }`}
          role={terminals.error ? "alert" : "status"}
        >
          <Icon
            name={terminals.error ? "warning" : "terminal"}
          />
          <div>
            <strong>
              {terminals.error
                ? "外部终端未打开"
                : "外部终端已打开"}
            </strong>
            <span>
              {terminals.error?.message ?? terminals.notice}
            </span>
          </div>
          <button
            aria-label="关闭终端提示"
            className="icon-button"
            onClick={terminals.clearFeedback}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>
      )}

      {tab === "overview" && (
        <RepositoryOverview
          onOpenTab={onOpenTab}
          snapshot={snapshot}
          worktreeCount={
            resolved.repository?.worktreeIds.length ?? 0
          }
        />
      )}
      {tab === "changes" && (
        <RepositoryChanges
          commitBody={commitBody}
          commitSubject={commitSubject}
          controller={details}
          mutations={mutations}
          onCommitBodyChange={setCommitBody}
          onCommitSubjectChange={setCommitSubject}
          onCommitted={() => {
            setCommitSubject("");
            setCommitBody("");
          }}
        />
      )}
      {tab === "history" && (
        <RepositoryHistory controller={details} />
      )}
      {tab === "branches" && (
        <RepositoryBranches
          commands={commands}
          controller={details}
          target={target}
          worktreePath={resolved.worktree?.path}
        />
      )}
      {tab === "worktrees" && (
        <RepositoryWorktrees
          commands={worktreeCommands}
          repositoryId={target.repositoryId}
          snapshots={snapshots}
          workspace={workspace}
        />
      )}
      {worktreeCommands.preflight && (
        <WorktreeCommandDialog
          active={worktreeCommands.active}
          onCancel={worktreeCommands.dismissPreflight}
          onConfirm={() =>
            void worktreeCommands.confirm()
          }
          preflight={worktreeCommands.preflight}
          workspace={workspace}
        />
      )}
    </div>
  );
}

function RepositoryOverview({
  snapshot,
  worktreeCount,
  onOpenTab
}: {
  snapshot: RepositoryStatusSnapshotDto | undefined;
  worktreeCount: number;
  onOpenTab(tab: RepositoryTab): void;
}) {
  const changes = getSnapshotChangeCount(snapshot);

  return (
    <>
      <section className="repository-health-grid">
        <article className="repository-health-card">
          <span>当前分支</span>
          <strong>{snapshot?.branch ?? "detached"}</strong>
          <small>{snapshot?.upstream ?? "未配置上游"}</small>
        </article>
        <article className="repository-health-card">
          <span>工作区变更</span>
          <strong>{changes}</strong>
          <small title={workspaceChangeSummary(snapshot)}>
            {workspaceChangeSummary(snapshot)}
          </small>
        </article>
        <article className="repository-health-card">
          <span>远程同步</span>
          <strong>
            ↑{snapshot?.ahead ?? 0} ↓{snapshot?.behind ?? 0}
          </strong>
          <small>刷新状态不执行 Fetch</small>
        </article>
        <article className="repository-health-card">
          <span>Worktrees</span>
          <strong>{worktreeCount}</strong>
          <small>共享同一个 commonDir</small>
        </article>
      </section>

      <section className="repository-overview-grid">
        <article className="panel">
          <header className="panel-header">
            <div className="panel-title">
              <Icon name="files" />
              工作区状态
            </div>
          </header>
          <div className="repository-overview-summary">
            <span
              className={`empty-state-icon ${
                changes > 0 ? "warning-icon" : ""
              }`}
            >
              <Icon
                name={changes > 0 ? "warning" : "check"}
                size={20}
              />
            </span>
            <div>
              <strong>
                {changes > 0
                  ? `${changes} 项未提交变更`
                  : "工作区干净"}
              </strong>
              <p>
                {snapshot?.refreshedAt
                  ? `状态更新于 ${new Date(
                      snapshot.refreshedAt
                    ).toLocaleString()}`
                  : "等待首次状态刷新。"}
              </p>
              <button
                className="button"
                onClick={() => onOpenTab("changes")}
                type="button"
              >
                查看变更
              </button>
            </div>
          </div>
        </article>

        <article className="panel">
          <header className="panel-header">
            <div className="panel-title">
              <Icon name="branch" />
              快速入口
            </div>
          </header>
          <div className="repository-quick-links">
            <button
              onClick={() => onOpenTab("history")}
              type="button"
            >
              <Icon name="activity" />
              提交历史
            </button>
            <button
              onClick={() => onOpenTab("branches")}
              type="button"
            >
              <Icon name="branch" />
              分支列表
            </button>
            <button
              onClick={() => onOpenTab("worktrees")}
              type="button"
            >
              <Icon name="worktree" />
              Worktrees
            </button>
          </div>
        </article>
      </section>
    </>
  );
}

function RepositoryChanges({
  controller,
  mutations,
  commitSubject,
  commitBody,
  onCommitSubjectChange,
  onCommitBodyChange,
  onCommitted
}: {
  controller: ReturnType<typeof useRepositoryDetails>;
  mutations: ReturnType<typeof useRepositoryMutations>;
  commitSubject: string;
  commitBody: string;
  onCommitSubjectChange(value: string): void;
  onCommitBodyChange(value: string): void;
  onCommitted(): void;
}) {
  const changes = controller.changes?.snapshot.changes ?? [];
  const selected = changes.find(
    (change) => change.path === controller.selectedChange?.path
  );
  const diff = controller.diff?.diff;
  const lines = diff?.content.split(/\r?\n/).slice(0, 4_000) ?? [];

  if (controller.loading.changes && !controller.changes) {
    return <RepositoryLoading label="正在读取工作区变更…" />;
  }

  if (!controller.changes && controller.error) {
    return (
      <RepositoryReadFailure label="工作区变更暂时不可用" />
    );
  }

  if (changes.length === 0) {
    return (
      <div className="empty-state repository-empty-state">
        <span className="empty-state-icon">
          <Icon name="check" size={20} />
        </span>
        <div>
          <strong>工作区干净</strong>
          <p>没有 staged、unstaged、untracked 或冲突文件。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="changes-page">
      <section className="changes-layout">
      <div className="changes-file-pane">
        <header className="file-pane-header">
          <strong>变更文件</strong>
          <span>{changes.length}</span>
        </header>
        <div className="change-file-list">
          {changes.map((change) => (
            <button
              className={`change-file-row${
                change.path === controller.selectedChange?.path
                  ? " selected"
                  : ""
              }`}
              key={`${change.kind}:${change.path}`}
              onClick={() => void controller.selectChange(change)}
              type="button"
            >
              <span className={`change-code kind-${change.kind}`}>
                {changeCode(change)}
              </span>
              <span>
                <strong>{change.path}</strong>
                <small>
                  {change.originalPath
                    ? `原路径：${change.originalPath}`
                    : changeKindLabel(change)}
                </small>
              </span>
              <Icon name="chevron" size={12} />
            </button>
          ))}
        </div>
      </div>

        <div className="diff-pane">
        <header className="diff-header">
          <div>
            <strong>{selected?.path ?? "选择一个文件"}</strong>
            <span>
              {diff
                ? `+${diff.additions} / -${diff.deletions}`
                : "按需读取文本 Diff"}
            </span>
          </div>
          {selected && (
            <div className="diff-header-actions">
              <div className="diff-mode-actions">
                {selected.indexStatus !== "." &&
                  selected.kind !== "untracked" && (
                    <button
                      className={
                        controller.selectedChange?.mode ===
                        "staged"
                          ? "active"
                          : ""
                      }
                      onClick={() =>
                        void controller.selectChange(
                          selected,
                          "staged"
                        )
                      }
                      type="button"
                    >
                      已暂存
                    </button>
                  )}
                {selected.worktreeStatus !== "." &&
                  selected.kind !== "untracked" && (
                    <button
                      className={
                        controller.selectedChange?.mode ===
                        "unstaged"
                          ? "active"
                          : ""
                      }
                      onClick={() =>
                        void controller.selectChange(
                          selected,
                          "unstaged"
                        )
                      }
                      type="button"
                    >
                      未暂存
                    </button>
                  )}
              </div>
              <div className="mutation-file-actions">
                {canUnstageChange(selected) && (
                  <button
                    className="button"
                    disabled={mutations.active !== null}
                    onClick={() =>
                      void mutations.unstageChange(selected)
                    }
                    type="button"
                  >
                    <Icon name="close" size={13} />
                    {mutations.active === "unstage"
                      ? "处理中…"
                      : "取消暂存"}
                  </button>
                )}
                {canStageChange(selected) && (
                  <button
                    className="button primary"
                    disabled={mutations.active !== null}
                    onClick={() =>
                      void mutations.stageChange(selected)
                    }
                    type="button"
                  >
                    <Icon name="plus" size={13} />
                    {mutations.active === "stage"
                      ? "处理中…"
                      : "暂存"}
                  </button>
                )}
              </div>
            </div>
          )}
        </header>
        {controller.loading.diff ? (
          <RepositoryLoading label="正在生成 Diff…" compact />
        ) : diff?.binary ? (
          <div className="diff-empty">
            <Icon name="files" size={20} />
            <strong>二进制文件</strong>
            <span>当前版本不在 Renderer 中加载二进制内容。</span>
          </div>
        ) : diff ? (
          <div className="diff-content" role="region" aria-label="文件 Diff">
            {lines.map((line, index) => (
              <div
                className={diffLineClass(line)}
                key={`${index}:${line.slice(0, 24)}`}
              >
                <span>{index + 1}</span>
                <code>{line || " "}</code>
              </div>
            ))}
            {(diff.truncated ||
              diff.content.split(/\r?\n/).length > lines.length) && (
              <div className="diff-truncated">
                Diff 已达到安全显示上限，其余内容未载入。
              </div>
            )}
          </div>
        ) : (
          <div className="diff-empty">
            <Icon name="files" size={20} />
            <strong>选择文件查看 Diff</strong>
            <span>读取按需执行，并受输出大小上限保护。</span>
          </div>
        )}
        </div>
      </section>
      <CommitComposer
        body={commitBody}
        controller={controller}
        mutations={mutations}
        subject={commitSubject}
        onBodyChange={onCommitBodyChange}
        onCommitted={onCommitted}
        onSubjectChange={onCommitSubjectChange}
      />
    </div>
  );
}

function CommitComposer({
  controller,
  mutations,
  subject,
  body,
  onSubjectChange,
  onBodyChange,
  onCommitted
}: {
  controller: ReturnType<typeof useRepositoryDetails>;
  mutations: ReturnType<typeof useRepositoryMutations>;
  subject: string;
  body: string;
  onSubjectChange(value: string): void;
  onBodyChange(value: string): void;
  onCommitted(): void;
}) {
  const staged = controller.changes?.snapshot.staged ?? 0;
  const conflicted =
    controller.changes?.snapshot.conflicted ?? 0;
  const busy = mutations.active !== null;
  const canCommit =
    staged > 0 &&
    conflicted === 0 &&
    Boolean(subject.trim()) &&
    !busy;

  const submit = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    if (!canCommit) {
      return;
    }

    const committed = await mutations.createCommit(
      subject,
      body
    );
    if (committed) {
      onCommitted();
    }
  };

  return (
    <article className="panel commit-composer">
      <header className="panel-header">
        <div className="panel-title">
          <Icon name="check" />
          创建提交
        </div>
        <span
          className={`status-pill ${
            conflicted > 0
              ? "yellow"
              : staged > 0
                ? "green"
                : "neutral"
          }`}
        >
          {conflicted > 0
            ? `${conflicted} 个冲突`
            : `${staged} 个已暂存`}
        </span>
      </header>
      <form className="commit-form" onSubmit={submit}>
        <label htmlFor="commit-subject">
          提交主题
          <span>{subject.length}/200</span>
        </label>
        <input
          id="commit-subject"
          maxLength={200}
          onChange={(event) =>
            onSubjectChange(event.target.value)
          }
          placeholder="简洁描述这次变更"
          value={subject}
        />
        <label htmlFor="commit-body">
          正文（可选）
          <span>{body.length}/100000</span>
        </label>
        <textarea
          id="commit-body"
          maxLength={100_000}
          onChange={(event) =>
            onBodyChange(event.target.value)
          }
          placeholder="补充背景、影响或验证说明"
          rows={4}
          value={body}
        />
        <div className="commit-form-footer">
          <p>{commitGuidance(staged, conflicted)}</p>
          <button
            className="button primary"
            disabled={!canCommit}
            type="submit"
          >
            <Icon
              name={
                mutations.active === "commit"
                  ? "refresh"
                  : "check"
              }
            />
            {mutations.active === "commit"
              ? "提交中…"
              : "提交已暂存变更"}
          </button>
        </div>
      </form>
    </article>
  );
}

function RepositoryHistory({
  controller
}: {
  controller: ReturnType<typeof useRepositoryDetails>;
}) {
  const commits = controller.history?.page.commits ?? [];
  const selected = controller.commit?.commit;

  if (controller.loading.history && commits.length === 0) {
    return <RepositoryLoading label="正在读取提交历史…" />;
  }

  if (!controller.history && controller.error) {
    return <RepositoryReadFailure label="提交历史暂时不可用" />;
  }

  if (commits.length === 0) {
    return (
      <div className="empty-state repository-empty-state">
        <span className="empty-state-icon">
          <Icon name="activity" size={20} />
        </span>
        <div>
          <strong>暂无提交历史</strong>
          <p>空仓库在首次提交后会显示历史。</p>
        </div>
      </div>
    );
  }

  return (
    <section className="history-layout">
      <div className="history-list panel">
        <header className="panel-header">
          <div className="panel-title">
            <Icon name="activity" />
            提交历史
          </div>
          <span className="panel-caption">{commits.length} 条</span>
        </header>
        {commits.map((item) => (
          <button
            className={`commit-row${
              item.hash === controller.selectedCommitHash
                ? " selected"
                : ""
            }`}
            key={item.hash}
            onClick={() => void controller.selectCommit(item.hash)}
            type="button"
          >
            <span className="commit-node" />
            <span>
              <strong>{item.subject}</strong>
              <small>
                {item.authorName} ·{" "}
                {new Date(item.authoredAt).toLocaleString()}
              </small>
            </span>
            <code>{item.shortHash}</code>
          </button>
        ))}
        {controller.history?.page.nextOffset !== undefined && (
          <button
            className="load-more-button"
            disabled={controller.loading.history}
            onClick={() => void controller.loadMoreHistory()}
            type="button"
          >
            {controller.loading.history ? "加载中…" : "加载更多"}
          </button>
        )}
      </div>

      <article className="commit-detail panel">
        <header className="panel-header">
          <div className="panel-title">
            <Icon name="files" />
            提交详情
          </div>
        </header>
        {controller.loading.commit ? (
          <RepositoryLoading label="正在读取提交详情…" compact />
        ) : selected ? (
          <div className="commit-detail-body">
            <h2>{selected.subject}</h2>
            <div className="commit-detail-meta">
              <span>{selected.authorName}</span>
              <code>{selected.shortHash}</code>
              <span>
                {new Date(selected.authoredAt).toLocaleString()}
              </span>
            </div>
            {selected.refs.length > 0 && (
              <div className="commit-refs">
                {selected.refs.map((ref) => (
                  <span key={ref}>{ref}</span>
                ))}
              </div>
            )}
            <pre>{selected.body}</pre>
            <div className="commit-stat-summary">
              <span>{selected.files.length} 个文件</span>
              <span className="text-success">
                +{selected.additions}
              </span>
              <span className="text-danger">
                -{selected.deletions}
              </span>
            </div>
            <div className="commit-file-list">
              {selected.files.slice(0, 100).map((file) => (
                <div key={file.path}>
                  <span title={file.path}>{file.path}</span>
                  <code>
                    {file.binary
                      ? "binary"
                      : `+${file.additions ?? 0} -${file.deletions ?? 0}`}
                  </code>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="diff-empty">
            <Icon name="activity" size={20} />
            <strong>选择提交查看详情</strong>
          </div>
        )}
      </article>
    </section>
  );
}

function RepositoryBranches({
  controller,
  commands,
  target,
  worktreePath
}: {
  controller: ReturnType<typeof useRepositoryDetails>;
  commands: RepositoryCommandController;
  target: RepositoryTargetDto;
  worktreePath: string | undefined;
}) {
  const branches = controller.branches?.branches ?? [];
  const [newBranch, setNewBranch] = useState("");
  const [renamingBranch, setRenamingBranch] =
    useState<string | null>(null);
  const [renamedBranch, setRenamedBranch] = useState("");
  const localCount = branches.filter(
    (branch) => !branch.remote
  ).length;
  const remoteCount = branches.length - localCount;

  const createBranch = (event: FormEvent) => {
    event.preventDefault();
    const branch = newBranch.trim();
    if (!branch || commands.busy) {
      return;
    }
    void commands
      .request({
        type: "create-branch",
        target,
        branch
      })
      .then((accepted) => {
        if (accepted) {
          setNewBranch("");
        }
      });
  };

  const renameBranch = (
    event: FormEvent,
    branch: string
  ) => {
    event.preventDefault();
    const newName = renamedBranch.trim();
    if (
      !newName ||
      newName === branch ||
      commands.busy
    ) {
      return;
    }
    void commands
      .request({
        type: "rename-branch",
        target,
        branch,
        newName
      })
      .then((accepted) => {
        if (accepted) {
          setRenamingBranch(null);
          setRenamedBranch("");
        }
      });
  };

  if (controller.loading.branches && branches.length === 0) {
    return <RepositoryLoading label="正在读取分支…" />;
  }

  if (!controller.branches && controller.error) {
    return <RepositoryReadFailure label="分支列表暂时不可用" />;
  }

  return (
    <article className="panel branches-panel">
      <header className="panel-header">
        <div className="panel-title">
          <Icon name="branch" />
          分支
        </div>
        <span className="panel-caption">
          {localCount} 本地 · {remoteCount} 远程
        </span>
      </header>
      <div className="branch-management-toolbar">
        <form onSubmit={createBranch}>
          <label htmlFor="new-branch-name">从当前 HEAD 创建分支</label>
          <div>
            <input
              id="new-branch-name"
              maxLength={255}
              onChange={(event) =>
                setNewBranch(event.target.value)
              }
              placeholder="例如 feature/safe-sync"
              spellCheck={false}
              value={newBranch}
            />
            <button
              className="button primary"
              disabled={
                commands.busy || !newBranch.trim()
              }
              type="submit"
            >
              <Icon
                name={
                  commands.active === "create-branch"
                    ? "refresh"
                    : "plus"
                }
              />
              {commands.active === "create-branch"
                ? "预检中…"
                : "创建"}
            </button>
          </div>
        </form>
        <p>
          分支写操作都会先展示目标、路径与引用影响；GitNest
          不会自动 Stash。
        </p>
      </div>
      <div className="branches-table" role="table">
        <div className="branches-row branches-head" role="row">
          <span role="columnheader">名称</span>
          <span role="columnheader">类型</span>
          <span role="columnheader">上游</span>
          <span role="columnheader">Worktree</span>
          <span role="columnheader">操作</span>
        </div>
        {branches.map((branch) => {
          const occupiedElsewhere =
            branchOccupiedElsewhere(
              branch.worktreePath,
              worktreePath
            );
          const editing =
            renamingBranch === branch.name &&
            !branch.remote;

          return (
            <div
              className={`branches-row${
                branch.current ? " current" : ""
              }`}
              key={branch.fullName}
              role="row"
            >
              <span role="cell">
                <Icon name="branch" size={13} />
                <strong>{branch.name}</strong>
                {branch.current && (
                  <span className="status-pill green">
                    当前
                  </span>
                )}
              </span>
              <span role="cell">
                {branch.remote ? "远程" : "本地"}
              </span>
              <span role="cell">
                {branch.upstream ?? "—"}
              </span>
              <span
                role="cell"
                title={branch.worktreePath}
              >
                {branch.worktreePath ?? "—"}
              </span>
              <span className="branch-row-actions" role="cell">
                {branch.remote ? (
                  "—"
                ) : editing ? (
                  <form
                    className="branch-rename-form"
                    onSubmit={(event) =>
                      renameBranch(event, branch.name)
                    }
                  >
                    <input
                      aria-label={`重命名 ${branch.name}`}
                      autoFocus
                      maxLength={255}
                      onChange={(event) =>
                        setRenamedBranch(event.target.value)
                      }
                      spellCheck={false}
                      value={renamedBranch}
                    />
                    <button
                      className="mini-action"
                      disabled={
                        commands.busy ||
                        !renamedBranch.trim() ||
                        renamedBranch.trim() === branch.name
                      }
                      type="submit"
                    >
                      保存
                    </button>
                    <button
                      className="mini-action"
                      disabled={commands.busy}
                      onClick={() => {
                        setRenamingBranch(null);
                        setRenamedBranch("");
                      }}
                      type="button"
                    >
                      取消
                    </button>
                  </form>
                ) : (
                  <>
                    <button
                      className="mini-action"
                      disabled={
                        commands.busy ||
                        branch.current ||
                        occupiedElsewhere
                      }
                      onClick={() =>
                        void commands.request({
                          type: "switch-branch",
                          target,
                          branch: branch.name
                        })
                      }
                      title={
                        occupiedElsewhere
                          ? "该分支已被其他 Worktree 检出"
                          : branch.current
                            ? "当前分支"
                            : "切换前执行脏状态与 Worktree 占用预检"
                      }
                      type="button"
                    >
                      {branch.current ? "当前" : "切换"}
                    </button>
                    <button
                      className="mini-action"
                      disabled={
                        commands.busy || occupiedElsewhere
                      }
                      onClick={() => {
                        setRenamingBranch(branch.name);
                        setRenamedBranch(branch.name);
                      }}
                      title={
                        occupiedElsewhere
                          ? "该分支已被其他 Worktree 检出"
                          : "重命名本地分支"
                      }
                      type="button"
                    >
                      重命名
                    </button>
                    <button
                      className="mini-action danger"
                      disabled={
                        commands.busy ||
                        branch.current ||
                        occupiedElsewhere
                      }
                      onClick={() =>
                        void commands.request({
                          type: "delete-branch",
                          target,
                          branch: branch.name
                        })
                      }
                      title={
                        branch.current
                          ? "不能删除当前分支"
                          : occupiedElsewhere
                            ? "该分支已被其他 Worktree 检出"
                            : "仅允许删除已合并的本地分支"
                      }
                      type="button"
                    >
                      删除
                    </button>
                  </>
                )}
              </span>
            </div>
          );
        })}
        {branches.length === 0 && (
          <div className="branches-empty">
            <Icon name="branch" size={18} />
            <strong>暂无分支</strong>
            <span>空仓库在首次提交后会显示本地分支。</span>
          </div>
        )}
      </div>
    </article>
  );
}

function branchOccupiedElsewhere(
  branchWorktreePath: string | undefined,
  currentWorktreePath: string | undefined
): boolean {
  if (!branchWorktreePath) {
    return false;
  }
  if (!currentWorktreePath) {
    return true;
  }
  return normalizeWorktreePath(branchWorktreePath) !==
    normalizeWorktreePath(currentWorktreePath);
}

function normalizeWorktreePath(path: string): string {
  return path
    .replace(/\//g, "\\")
    .replace(/\\+$/, "")
    .toLocaleLowerCase("en-US");
}

function RepositoryLoading({
  label,
  compact = false
}: {
  label: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`repository-loading${
        compact ? " compact" : ""
      }`}
      role="status"
    >
      <span className="empty-state-icon spinning">
        <Icon name="refresh" size={18} />
      </span>
      <span>{label}</span>
    </div>
  );
}

function RepositoryReadFailure({
  label
}: {
  label: string;
}) {
  return (
    <div className="empty-state repository-empty-state">
      <span className="empty-state-icon warning-icon">
        <Icon name="warning" size={20} />
      </span>
      <div>
        <strong>{label}</strong>
        <p>已保留其他成功读取的数据，可使用“重新读取”重试。</p>
      </div>
    </div>
  );
}

function preferredChangeCount(change: ChangedPathDto): number {
  return Number(change.indexStatus !== ".") +
    Number(change.worktreeStatus !== ".");
}

function workspaceChangeSummary(
  snapshot: RepositoryStatusSnapshotDto | undefined
): string {
  if (snapshot?.conflicted) {
    return `${snapshot.conflicted} 个冲突`;
  }

  const parts = [
    snapshot?.staged ? `${snapshot.staged} staged` : "",
    snapshot?.unstaged ? `${snapshot.unstaged} unstaged` : "",
    snapshot?.untracked ? `${snapshot.untracked} untracked` : ""
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : "无文件级变更";
}

function commitGuidance(
  staged: number,
  conflicted: number
): string {
  if (conflicted > 0) {
    return "请先解决并暂存全部冲突，再创建提交。";
  }
  if (staged === 0) {
    return "先从上方选择文件并执行暂存。";
  }
  return "将提交当前 Worktree 的全部已暂存变更；Git Hooks 保持启用。";
}

function changeCode(change: ChangedPathDto): string {
  if (change.kind === "untracked") {
    return "?";
  }
  if (change.kind === "unmerged") {
    return "!";
  }
  return preferredChangeCount(change) > 1
    ? `${change.indexStatus}${change.worktreeStatus}`
    : change.indexStatus !== "."
      ? change.indexStatus
      : change.worktreeStatus;
}

function changeKindLabel(change: ChangedPathDto): string {
  return {
    ordinary: "已修改",
    renamed: "已重命名",
    unmerged: "存在冲突",
    untracked: "未跟踪"
  }[change.kind];
}

function diffLineClass(line: string): string {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return "diff-line added";
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return "diff-line removed";
  }
  if (line.startsWith("@@")) {
    return "diff-line hunk";
  }
  if (
    line.startsWith("diff ") ||
    line.startsWith("---") ||
    line.startsWith("+++")
  ) {
    return "diff-line header";
  }
  return "diff-line";
}

function snapshotTone(
  snapshot: RepositoryStatusSnapshotDto | undefined
): "neutral" | "blue" | "green" | "yellow" {
  if (snapshot?.error) {
    return "yellow";
  }
  if (!snapshot || snapshot.stale || snapshot.refreshPending) {
    return "blue";
  }
  if (getSnapshotChangeCount(snapshot) > 0) {
    return "yellow";
  }
  return "green";
}

function snapshotStatus(
  snapshot: RepositoryStatusSnapshotDto | undefined
): string {
  if (!snapshot) {
    return "等待状态";
  }
  if (snapshot.refreshPending) {
    return "刷新中";
  }
  if (snapshot.error) {
    return "读取失败";
  }
  if (snapshot.stale) {
    return "缓存状态";
  }
  const changes = getSnapshotChangeCount(snapshot);
  return changes > 0 ? `${changes} 项变更` : "工作区干净";
}

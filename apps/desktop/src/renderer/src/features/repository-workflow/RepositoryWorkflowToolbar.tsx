import { useEffect, useId, useState } from "react";
import type { ExternalApplicationController } from "../external-application/useExternalApplications";
import { Button } from "../../shared/ui/Button";
import { Dialog } from "../../shared/ui/Dialog";
import { Input } from "../../shared/ui/Input";
import { Textarea } from "../../shared/ui/Textarea";
import type { RepositoryWorkflowController } from "./useRepositoryWorkflow";
import type { RepositoryWorkflowStateDto } from "@gitnest/contracts";
import { WorkflowRevision, WorkflowRewriteNotice, workflowActionLabel } from "./RepositoryWorkflowPresentation";

export function RepositoryWorkflowToolbar({
  controller, busy = false, externalApplications
}: {
  controller: RepositoryWorkflowController;
  busy?: boolean;
  externalApplications: ExternalApplicationController;
}) {
  const disabled = busy || controller.busy || Boolean(controller.preflight);
  const state = controller.state;
  const editors = externalApplications.profiles.filter(profile =>
    !["file-explorer", "terminal", "git-bash"].includes(profile.kind));
  const preferred = editors.find(profile => profile.kind === externalApplications.preferredProfile?.kind) ?? editors[0];
  if (!state?.operation && !state?.conflictedPaths.length) return null;
  return <>
    {(controller.error || controller.notice) && <div className="repository-workflow-feedback"
      role={controller.error ? "alert" : "status"}>
      <span>{controller.error ?? controller.notice}</span>
      <Button size="small" onClick={controller.clearFeedback}>关闭提示</Button>
    </div>}
    {(state?.operation || Boolean(state?.conflictedPaths.length)) && <section
      className="repository-workflow-conflicts" aria-label="进行中的 Git 操作">
      <strong>{state?.operation ? `正在进行 ${state.operation}` : "存在未解决冲突"}</strong>
      {state?.currentReplay && <p>当前提交：<code>{state.currentReplay.commitHash.slice(0, 12)}</code> {state.currentReplay.subject}</p>}
      {state?.currentReplay?.isEmpty
        ? <p role="status">当前提交已没有文件变更。请选择跳过当前提交{state.currentReplay.canKeepEmpty ? "，或保留一条空提交记录后继续" : ""}。</p>
        : state?.currentReplay?.noCommit
          ? <p>当前为仅应用变更模式。解决冲突并标记后，继续操作会保留暂存结果，由你手动提交。</p>
        : state?.conflictedPaths.length
          ? <p>编辑并保存冲突文件后，将文件标记为已解决。所有冲突解决后可以继续操作。</p>
          : <p>当前操作尚未完成。可继续完成提交，或中止并恢复操作前的状态。</p>}
      {state?.currentReplay?.blockedReason && <p role="status">{state.currentReplay.blockedReason}</p>}
      {state?.currentReplay?.continueBlockedReason && <p role="status">{state.currentReplay.continueBlockedReason}</p>}
      {state?.currentReplay?.isEmpty && !state.currentReplay.canKeepEmpty && !state.currentReplay.blockedReason &&
        <p>此重放方式仅支持跳过空提交；如需保留，请在终端处理。</p>}
      {(state?.conflictedPaths ?? []).map(path => <div className="repository-workflow-conflict" key={path}>
        <code title={path}>{path}</code>
        <Button size="small" disabled={!preferred || externalApplications.active !== null}
          title={preferred ? `使用 ${preferred.label} 打开` : "请在设置中配置可用编辑器"}
          onClick={() => preferred && void externalApplications.openFile(preferred.kind, path)}>打开编辑器</Button>
        <Button size="small" disabled={disabled}
          onClick={() => void controller.request({ type: "mark-resolved", paths: [path] })}>标记已解决</Button>
      </div>)}
      {externalApplications.error && <p role="alert">{externalApplications.error.message}</p>}
      {state?.operation && <div className="repository-workflow-toolbar">
        <Button size="small" disabled={disabled || state.conflictedPaths.length > 0 || state.currentReplay?.isEmpty || Boolean(state.currentReplay?.continueBlockedReason)}
          onClick={() => void controller.request({ type: "continue" })}>继续 {state.operation}</Button>
        {state.operation !== "merge" && state.currentReplay && <>
          <Button size="small" disabled={disabled || !state.currentReplay.canSkip}
            onClick={() => void controller.request({ type: "skip" })}>跳过当前提交</Button>
          {state.currentReplay.isEmpty && <Button size="small" disabled={disabled || !state.currentReplay.canKeepEmpty}
            onClick={() => void controller.request({ type: "keep-empty" })}>保留空提交</Button>}
        </>}
        <Button size="small" disabled={disabled}
          onClick={() => void controller.request({ type: "abort" })}>中止 {state.operation}</Button>
      </div>}
    </section>}
  </>;
}

export function RepositoryWorkflowDraftDialog({ controller }: { controller: RepositoryWorkflowController }) {
  if (!controller.draft) return null;
  return <WorkflowDraftDialog
    key={`${controller.draft.type}:${controller.draft.path ?? ""}`}
    controller={controller} />;
}

function WorkflowDraftDialog({ controller }: { controller: RepositoryWorkflowController }) {
  const draft = controller.draft!;
  const [message, setMessage] = useState("");
  const [includeUntracked, setIncludeUntracked] = useState(Boolean(draft.path));
  const [undoMode, setUndoMode] = useState<"soft" | "mixed">("soft");
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [initialState, setInitialState] = useState<RepositoryWorkflowStateDto | null>(null);
  const id = useId();
  useEffect(() => {
    let live = true;
    void controller.reload().then(state => {
      if (!live) return;
      setLoading(false);
      setLoaded(Boolean(state));
      setInitialState(state);
      if (state && draft.type === "amend") setMessage(state.headMessage);
    });
    return () => { live = false; };
  }, [controller.reload, draft.type]);
  const busy = loading || controller.busy;
  const snapshot = controller.state ?? initialState;
  const headChanged = loaded && Boolean(
    (draft.expectedHead && snapshot?.head !== draft.expectedHead) ||
    (draft.type !== "create-stash" && initialState &&
      (snapshot?.head !== initialState.head || snapshot?.branch !== initialState.branch))
  );
  const title = draft.type === "create-stash" ? "创建储藏" :
    draft.type === "amend" ? "修改最近一次提交（Amend）" : "撤销最近提交（保留修改）";
  const action = draft.type === "create-stash"
    ? { type: "create-stash" as const, message: message.trim(), includeUntracked,
        ...(draft.path ? { paths: draft.paths ?? [draft.path] } : {}) }
    : draft.type === "amend"
      ? { type: "amend" as const, message: message.trim(), ...(snapshot?.head ? { expectedHead: snapshot.head, expectedBranch: snapshot.branch } : {}) }
      : { type: "undo-commit" as const, mode: undoMode, ...(snapshot?.head ? { expectedHead: snapshot.head, expectedBranch: snapshot.branch } : {}) };
  const submit = async () => {
    if (busy || !loaded || !snapshot || headChanged) return;
    const accepted = await controller.request(action, { confirmed: true, reviewedState: snapshot });
    if (accepted) controller.closeDraft();
  };
  return <Dialog title={title} icon="commit" size="target" dismissDisabled={busy}
    onDismiss={controller.closeDraft}
    footer={<>
      <Button disabled={busy} onClick={controller.closeDraft}>取消</Button>
      <Button variant="primary" disabled={busy || !loaded || headChanged || (draft.type === "amend" && !message.trim())}
        onClick={() => void submit()}>{loading ? "正在读取…" : busy ? "正在执行…" : workflowActionLabel(action)}</Button>
    </>}>
    {draft.type !== "create-stash" && snapshot?.head && <section className="history-operation-context" aria-label="当前提交">
      <span>当前分支</span><strong>{snapshot.branch ?? "分离 HEAD"}</strong>
      <WorkflowRevision hash={snapshot.head} subject={snapshot.headMessage.split("\n")[0]} />
    </section>}
    {draft.type === "create-stash" ? <>
      <p>范围：{draft.path ?? "当前工作区全部改动"}</p>
      <Input id={`${id}-message`} label="储藏备注（可选）" fullWidth disabled={busy}
        value={message} onChange={event => setMessage(event.target.value)} />
      <label><input type="checkbox" checked={includeUntracked} disabled={busy}
        onChange={event => setIncludeUntracked(event.target.checked)} />包含未跟踪文件</label>
      <p>储藏成功后，所选范围的改动会从工作区移出；可在储藏列表恢复。</p>
    </> : draft.type === "amend" ? <>
      <Textarea id={`${id}-message`} label="提交信息" fullWidth rows={6} disabled={busy}
        value={message} onChange={event => setMessage(event.target.value)} />
      <p>使用上述信息和当前暂存内容替换最近一次提交。未暂存的改动保持不变。</p>
      <p>{controller.state?.hasStagedChanges ? "当前有暂存内容，会一并追加到提交。" : "当前没有暂存内容，仅修改提交信息。"}</p>
    </> : <>
      <p>将当前分支退回最近提交的父提交，文件改动保留在本地。</p>
      <p>最近提交会从当前分支历史中移除；如需保留历史并抵消变更，请使用“还原此提交（Revert）”。</p>
      {snapshot && snapshot.parentCount > 1 && <p>最近提交为合并提交，将退回第一父提交，并保留合并带来的文件修改。</p>}
      <label><input type="radio" name={`${id}-undo`} checked={undoMode === "soft"} disabled={busy}
        onChange={() => setUndoMode("soft")} />保留在暂存区</label>
      <label><input type="radio" name={`${id}-undo`} checked={undoMode === "mixed"} disabled={busy}
        onChange={() => setUndoMode("mixed")} />保留为未暂存改动</label>
    </>}
    {draft.type !== "create-stash" && snapshot && <WorkflowRewriteNotice state={snapshot} />}
    {headChanged && <p role="alert">最近提交已变化，请关闭对话框并刷新提交历史后重新选择。</p>}
    {controller.error && <p role="alert">{controller.error}</p>}
  </Dialog>;
}

import { useEffect, useId, useState } from "react";
import type { ExternalApplicationController } from "../external-application/useExternalApplications";
import { Button } from "../../shared/ui/Button";
import { Dialog } from "../../shared/ui/Dialog";
import { Input } from "../../shared/ui/Input";
import { Textarea } from "../../shared/ui/Textarea";
import type { RepositoryWorkflowController } from "./useRepositoryWorkflow";

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
        ? <p role="status">当前提交已没有文件变更。请选择跳过当前提交，或保留一条空提交记录后继续。</p>
        : <p>编辑并保存冲突文件后，将文件标记为已解决。所有冲突解决后可以继续操作。</p>}
      {state?.currentReplay?.blockedReason && <p role="status">{state.currentReplay.blockedReason}</p>}
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
        <Button size="small" disabled={disabled || state.conflictedPaths.length > 0 || state.currentReplay?.isEmpty}
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
  const id = useId();
  useEffect(() => {
    let live = true;
    void controller.reload().then(state => {
      if (!live) return;
      setLoading(false);
      setLoaded(Boolean(state));
      if (state && draft.type === "amend") setMessage(state.headMessage);
    });
    return () => { live = false; };
  }, [controller.reload, draft.type]);
  const busy = loading || controller.busy;
  const title = draft.type === "create-stash" ? "创建储藏" :
    draft.type === "amend" ? "修正最近一次提交" : "撤销最近一次提交";
  const submit = async () => {
    if (busy || !loaded) return;
    const accepted = await controller.request(draft.type === "create-stash"
      ? { type: "create-stash", message: message.trim(), includeUntracked,
          ...(draft.path ? { paths: draft.paths ?? [draft.path] } : {}) }
      : draft.type === "amend" ? { type: "amend", message: message.trim() }
      : { type: "undo-commit", mode: undoMode });
    if (accepted) controller.closeDraft();
  };
  return <Dialog title={title} icon="commit" size="target" dismissDisabled={busy}
    onDismiss={controller.closeDraft}
    footer={<>
      <Button disabled={busy} onClick={controller.closeDraft}>取消</Button>
      <Button variant="primary" disabled={busy || !loaded || (draft.type === "amend" && !message.trim())}
        onClick={() => void submit()}>{busy ? "正在读取…" : "检查并继续"}</Button>
    </>}>
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
      <label><input type="radio" name={`${id}-undo`} checked={undoMode === "soft"} disabled={busy}
        onChange={() => setUndoMode("soft")} />保留在暂存区</label>
      <label><input type="radio" name={`${id}-undo`} checked={undoMode === "mixed"} disabled={busy}
        onChange={() => setUndoMode("mixed")} />保留为未暂存改动</label>
    </>}
    {(draft.type === "amend" || draft.type === "undo-commit") && <p>
      这会改写本地历史。如果提交已推送，协作者的历史不会自动同步，请核对下一步显示的远程影响。
    </p>}
    {controller.error && <p role="alert">{controller.error}</p>}
  </Dialog>;
}

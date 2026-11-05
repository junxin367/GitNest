import { useEffect, useRef, useState } from "react";
import type { RepositoryWorkflowActionDto, RepositoryWorkflowStateDto } from "@gitnest/contracts";

import { Button } from "../../shared/ui/Button";
import { Dialog } from "../../shared/ui/Dialog";
import type { RepositoryCommitActionTarget } from "./RepositoryCommitActions";
import type { RepositoryWorkflowController } from "./useRepositoryWorkflow";
import { WorkflowRevision, WorkflowRewriteNotice, workflowActionLabel } from "./RepositoryWorkflowPresentation";

export type HistoryOperationType = "reset" | "checkout-commit" | "merge" | "rebase" | "cherry-pick" | "revert";
export interface HistoryOperationIntent {
  type: HistoryOperationType;
  commit: RepositoryCommitActionTarget;
}

const TITLES: Record<HistoryOperationType, string> = {
  reset: "重置到所选提交",
  "checkout-commit": "检出历史提交",
  merge: "合并到当前分支",
  rebase: "将当前分支变基到此处",
  "cherry-pick": "拣选提交（Cherry-pick）",
  revert: "还原此提交（Revert）"
};

export function RepositoryHistoryOperationDialog({ intent, controller, onClose }: {
  intent: HistoryOperationIntent;
  controller: RepositoryWorkflowController;
  onClose(): void;
}) {
  const [state, setState] = useState<RepositoryWorkflowStateDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [resetMode, setResetMode] = useState<"soft" | "mixed" | "hard">("soft");
  const [discardConfirmed, setDiscardConfirmed] = useState(false);
  const [mergeMode, setMergeMode] = useState<"normal" | "no-ff" | "squash">("normal");
  const [noCommit, setNoCommit] = useState(false);
  const [recordOrigin, setRecordOrigin] = useState(false);
  const [preserveMerges, setPreserveMerges] = useState(false);
  const [mainline, setMainline] = useState("");
  const mounted = useRef(true);
  const flight = useRef(false);
  const replay = intent.type === "cherry-pick" || intent.type === "revert";
  const needsMainline = replay && intent.commit.parentHashes.length > 1;
  const busy = loading || submitting || controller.busy;
  const snapshot = controller.state ?? state;
  const changed = state && snapshot &&
    (state.head !== snapshot.head || state.branch !== snapshot.branch);
  const hardReset = intent.type === "reset" && resetMode === "hard";
  const reviewRevision = JSON.stringify([snapshot?.head, snapshot?.branch, snapshot?.changedPaths, snapshot?.hasStagedChanges]);

  useEffect(() => { setDiscardConfirmed(false); }, [reviewRevision]);

  useEffect(() => {
    mounted.current = true;
    void controller.reload().then(value => {
      if (!mounted.current) return;
      setState(value);
      setLoading(false);
    }).catch(reason => {
      if (mounted.current) {
        setError(reason instanceof Error ? reason.message : "读取当前分支失败。");
        setLoading(false);
      }
    });
    return () => { mounted.current = false; };
  }, [controller.reload]);

  const makeAction = (): RepositoryWorkflowActionDto => {
    const base = { commitHash: intent.commit.hash, expectedHead: snapshot!.head!, expectedBranch: snapshot!.branch };
    switch (intent.type) {
      case "reset": return { type: "reset", ...base, mode: resetMode };
      case "checkout-commit": return { type: "checkout-commit", ...base };
      case "merge": return { type: "merge", ...base, mode: mergeMode, noCommit: mergeMode === "squash" || noCommit };
      case "rebase": return { type: "rebase", ...base, preserveMerges };
      case "cherry-pick": return { type: "cherry-pick", ...base, noCommit, recordOrigin,
        ...(needsMainline ? { mainline: Number(mainline) } : {}) };
      case "revert": return { type: "revert", ...base, noCommit,
        ...(needsMainline ? { mainline: Number(mainline) } : {}) };
    }
  };
  const submit = async () => {
    if (busy || flight.current || !state?.head || !snapshot?.head || changed ||
      (needsMainline && !mainline) || (hardReset && !discardConfirmed)) return;
    flight.current = true;
    setSubmitting(true);
    setError("");
    try {
      const accepted = await controller.request(makeAction(), { confirmed: true, reviewedState: snapshot });
      if (!mounted.current) return;
      if (accepted) onClose();
      else setError("操作未执行，请检查提示后重试。");
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : "操作未执行，请重试。");
    } finally {
      flight.current = false;
      if (mounted.current) setSubmitting(false);
    }
  };

  const title = replay && noCommit
    ? intent.type === "revert" ? "应用反向变更（不提交）" : "应用变更（不提交）"
    : TITLES[intent.type];
  return <Dialog title={title} icon={hardReset ? "warning" : "commit"} size="target"
    tone={hardReset ? "danger" : "default"} dismissDisabled={busy}
    onDismiss={onClose} footer={<>
      <Button data-modal-initial-focus={hardReset ? "true" : undefined} disabled={busy} onClick={onClose}>取消</Button>
      <Button disabled={busy || !state?.head || !snapshot?.head || Boolean(changed) ||
        (needsMainline && !mainline) || (hardReset && !discardConfirmed)}
        variant={hardReset ? "danger" : "primary"} onClick={() => void submit()}>
        {loading ? "正在读取…" : busy ? "正在执行…" : snapshot?.head ? workflowActionLabel(makeAction(), snapshot) : TITLES[intent.type]}
      </Button>
    </>}>
    <section className="history-operation-context" aria-label="操作方向">
      <span>{intent.type === "rebase" ? "新的基点" : "所选提交"}</span>
      <WorkflowRevision hash={intent.commit.hash} subject={intent.commit.subject} refName={intent.commit.refName} />
      <span>{intent.type === "merge" || replay ? "目标分支（当前）" : "当前分支"}</span>
      <strong>{loading ? "正在读取…" : snapshot?.branch ?? "分离 HEAD"}</strong>
      {intent.type === "merge" && <p>将所选提交合并到 <strong>{snapshot?.branch ?? "当前分支"}</strong>，更新当前分支。</p>}
      {intent.type === "rebase" && <p>将 <strong>{snapshot?.branch ?? "当前分支"}</strong> 的提交重放到上方基点之后，更新当前分支。</p>}
      {intent.type === "cherry-pick" && <p>{noCommit ? "将所选提交的变更应用到暂存区，检查后手动提交。" : "将所选提交的变更复制到当前分支，创建一条新提交。"}</p>}
      {intent.type === "revert" && <p>{noCommit
        ? "将抵消所选提交的反向变更放入暂存区，检查后手动提交；原提交保留。"
        : "创建一条反向提交来抵消所选提交的变更，原提交保留在历史中。"}</p>}
    </section>
    {intent.type === "reset" && <fieldset className="history-operation-options" disabled={busy}>
      <legend>重置方式</legend>
      {([
        ["soft", "Soft：仅移动 HEAD，保留暂存区和工作区"],
        ["mixed", "Mixed：保留文件修改，取消暂存"],
        ["hard", "Hard：覆盖暂存区和工作区，丢弃未提交修改"]
      ] as const).map(([mode, label]) => <label key={mode}>
        <input type="radio" name="history-reset-mode" value={mode} checked={resetMode === mode}
          onChange={() => { setResetMode(mode); setDiscardConfirmed(false); }} />{label}
      </label>)}
    </fieldset>}
    {intent.type === "checkout-commit" && <p>进入分离 HEAD，现有分支保持在原位置；如需继续开发，可从所选提交创建分支。</p>}
    {intent.type === "merge" && <fieldset className="history-operation-options" disabled={busy}>
      <legend>合并方式</legend>
      <select aria-label="合并方式" value={mergeMode} onChange={event => {
        const value = event.target.value as typeof mergeMode;
        setMergeMode(value);
        if (value === "squash") setNoCommit(true);
      }}>
        <option value="normal">允许快进合并</option>
        <option value="no-ff">禁用快进，创建合并提交</option>
        <option value="squash">Squash：合并变更后手动提交</option>
      </select>
      <label><input type="checkbox" checked={noCommit} disabled={mergeMode === "squash"}
        onChange={event => setNoCommit(event.target.checked)} />仅准备合并结果，不自动提交</label>
      {noCommit && mergeMode !== "squash" && <p>将同时禁用快进，确保结果停留在待确认状态。</p>}
    </fieldset>}
    {intent.type === "rebase" && <fieldset className="history-operation-options" disabled={busy}>
      <legend>变基选项</legend>
      <label><input type="checkbox" checked={preserveMerges} onChange={event => setPreserveMerges(event.target.checked)} />重建并保留合并结构</label>
      <p>出现冲突时可继续、跳过或中止。</p>
    </fieldset>}
    {replay && <fieldset className="history-operation-options" disabled={busy}>
      <legend>应用方式</legend>
      {needsMainline && <><label htmlFor="history-mainline">主线父提交</label>
        <select id="history-mainline" value={mainline} onChange={event => setMainline(event.target.value)}>
          <option value="">请选择主线父提交</option>
          {intent.commit.parentHashes.map((hash, index) => <option key={hash} value={index + 1}>
            第 {index + 1} 个父提交 · {hash.slice(0, 12)}
          </option>)}
        </select>
        <p>{intent.type === "revert" ? "抵消" : "只应用"}该合并提交相对于所选父提交的变更。</p></>}
      <label><input id="history-no-commit" type="checkbox" checked={noCommit}
        onChange={event => { setNoCommit(event.target.checked); if (event.target.checked) setRecordOrigin(false); }} />只应用变更，不自动提交</label>
      {intent.type === "cherry-pick" && <label><input id="history-record-origin" type="checkbox" checked={recordOrigin}
        disabled={noCommit} onChange={event => setRecordOrigin(event.target.checked)} />在提交说明中记录原始提交 ID</label>}
    </fieldset>}
    {(intent.type === "reset" || intent.type === "rebase") && snapshot && <WorkflowRewriteNotice state={snapshot} />}
    {hardReset && <div className="history-operation-notice" data-tone="danger">
      <p>Hard Reset 会丢弃已跟踪文件的暂存和未暂存修改；阻挡目标文件的未跟踪文件或目录也可能被删除。</p>
      {snapshot && snapshot.changedPaths.length > 0 && <details>
        <summary>当前有 {snapshot.changedPaths.length} 个变更路径</summary>
        <ul className="history-operation-paths">{snapshot.changedPaths.map(path => <li key={path}><code>{path}</code></li>)}</ul>
      </details>}
      <label><input id="history-reset-discard" type="checkbox" checked={discardConfirmed} disabled={busy}
        onChange={event => setDiscardConfirmed(event.target.checked)} />我确认丢弃未提交的修改</label>
    </div>}
    {changed && <p role="alert">当前分支或 HEAD 已变化，请关闭对话框并重新选择。</p>}
    {(error || controller.error) && <p role="alert">{controller.error || error}</p>}
  </Dialog>;
}

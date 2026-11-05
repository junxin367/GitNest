import type { RepositoryWorkflowActionDto, RepositoryWorkflowStateDto } from "@gitnest/contracts";

export function workflowActionLabel(action: RepositoryWorkflowActionDto, state?: RepositoryWorkflowStateDto): string {
  switch (action.type) {
    case "create-stash": return "储藏修改";
    case "amend": return "修改最近一次提交";
    case "undo-commit": return "撤销最近提交并保留修改";
    case "cherry-pick": return action.noCommit ? "仅应用变更" : `拣选到 ${state?.branch ?? "当前分支"}（Cherry-pick）`;
    case "revert": return action.noCommit ? "仅应用反向变更" : "还原此提交（Revert）";
    case "reset": return action.mode === "hard" ? `丢弃修改并重置 ${state?.branch ?? "当前分支"}` : `将 ${state?.branch ?? "当前分支"} 重置到此提交`;
    case "checkout-commit": return "检出此提交";
    case "merge": return action.mode === "squash" || action.noCommit ? "准备合并结果" : `合并到 ${state?.branch ?? "当前分支"}`;
    case "rebase": return `将 ${state?.branch ?? "当前分支"} 变基到此处`;
    case "mark-resolved": return "标记已解决并暂存";
    case "continue": return `继续 ${state?.operation ?? "当前操作"}`;
    case "skip": return "跳过当前提交";
    case "keep-empty": return "保留空提交并继续";
    case "abort": return `中止 ${state?.operation ?? "当前操作"}`;
  }
}

export function WorkflowRevision({ hash, subject, refName }: {
  hash: string;
  subject?: string | undefined;
  refName?: string | undefined;
}) {
  return <div className="history-operation-revision">
    {refName && <strong className="history-operation-ref">{refName}</strong>}
    <code title={hash}>{hash.slice(0, 12)}</code>
    {subject && <span>{subject}</span>}
  </div>;
}

export function WorkflowRewriteNotice({ state }: { state: RepositoryWorkflowStateDto }) {
  return <div className="history-operation-notice">
    <p>这会改写当前分支的本地历史。</p>
    {state.remoteBranchesContainingHead.length > 0
      ? <p>当前提交已存在于本地记录的远程分支：{state.remoteBranchesContainingHead.join("、")}。后续推送可能被拒绝，请先与协作者协调。</p>
      : <p>是否已推送依据本地远程引用判断；操作前请确认该历史可以改写。</p>}
  </div>;
}

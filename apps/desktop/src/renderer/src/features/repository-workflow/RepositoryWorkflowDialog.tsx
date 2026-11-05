import { Button } from "../../shared/ui/Button";
import { Dialog } from "../../shared/ui/Dialog";
import type { RepositoryWorkflowController } from "./useRepositoryWorkflow";
import { workflowActionLabel } from "./RepositoryWorkflowPresentation";

export function RepositoryWorkflowDialog({ controller }: { controller: RepositoryWorkflowController }) {
  const candidate = controller.preflight;
  if (!candidate) return null;
  const destructive = (candidate.command.type === "reset" && candidate.command.mode === "hard") ||
    candidate.command.type === "abort" || candidate.command.type === "skip";
  const actionLabel = workflowActionLabel(candidate.command, candidate.state);
  return (
    <Dialog title={actionLabel} icon={destructive ? "warning" : "operations"} size="target"
      tone={destructive ? "danger" : "default"}
      dismissDisabled={controller.busy} onDismiss={controller.dismiss}
      footer={<>
        <Button data-modal-initial-focus="true" disabled={controller.busy} onClick={controller.dismiss}>取消</Button>
        <Button disabled={controller.busy} variant={destructive ? "danger" : "primary"} onClick={() => void controller.confirm()}>
          {controller.busy ? "正在执行…" : actionLabel}
        </Button>
      </>}>
      <p>{candidate.summary}</p>
      <p>当前分支：{candidate.state.branch ?? "分离 HEAD"}</p>
      {candidate.state.head && <p><code title={candidate.state.head}>{candidate.state.head.slice(0, 12)}</code> {candidate.state.headMessage.split("\n")[0]}</p>}
      {candidate.command.type === "create-stash" && <>
        <p>范围：{candidate.command.paths?.join("、") || "全部改动"}</p>
        <p>{candidate.command.includeUntracked ? "包含未跟踪文件" : "不包含未跟踪文件"}</p>
      </>}
      {candidate.command.type === "amend" && <pre>{candidate.command.message}</pre>}
      {"commitHash" in candidate.command &&
        <p>所选提交：<code title={candidate.command.commitHash}>{candidate.command.commitHash.slice(0, 12)}</code></p>}
      {candidate.warnings.length > 0 && <ul>
        {candidate.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
      </ul>}
      {controller.error && <p role="alert">{controller.error}</p>}
    </Dialog>
  );
}

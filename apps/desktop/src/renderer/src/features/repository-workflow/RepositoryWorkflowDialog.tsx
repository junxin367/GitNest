import { Button } from "../../shared/ui/Button";
import { Dialog } from "../../shared/ui/Dialog";
import type { RepositoryWorkflowController } from "./useRepositoryWorkflow";

export function RepositoryWorkflowDialog({ controller }: { controller: RepositoryWorkflowController }) {
  const candidate = controller.preflight;
  if (!candidate) return null;
  return (
    <Dialog title="确认 Git 操作" icon="operations" size="target"
      dismissDisabled={controller.busy} onDismiss={controller.dismiss}
      footer={<>
        <Button data-modal-initial-focus="true" disabled={controller.busy} onClick={controller.dismiss}>取消</Button>
        <Button disabled={controller.busy} variant="primary" onClick={() => void controller.confirm()}>
          {controller.busy ? "正在执行…" : "确认并执行"}
        </Button>
      </>}>
      <p>{candidate.summary}</p>
      <p>当前分支：{candidate.state.branch ?? "分离 HEAD"}</p>
      {candidate.state.head && <p><code>{candidate.state.head}</code></p>}
      {candidate.command.type === "create-stash" && <>
        <p>范围：{candidate.command.paths?.join("、") || "全部改动"}</p>
        <p>{candidate.command.includeUntracked ? "包含未跟踪文件" : "不包含未跟踪文件"}</p>
      </>}
      {candidate.command.type === "amend" && <pre>{candidate.command.message}</pre>}
      {(candidate.command.type === "cherry-pick" || candidate.command.type === "revert") &&
        <p>所选提交：<code>{candidate.command.commitHash}</code></p>}
      {candidate.warnings.length > 0 && <ul>
        {candidate.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
      </ul>}
      {controller.error && <p role="alert">{controller.error}</p>}
    </Dialog>
  );
}

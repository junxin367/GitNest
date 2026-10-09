import { useEffect, useRef, useState } from "react";
import type { RepositoryCommitDto, RepositoryTargetDto } from "@gitnest/contracts";
import type { RepositoryCommandController } from "../repository-command/useRepositoryCommands";
import { Button } from "../../shared/ui/Button";
import { Dialog } from "../../shared/ui/Dialog";
import { Input } from "../../shared/ui/Input";

export type RepositoryCommitAction = "remote" | "cherry-pick" | "revert" | "create-branch";
export type RepositoryCommitActionHandler = (
  action: RepositoryCommitAction,
  commit: RepositoryCommitDto["commit"]
) => void | Promise<void>;

export function RepositoryCommitActionButtons({
  commit,
  busy = false,
  onAction
}: {
  commit: RepositoryCommitDto["commit"];
  busy?: boolean | undefined;
  onAction: RepositoryCommitActionHandler;
}) {
  return (
    <div className="quick-grid" aria-label="提交快捷操作">
      {([
        ["remote", "远程查看"],
        ["cherry-pick", "Cherry-pick"],
        ["revert", "还原此提交"],
        ["create-branch", "从此提交创建分支"]
      ] as const).map(([action, label]) => (
        <Button key={action} size="small" disabled={busy}
          onClick={() => void onAction(action, commit)} type="button">
          {label}
        </Button>
      ))}
    </div>
  );
}

export function CreateBranchFromCommitDialog({
  commit,
  target,
  commands,
  onClose
}: {
  commit: RepositoryCommitDto["commit"];
  target: RepositoryTargetDto;
  commands: RepositoryCommandController;
  onClose(): void;
}) {
  const [branch, setBranch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const busy = submitting || commands.busy;
  const submit = async () => {
    if (!branch.trim() || busy) return;
    setSubmitting(true);
    setError(null);
    try {
      const accepted = await commands.request({
        type: "create-branch",
        target,
        branch: branch.trim(),
        startPoint: commit.hash
      });
      if (mounted.current && accepted) onClose();
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : "分支创建失败。");
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  };
  return (
    <Dialog icon="branch" title="从所选提交创建分支" size="target"
      dismissDisabled={busy} onDismiss={onClose}
      footer={<>
        <Button disabled={busy} onClick={onClose}>取消</Button>
        <Button disabled={busy || !branch.trim()} variant="primary" onClick={() => void submit()}>
          {busy ? "正在检查…" : "创建分支"}
        </Button>
      </>}>
      <p>{commit.subject}</p>
      <p><code>{commit.hash}</code></p>
      <Input id="commit-new-branch" label="分支名称" fullWidth
        disabled={busy} value={branch} onChange={event => setBranch(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void submit();
          }
        }} />
      <p>新分支以该提交为起点；当前工作区不会自动切换分支。</p>
      {(error || commands.error) && <p role="alert">{error ?? commands.error?.message}</p>}
    </Dialog>
  );
}

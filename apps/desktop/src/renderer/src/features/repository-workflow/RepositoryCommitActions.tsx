import { useEffect, useRef, useState } from "react";
import type { RepositoryCommitDto, RepositoryTargetDto } from "@gitnest/contracts";
import type { RepositoryCommandController } from "../repository-command/useRepositoryCommands";
import { Button } from "../../shared/ui/Button";
import { Dialog } from "../../shared/ui/Dialog";
import { Input } from "../../shared/ui/Input";

export type RepositoryCommitAction = "remote" | "cherry-pick" | "revert" | "create-branch" |
  "cherry-pick-options" | "revert-options" | "reset" | "checkout-commit" | "merge" | "rebase";
export type RepositoryCommitActionTarget = Pick<
  RepositoryCommitDto["commit"],
  "hash" | "subject" | "parentHashes" | "stashRef"
> & { refName?: string };
export type RepositoryCommitActionHandler = (
  action: RepositoryCommitAction,
  commit: RepositoryCommitActionTarget
) => void | Promise<void>;

export function commitReplayBlockedReason(commit: RepositoryCommitActionTarget): string | undefined {
  if (commit.stashRef) return "储藏记录请使用恢复操作。";
  return undefined;
}

export function RepositoryCommitActionButtons({
  commit,
  busy = false,
  onAction
}: {
  commit: RepositoryCommitActionTarget;
  busy?: boolean | undefined;
  onAction: RepositoryCommitActionHandler;
}) {
  return (
    <div className="quick-grid" aria-label="提交快捷操作">
      {([
        ["remote", "远程查看"],
        ["cherry-pick", "拣选提交（Cherry-pick）"],
        ["revert", "还原此提交（Revert）"],
        ["create-branch", "创建分支"]
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
  commit: RepositoryCommitActionTarget;
  target: RepositoryTargetDto;
  commands: RepositoryCommandController;
  onClose(): void;
}) {
  const [branch, setBranch] = useState("");
  const [checkout, setCheckout] = useState(false);
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
        startPoint: commit.hash,
        checkout
      }, { confirmed: true });
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
          {busy ? "正在创建…" : checkout ? "创建并切换分支" : "创建分支"}
        </Button>
      </>}>
      <p>{commit.subject}</p>
      <p><code title={commit.hash}>{commit.hash.slice(0, 12)}</code></p>
      <Input id="commit-new-branch" label="分支名称" fullWidth
        disabled={busy} value={branch} onChange={event => setBranch(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void submit();
          }
        }} />
      <label><input id="commit-new-branch-checkout" type="checkbox" checked={checkout} disabled={busy}
        onChange={event => setCheckout(event.target.checked)} />创建后切换到此分支</label>
      <p>{checkout ? "新分支以该提交为起点，并立即切换；工作区有未提交修改时请先提交或储藏。"
        : "新分支以该提交为起点，当前工作区保持在原分支。"}</p>
      {(error || commands.error) && <p role="alert">{error ?? commands.error?.message}</p>}
    </Dialog>
  );
}

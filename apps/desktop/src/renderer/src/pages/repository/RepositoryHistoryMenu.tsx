import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type {
  BranchDto,
  RepositoryHistoryPageDto,
  RepositoryTargetDto,
  WorkspaceOperationDto
} from "@gitnest/contracts";

import { useRepositoryStashes } from "../../entities/repository/useRepositoryStashes";
import type { RepositoryCommandController } from "../../features/repository-command/useRepositoryCommands";
import { RepositoryTagActionDialog, type RepositoryTagIntent } from "../../features/repository-management/RepositoryTagActionDialog";
import {
  commitReplayBlockedReason,
  type RepositoryCommitActionHandler
} from "../../features/repository-workflow/RepositoryCommitActions";
import type { RepositoryWorkflowController } from "../../features/repository-workflow/useRepositoryWorkflow";
import { copyTextToClipboard } from "../../shared/lib/copyTextToClipboard";
import { Button } from "../../shared/ui/Button";
import { Dialog } from "../../shared/ui/Dialog";
import { Input } from "../../shared/ui/Input";
import { Icon } from "../../shared/ui/Icon";
import { LayerPortal } from "../../shared/ui/LayerPortal";
import { isEventInsideMenu, Menu, MenuHeading, MenuItem, MenuPopover, MenuSeparator } from "../../shared/ui/Menu";
import { Toast, ToastViewport } from "../../shared/ui/Toast";
import type { HistoryRefLabel } from "./RepositoryHistory";
import { RepositoryStashActionDialog } from "./RepositoryStashActions";

export type HistoryMenuCommit = RepositoryHistoryPageDto["page"]["commits"][number];
export interface HistoryContextMenuState {
  anchor: HTMLElement;
  x: number;
  y: number;
  commit: HistoryMenuCommit;
  refLabel?: HistoryRefLabel;
  refs?: HistoryRefLabel[];
}

export function RepositoryHistoryMenu({
  contextMenu,
  onClose,
  target,
  branches,
  currentBranchName,
  worktreePath,
  head,
  commands,
  workflow,
  operations,
  onCommitAction,
  onCopyCommitId,
  onRefresh,
  busy = false
}: {
  contextMenu: HistoryContextMenuState | null;
  onClose(): void;
  target: RepositoryTargetDto;
  branches: readonly BranchDto[];
  currentBranchName?: string | undefined;
  worktreePath?: string | undefined;
  head?: string | undefined;
  commands?: RepositoryCommandController | undefined;
  workflow?: RepositoryWorkflowController | undefined;
  operations: WorkspaceOperationDto[];
  onCommitAction?: RepositoryCommitActionHandler | undefined;
  onCopyCommitId(hash: string): Promise<void>;
  onRefresh(): Promise<void>;
  busy?: boolean | undefined;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const submenuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelSubmenuTimer = useCallback(() => {
    if (submenuTimerRef.current !== null) clearTimeout(submenuTimerRef.current);
    submenuTimerRef.current = null;
  }, []);
  const menuId = useId();
  const [openRef, setOpenRef] = useState<{
    label: HistoryRefLabel; anchor: HTMLButtonElement; id: string; autoFocus: boolean;
  } | null>(null);
  const [tagIntent, setTagIntent] = useState<RepositoryTagIntent | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [stashAction, setStashAction] = useState<{
    action: "apply" | "pop" | "drop"; commit: HistoryMenuCommit;
  } | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const stashes = useRepositoryStashes(target, `history:${target.repositoryId}:${target.worktreeId}`, {
    afterMutation: onRefresh
  });
  const locked = busy || commands?.busy || commands?.preflight || workflow?.busy ||
    workflow?.preflight || workflow?.draft || workflow?.state?.operation ||
    stashes.active || tagIntent || rename || stashAction;
  const visible = contextMenu && !locked;

  useEffect(() => {
    cancelSubmenuTimer();
    setOpenRef(null);
    return cancelSubmenuTimer;
  }, [contextMenu, cancelSubmenuTimer]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!visible || !menu) return;
    const updatePosition = () => {
      const rect = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(contextMenu.x, window.innerWidth - rect.width - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(contextMenu.y, window.innerHeight - rect.height - 8))}px`;
    };
    updatePosition();
    if (!menu.contains(document.activeElement)) {
      menu.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
    }
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updatePosition);
    observer?.observe(menu);
    return () => observer?.disconnect();
  }, [contextMenu, visible]);

  useEffect(() => {
    if (!contextMenu) return;
    if (locked) { onClose(); return; }
    const outside = (event: Event) => {
      if (!isEventInsideMenu(event, menuRef.current) &&
        !isEventInsideMenu(event, submenuRef.current)) onClose();
    };
    const closeAndFocus = () => {
      if (contextMenu.anchor.isConnected) contextMenu.anchor.focus({ preventScroll: true });
      onClose();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape" || event.key === "Tab") {
        if (event.key === "Escape") event.preventDefault();
        closeAndFocus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("scroll", outside, true);
    document.addEventListener("keydown", keydown);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    const observer = new MutationObserver(() => {
      if (!contextMenu.anchor.isConnected) onClose();
    });
    observer.observe(contextMenu.anchor.parentElement ?? document.body, { childList: true });
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("scroll", outside, true);
      document.removeEventListener("keydown", keydown);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [contextMenu, locked, onClose]);

  const choose = (action: () => void | Promise<void>) => {
    if (!contextMenu || locked) return;
    if (contextMenu.anchor.isConnected) contextMenu.anchor.focus({ preventScroll: true });
    onClose();
    try {
      void Promise.resolve(action()).catch(reason => setFeedback(reason instanceof Error ? reason.message : "操作未完成。"));
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : "操作未完成。");
    }
  };
  const copy = (text: string) => choose(async () => {
    await copyTextToClipboard(text);
    setFeedback("已复制到剪贴板。");
  });
  const label = contextMenu?.refLabel;
  const branchName = label ? historyMenuRefName(label) : undefined;
  const commit = contextMenu?.commit;
  const currentBranch = currentBranchName ?? branches.find(item => item.current && !item.remote)?.name ??
    workflow?.state?.branch ?? "当前分支";
  const mergeLabel = `合并到 ${currentBranch}（Merge）…`;
  const rebaseLabel = `将 ${currentBranch} 变基到此处（Rebase）…`;
  const isHead = Boolean(commit && (head ? commit.hash === head :
    commit.refs?.some(ref => ref === "HEAD" || ref.startsWith("HEAD -> "))));
  const replayReason = commit ? commitReplayBlockedReason(commit) : undefined;
  const closeTag = () => setTagIntent(null);
  const completeTag = () => {
    setTagIntent(null);
    void onRefresh().catch(reason => setFeedback(reason instanceof Error ? reason.message : "刷新历史失败。"));
  };
  const openRefMenu = (refLabel: HistoryRefLabel, anchor: HTMLButtonElement, id: string, autoFocus: boolean) => {
    cancelSubmenuTimer();
    if (submenuRef.current?.contains(document.activeElement)) anchor.focus({ preventScroll: true });
    setOpenRef(current => current?.label.key === refLabel.key && current.autoFocus === autoFocus
      ? current : { label: refLabel, anchor, id, autoFocus });
  };
  const closeRefMenu = () => {
    cancelSubmenuTimer();
    setOpenRef(null);
    openRef?.anchor.focus({ preventScroll: true });
  };
  const renderRefActions = (refLabel: HistoryRefLabel) => {
    if (!commit) return null;
    const name = historyMenuRefName(refLabel);
    const refCommit = { ...commit, refName: name };
    if (refLabel.kind === "tag") return <>
      <MenuItem disabled={!onCommitAction} onClick={() => choose(() => onCommitAction?.("checkout-commit", refCommit))}>检出此提交…</MenuItem>
      <MenuItem disabled={!onCommitAction || isHead} title={isHead ? "所选标签指向当前 HEAD。" : undefined}
        onClick={() => choose(() => onCommitAction?.("merge", refCommit))}>{mergeLabel}</MenuItem>
      <MenuItem disabled={!onCommitAction || isHead} title={isHead ? "所选标签指向当前 HEAD。" : undefined}
        onClick={() => choose(() => onCommitAction?.("rebase", refCommit))}>{rebaseLabel}</MenuItem>
      <MenuSeparator />
      <MenuItem onClick={() => choose(() => setTagIntent({ type: "tag-push", name }))}>推送标签…</MenuItem>
      <MenuItem tone="danger" onClick={() => choose(() => setTagIntent({ type: "tag-delete", name }))}>删除本地标签…</MenuItem>
      <MenuSeparator /><MenuItem onClick={() => copy(name)}>复制标签名称</MenuItem>
    </>;
    const branch = branches.find(item => item.name === name && item.remote === (refLabel.kind === "remote"));
    const normalizePath = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    const occupied = Boolean(branch?.worktreePath && (!worktreePath || normalizePath(branch.worktreePath) !== normalizePath(worktreePath)));
    const missingBranch = !branch || branch.head !== commit.hash;
    const branchReason = missingBranch ? "分支已变化，请刷新提交历史。" :
      occupied ? "该分支已被其他 Worktree 检出。" : undefined;
    return <>
      <MenuItem disabled={!commands || missingBranch || occupied || Boolean(branch?.current)}
        title={branchReason ?? (branch?.current ? "当前分支" : undefined)}
        onClick={() => choose(() => commands?.request({ type: "switch-branch", target, branch: name }).then(() => undefined))}>切换到此分支…</MenuItem>
      {refLabel.kind === "head" && <>
        <MenuItem disabled={!commands || Boolean(branchReason)} title={branchReason}
          onClick={() => choose(() => setRename(name))}>重命名分支…</MenuItem>
        <MenuItem disabled={!commands || Boolean(branchReason) || Boolean(branch?.current)}
          title={branchReason ?? (branch?.current ? "不能删除当前分支。" : "仅删除已合并的本地分支。")}
          tone="danger" onClick={() => choose(() => commands?.request({ type: "delete-branch", target, branch: name }).then(() => undefined))}>删除本地分支…</MenuItem>
      </>}
      <MenuSeparator />
      <MenuItem disabled={!onCommitAction || missingBranch || isHead}
        title={missingBranch ? "分支已变化，请刷新提交历史。" : isHead ? "所选分支指向当前 HEAD。" : undefined}
        onClick={() => choose(() => onCommitAction?.("merge", refCommit))}>{mergeLabel}</MenuItem>
      <MenuItem disabled={!onCommitAction || missingBranch || isHead}
        title={missingBranch ? "分支已变化，请刷新提交历史。" : isHead ? "所选分支指向当前 HEAD。" : undefined}
        onClick={() => choose(() => onCommitAction?.("rebase", refCommit))}>{rebaseLabel}</MenuItem>
      {branchReason && <MenuHeading>{branchReason}</MenuHeading>}
      <MenuSeparator />
      <MenuItem onClick={() => copy(name)}>复制分支名称</MenuItem>
    </>;
  };

  return <>
    {visible && commit && <LayerPortal>
      <Menu aria-label={label ? `${branchName} ${label.kind === "tag" ? "标签" : "分支"}操作` : commit.stashRef ? `${commit.stashRef} 储藏操作` : "提交记录操作"}
        className="workspace-context-menu history-context-menu" ref={menuRef}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          cancelSubmenuTimer();
          if (openRef && (event.key === "Escape" || event.key === "ArrowLeft")) {
            event.preventDefault();
            event.stopPropagation();
            closeRefMenu();
          } else if (openRef && ["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
            setOpenRef(null);
          }
        }}
        onPointerOver={event => {
          if (!(event.target instanceof Element) || !event.currentTarget.contains(event.target)) return;
          const item = event.target.closest('[role="menuitem"]');
          if (item instanceof HTMLButtonElement && !item.disabled) item.focus({ preventScroll: true });
          if (item && !item.hasAttribute("data-history-ref-trigger")) {
            cancelSubmenuTimer();
            if (openRef) submenuTimerRef.current = setTimeout(() => {
              submenuTimerRef.current = null;
              setOpenRef(null);
            }, 180);
          }
        }}
        onPointerLeave={cancelSubmenuTimer}
        onScroll={() => { cancelSubmenuTimer(); setOpenRef(null); }}
        style={{ position: "fixed", left: contextMenu.x, top: contextMenu.y, maxHeight: "calc(100vh - 16px)", overflowY: "auto" }}>
        {(label || commit.stashRef) && <MenuHeading>{branchName ?? commit.stashRef}</MenuHeading>}
        {!label && !commit.stashRef && <>
          <MenuItem disabled={!onCommitAction} onClick={() => choose(() => onCommitAction?.("create-branch", commit))}>创建分支…</MenuItem>
          <MenuItem onClick={() => choose(() => setTagIntent({ type: "tag-create", revision: commit.hash, subject: commit.subject }))}>创建标签…</MenuItem>
          <MenuSeparator />
          <MenuItem disabled={!onCommitAction || Boolean(replayReason)} title={replayReason}
            onClick={() => choose(() => onCommitAction?.("revert", commit))}>还原此提交（Revert）…</MenuItem>
          {replayReason && <MenuHeading>{replayReason}</MenuHeading>}
          <MenuItem disabled={!onCommitAction} onClick={() => choose(() => onCommitAction?.("reset", commit))}>将 {currentBranch} 重置到此提交（Reset）…</MenuItem>
          <MenuItem disabled={!onCommitAction} title="检出所选提交并进入分离 HEAD；现有分支位置保持不变。"
            onClick={() => choose(() => onCommitAction?.("checkout-commit", commit))}>检出此提交…</MenuItem>
          {isHead && <>
            <MenuItem disabled={!workflow} onClick={() => choose(() => workflow?.openDraft("amend", undefined, undefined, commit.hash))}>修改最近一次提交（Amend）…</MenuItem>
            <MenuItem disabled={!workflow || commit.parentHashes.length === 0}
              title={commit.parentHashes.length === 0 ? "初始提交没有父提交，无法撤销。" : undefined}
              onClick={() => choose(() => workflow?.openDraft("undo-commit", undefined, undefined, commit.hash))}>撤销最近提交（保留修改）…</MenuItem>
          </>}
          <MenuSeparator />
          <MenuItem disabled={!onCommitAction || Boolean(replayReason)} title={replayReason}
            onClick={() => choose(() => onCommitAction?.("cherry-pick", commit))}>拣选到 {currentBranch}（Cherry-pick）…</MenuItem>
          <MenuItem disabled={!onCommitAction || isHead} title={isHead ? "所选提交就是当前 HEAD。" : undefined}
            onClick={() => choose(() => onCommitAction?.("merge", commit))}>{mergeLabel}</MenuItem>
          <MenuItem disabled={!onCommitAction || isHead} title={isHead ? "所选提交就是当前 HEAD。" : undefined}
            onClick={() => choose(() => onCommitAction?.("rebase", commit))}>{rebaseLabel}</MenuItem>
          <MenuSeparator />
        </>}
        {label && renderRefActions(label)}
        {!label && commit.stashRef && <>
          <MenuItem onClick={() => choose(() => setStashAction({ action: "apply", commit }))}>恢复储藏</MenuItem>
          <MenuItem onClick={() => choose(() => setStashAction({ action: "pop", commit }))}>恢复并删除储藏</MenuItem>
          <MenuItem tone="danger" onClick={() => choose(() => setStashAction({ action: "drop", commit }))}>删除储藏</MenuItem>
          <MenuSeparator /><MenuItem onClick={() => copy(commit.stashRef!)}>复制储藏名称</MenuItem>
        </>}
        <MenuItem onClick={() => choose(() => onCopyCommitId(commit.hash))}>复制 SHA</MenuItem>
        {!label && <MenuItem onClick={() => copy(commit.subject)}>复制提交信息</MenuItem>}
        {!label && !commit.stashRef && <MenuItem disabled={!onCommitAction}
          onClick={() => choose(() => onCommitAction?.("remote", commit))}>在浏览器中查看提交</MenuItem>}
        {!label && !commit.stashRef && Boolean(contextMenu.refs?.length) && <>
          <MenuSeparator />
          {contextMenu.refs?.map((ref, index) => {
            const id = `${menuId}-ref-${index}`;
            const name = `${ref.kind === "tag" ? "标签" : ref.kind === "remote" ? "远程分支" : "分支"}：${historyMenuRefName(ref)}`;
            return <MenuItem key={ref.key} id={id} data-history-ref-trigger
              aria-label={name} aria-haspopup="menu" aria-expanded={openRef?.label.key === ref.key}
              aria-controls={openRef?.label.key === ref.key ? `${id}-menu` : undefined}
              leading={<Icon name={ref.kind === "tag" ? "tag" : "branch"} size={13} />}
              trailing={<Icon className="history-submenu-chevron" name="chevron" size={12} />}
              onPointerEnter={event => {
                if (event.pointerType === "touch") return;
                cancelSubmenuTimer();
                const anchor = event.currentTarget;
                if (openRef && openRef.label.key !== ref.key) {
                  // Keep the current submenu while the pointer crosses adjacent
                  // items diagonally on its way into the submenu.
                  submenuTimerRef.current = setTimeout(() => openRefMenu(ref, anchor, id, false), 180);
                } else openRefMenu(ref, anchor, id, false);
              }}
              onPointerLeave={cancelSubmenuTimer}
              onClick={event => openRefMenu(ref, event.currentTarget, id, true)}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (event.key === "ArrowRight" || event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openRefMenu(ref, event.currentTarget, id, true);
                }
              }}>{name}</MenuItem>;
          })}
        </>}
      </Menu>
      {openRef && !label && <MenuPopover key={openRef.label.key} anchor={openRef.anchor}
        ref={submenuRef} id={`${openRef.id}-menu`} aria-labelledby={openRef.id}
        className="history-context-menu history-ref-submenu" side="right" autoFocus={openRef.autoFocus}
        onPointerEnter={cancelSubmenuTimer}
        onPointerOver={event => {
          if (!(event.target instanceof Element)) return;
          const item = event.target.closest('[role="menuitem"]');
          if (item instanceof HTMLButtonElement && !item.disabled) item.focus({ preventScroll: true });
        }}
        onKeyDown={event => {
          event.stopPropagation();
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "ArrowLeft" || event.key === "Escape") {
            event.preventDefault();
            closeRefMenu();
          } else if (event.key === "Tab") {
            contextMenu.anchor.focus({ preventScroll: true });
            onClose();
          }
        }}>
        <MenuHeading>{historyMenuRefName(openRef.label)}</MenuHeading>
        {renderRefActions(openRef.label)}
      </MenuPopover>}
    </LayerPortal>}
    {rename && commands && <RenameHistoryBranchDialog branch={rename} target={target} commands={commands} onClose={() => setRename(null)} />}
    {tagIntent && <RepositoryTagActionDialog bridge={window.gitnest.repositoryManagement} target={target}
      intent={tagIntent} operations={operations} onDismiss={closeTag} onCompleted={completeTag} />}
    {stashAction?.commit.stashRef && <RepositoryStashActionDialog action={stashAction.action}
      mutationBusy={Boolean(stashes.active)} stash={{ ...stashAction.commit, ref: stashAction.commit.stashRef }}
      onCancel={() => setStashAction(null)} onConfirm={stashes.mutateStash} />}
    <ToastViewport>
      {feedback && <Toast title="历史记录操作" message={feedback} onClose={() => setFeedback(null)} />}
      {stashes.mutationError && <Toast title="储藏操作未完成" tone="error" message={stashes.mutationError.message} onClose={stashes.clearMutationFeedback} />}
      {stashes.notice && <Toast title="储藏操作" message={stashes.notice} onClose={stashes.clearMutationFeedback} />}
    </ToastViewport>
  </>;
}

function historyMenuRefName(label: HistoryRefLabel): string {
  return label.kind === "remote" ? `${label.remote}/${label.name}` : label.name;
}

function RenameHistoryBranchDialog({ branch, target, commands, onClose }: {
  branch: string; target: RepositoryTargetDto; commands: RepositoryCommandController; onClose(): void;
}) {
  const [name, setName] = useState(branch);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const submit = async () => {
    if (busy || commands.busy || !name.trim() || name.trim() === branch) return;
    setBusy(true);
    try {
      if (await commands.request({ type: "rename-branch", target, branch, newName: name.trim() }, { confirmed: true }) && mounted.current) onClose();
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : "重命名分支失败。");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return <Dialog title="重命名分支" icon="branch" size="target" onDismiss={onClose} dismissDisabled={busy || commands.busy}
    footer={<><Button disabled={busy || commands.busy} onClick={onClose}>取消</Button>
      <Button variant="primary" disabled={busy || commands.busy || !name.trim() || name.trim() === branch}
        onClick={() => void submit()}>{busy || commands.busy ? "正在重命名…" : "重命名分支"}</Button></>}>
    <p>当前名称：{branch}</p>
    <Input id="history-branch-name" label="新分支名称" value={name} disabled={busy || commands.busy} fullWidth
      onChange={event => setName(event.target.value)} />
    {(error || commands.error) && <p role="alert">{error || commands.error?.message}</p>}
  </Dialog>;
}

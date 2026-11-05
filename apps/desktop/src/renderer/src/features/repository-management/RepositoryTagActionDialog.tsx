import { useEffect, useMemo, useRef, useState } from "react";
import type {
  RepositoryManagementActionDto,
  RepositoryManagementBridge,
  RepositoryManagementStateDto,
  RepositoryTargetDto,
  WorkspaceOperationDto
} from "@gitnest/contracts";

import { Button } from "../../shared/ui/Button";
import { Dialog } from "../../shared/ui/Dialog";
import { Input } from "../../shared/ui/Input";

export type RepositoryTagIntent =
  | { type: "tag-create"; revision: string; subject: string }
  | { type: "tag-delete" | "tag-push"; name: string };

export function RepositoryTagActionDialog({
  bridge,
  target,
  intent,
  operations,
  onDismiss,
  onCompleted
}: {
  bridge: RepositoryManagementBridge;
  target: RepositoryTargetDto;
  intent: RepositoryTagIntent;
  operations: WorkspaceOperationDto[];
  onDismiss(): void;
  onCompleted(): void;
}) {
  const [state, setState] = useState<RepositoryManagementStateDto | null>(null);
  const [name, setName] = useState(intent.type === "tag-create" ? "" : intent.name);
  const [message, setMessage] = useState("");
  const [remote, setRemote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const mounted = useRef(false);
  const scope = useMemo(() => ({}), [bridge, target.repositoryId, target.worktreeId, intent.type,
    intent.type === "tag-create" ? intent.revision : intent.name]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const flight = useRef(false);
  const operation = operations.find(item => item.id === pendingId);
  const locked = busy || pendingId !== null;
  const multiplePushUrls = (state?.remotes.find(item => item.name === remote)?.pushUrls?.length ?? 1) > 1;
  const title = intent.type === "tag-create" ? "从所选提交创建标签" :
    intent.type === "tag-delete" ? "删除本地标签" : "推送标签";
  const actionLabel = intent.type === "tag-create" ? "创建标签" :
    intent.type === "tag-delete" ? "删除本地标签" : "推送标签";
  const destructive = intent.type === "tag-delete";

  useEffect(() => {
    let live = true;
    mounted.current = true;
    setState(null);
    setError("");
    setBusy(false);
    setPendingId(null);
    flight.current = false;
    void bridge.inspect({ target }).then(result => {
      if (!live) return;
      if (!result.ok) { setError(result.error.message); return; }
      setState(result.value);
      setRemote(result.value.remotes.find(item => item.name === "origin")?.name ?? result.value.remotes[0]?.name ?? "");
    }).catch(reason => {
      if (live) setError(reason instanceof Error ? reason.message : "读取标签失败。");
    });
    return () => { live = false; mounted.current = false; };
  }, [scope]);

  useEffect(() => {
    if (!operation || ["queued", "running", "cancelling"].includes(operation.state)) return;
    setPendingId(null);
    if (operation.state === "succeeded") onCompleted();
    else setError(operation.message || "标签操作未完成，请重新检查后重试。");
  }, [operation?.id, operation?.state, onCompleted]);

  const submit = async () => {
    if (flight.current || locked || !state || !name.trim()) return;
    flight.current = true;
    setBusy(true);
    setError("");
    const action: RepositoryManagementActionDto = intent.type === "tag-create"
      ? { type: "tag-create", name: name.trim(), revision: intent.revision, ...(message.trim() ? { message: message.trim() } : {}) }
      : intent.type === "tag-push"
        ? { type: "tag-push", name: intent.name, remote }
        : { type: "tag-delete", name: intent.name };
    try {
      const checked = await bridge.preflight({ target, action });
      if (!mounted.current || currentScope.current !== scope) return;
      if (!checked.ok) { setError(checked.error.message); return; }
      const result = await bridge.execute({ preflightId: checked.value.preflightId, confirmed: true });
      if (!mounted.current || currentScope.current !== scope) return;
      if (result.ok) setPendingId(result.value.operationId);
      else setError(result.error.message);
    } catch (reason) {
      if (mounted.current && currentScope.current === scope) {
        setError(reason instanceof Error ? reason.message : "标签操作失败。");
      }
    } finally {
      if (currentScope.current === scope) {
        flight.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  };
  return (
    <Dialog icon={destructive ? "warning" : "tag"} title={title} size="target" tone={destructive ? "danger" : "default"}
      dismissDisabled={locked} onDismiss={onDismiss}
      footer={<>
        <Button data-modal-initial-focus={destructive ? "true" : undefined} disabled={locked} onClick={onDismiss}>取消</Button>
        <Button variant={destructive ? "danger" : "primary"}
          disabled={locked || !state || !name.trim() || (intent.type === "tag-push" && (!remote || multiplePushUrls))}
          onClick={() => void submit()}>{locked ? "正在执行…" : actionLabel}</Button>
      </>}>
      {intent.type === "tag-create" ? <>
        <p>{intent.subject}</p><p><code title={intent.revision}>{intent.revision.slice(0, 12)}</code></p>
        <Input id="history-tag-name" label="标签名称" fullWidth value={name} disabled={locked}
          onChange={event => setName(event.target.value)} />
        <Input id="history-tag-message" label="附注说明（可选）" fullWidth value={message} disabled={locked}
          onChange={event => setMessage(event.target.value)} />
      </> : <p>标签：<strong>{intent.name}</strong></p>}
      {intent.type === "tag-delete" && <p>删除此本地标签；远程标签保持不变。</p>}
      {intent.type === "tag-push" && <>
        <label htmlFor="history-tag-remote">推送到远程</label>
        <select id="history-tag-remote" value={remote} disabled={locked}
          onChange={event => setRemote(event.target.value)}>
          {state?.remotes.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
        </select>
        {state && !state.remotes.length && <p>当前仓库没有配置远程。</p>}
        {multiplePushUrls && <p role="alert">该远程配置了多个推送地址，请先整理为单一地址再推送。</p>}
      </>}
      {pendingId && <p role="status">操作已加入队列，完成后自动刷新提交历史。</p>}
      {error && <p role="alert">{error}</p>}
    </Dialog>
  );
}

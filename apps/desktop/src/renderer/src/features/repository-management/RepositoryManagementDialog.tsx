import { useEffect, useRef, useState } from "react";
import type {
  RepositoryManagementActionDto, RepositoryManagementBridge,
  RepositoryManagementPreflightDto, RepositoryManagementStateDto, RepositoryTargetDto, WorkspaceOperationDto
} from "@gitnest/contracts";
import { Dialog } from "../../shared/ui/Dialog";
import { Button } from "../../shared/ui/Button";
import { Input } from "../../shared/ui/Input";

export interface RepositoryManagementDialogProps {
  bridge: RepositoryManagementBridge;
  target: RepositoryTargetDto;
  onDismiss(): void;
  onOperationAccepted?(operationId: string): void;
  operations?: WorkspaceOperationDto[];
  targetLabel?: string;
  targetPath?: string;
}
export function RepositoryManagementDialog({ bridge, target, onDismiss, onOperationAccepted, operations, targetLabel, targetPath }: RepositoryManagementDialogProps) {
  const [state, setState] = useState<RepositoryManagementStateDto | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [preflight, setPreflight] = useState<RepositoryManagementPreflightDto | null>(null);
  const [name, setName] = useState("origin");
  const [url, setUrl] = useState("");
  const [tag, setTag] = useState("");
  const [revision, setRevision] = useState("HEAD");
  const [message, setMessage] = useState("");
  const [remote, setRemote] = useState("origin");
  const [pendingOperationId, setPendingOperationId] = useState<string | null>(null);
  const targetKey = `${target.repositoryId}:${target.worktreeId}`;
  const scopeRef = useRef(targetKey);
  scopeRef.current = targetKey;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const inScope = () => mounted.current && scopeRef.current === targetKey;
  const operation = operations?.find(item => item.id === pendingOperationId);
  const operationRunning = pendingOperationId !== null &&
    (!operation || operation.state === "queued" || operation.state === "running" || operation.state === "cancelling");
  const locked = busy || operationRunning;
  const multiplePushUrls = (state?.remotes.find(item => item.name === remote)?.pushUrls?.length ?? 1) > 1;
  useEffect(() => {
    if (!operation || operationRunning) return;
    setPendingOperationId(null);
    if (operation.state === "succeeded") {
      setNotice(operation.message || "操作完成，列表已刷新。");
    } else {
      setError(operation.message || "操作未完成，请检查仓库状态。");
      setNotice("");
    }
    void load().catch(failure => { if (inScope()) setError(String(failure)); });
  }, [operation?.id, operation?.state, operationRunning]);
  useEffect(() => {
    let current = true;
    setState(null); setPreflight(null); setError("");
    void bridge.inspect({ target }).then((result) => {
      if (!current) return;
      if (result.ok) { setState(result.value); setRemote(result.value.remotes.find((item) => item.name === "origin")?.name ?? result.value.remotes[0]?.name ?? ""); }
      else setError(result.error.message);
    }, (failure: unknown) => { if (current) setError(String(failure)); });
    return () => { current = false; };
  }, [bridge, targetKey]);
  async function load() {
    const result = await bridge.inspect({ target });
    if (!inScope()) return;
    if (result.ok) setState(result.value);
    else setError(result.error.message);
  }
  async function prepare(action: RepositoryManagementActionDto) {
    if (locked) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await bridge.preflight({ target, action });
      if (!inScope()) return;
      if (result.ok) setPreflight(result.value);
      else setError(result.error.message);
    } catch (failure) { if (inScope()) setError(String(failure)); } finally { if (inScope()) setBusy(false); }
  }
  async function execute() {
    if (!preflight || locked) return;
    setBusy(true); setError("");
    try {
      const result = await bridge.execute({ preflightId: preflight.preflightId, confirmed: true });
      if (!inScope()) return;
      setPreflight(null);
      if (result.ok) {
        if (operations) setPendingOperationId(result.value.operationId);
        setNotice(operations ? "操作已加入队列，完成后自动刷新。" : "操作已加入队列，完成后可刷新列表。");
        onOperationAccepted?.(result.value.operationId);
      } else setError(result.error.message);
    } catch (failure) { if (inScope()) setError(String(failure)); } finally { if (inScope()) setBusy(false); }
  }
  return <Dialog icon="branch" title="远程与标签管理" size="complex" dismissDisabled={busy} onDismiss={onDismiss}
    footer={<><Button disabled={busy} onClick={() => void load().catch((failure: unknown) => setError(String(failure)))}>刷新</Button><Button disabled={busy} onClick={onDismiss}>关闭</Button></>}>
    {targetLabel && <p><strong>{targetLabel}</strong></p>}
    {targetPath && <p>{targetPath}</p>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {preflight ? <section aria-label="确认仓库管理操作">
      <p>{preflight.summary}</p>
      {"url" in preflight.command.action && <p>{preflight.command.action.url}</p>}
      {preflight.command.action.type === "tag-create" && <p>提交：{preflight.command.action.revision}；{preflight.command.action.message ? "附注标签" : "轻量标签"}</p>}
      <Button disabled={busy} onClick={() => setPreflight(null)}>返回编辑</Button>
      <Button disabled={busy} variant="primary" onClick={() => void execute()}>确认执行</Button>
    </section> : <>
      <section aria-label="远程管理">
        <h3>远程地址</h3>
        <p>修改 fetch 地址；单独配置的 push 地址保留。删除远程会移除本地配置和对应远程跟踪引用。</p>
        {!state ? <p>正在读取…</p> : state.remotes.length === 0 ? <p>尚未配置远程。</p> : <ul>{state.remotes.map((item) => <li key={item.name}>
          <strong>{item.name}</strong> <span>{item.fetchUrl}</span>
          {(item.fetchUrls?.length ?? 0) > 1 && <p>Fetch：{item.fetchUrls!.join("、")}</p>}
          {(item.pushUrl !== item.fetchUrl || (item.pushUrls?.length ?? 0) > 1) && <p>Push：{item.pushUrls?.join("、") ?? item.pushUrl}</p>}
          <Button disabled={locked} onClick={() => { setName(item.name); setUrl(item.fetchUrl); }}>编辑</Button>
          <Button disabled={locked} onClick={() => void prepare({ type: "remote-remove", name: item.name })}>删除远程</Button>
        </li>)}</ul>}
        <div className="workspace-dialog-field"><label htmlFor="manage-remote-name">远程名称</label><Input id="manage-remote-name" value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></div>
        <div className="workspace-dialog-field"><label htmlFor="manage-remote-url">远程地址</label><Input id="manage-remote-url" fullWidth value={url} disabled={busy} onChange={(event) => setUrl(event.target.value)} /></div>
        <Button disabled={locked || !state || !name.trim() || !url.trim()} onClick={() => void prepare({ type: state?.remotes.some((item) => item.name === name.trim()) ? "remote-set-url" : "remote-add", name: name.trim(), url: url.trim() })}>保存远程</Button>
      </section>
      <section aria-label="标签管理">
        <h3>标签</h3>
        <div className="workspace-dialog-field"><label htmlFor="manage-tag-name">标签名称</label><Input id="manage-tag-name" value={tag} disabled={busy} onChange={(event) => setTag(event.target.value)} /></div>
        <div className="workspace-dialog-field"><label htmlFor="manage-tag-revision">目标提交或分支</label><Input id="manage-tag-revision" value={revision} disabled={busy} onChange={(event) => setRevision(event.target.value)} /></div>
        <div className="workspace-dialog-field"><label htmlFor="manage-tag-message">附注说明（可选）</label><Input id="manage-tag-message" value={message} disabled={busy} onChange={(event) => setMessage(event.target.value)} /></div>
        <Button disabled={locked || !state || !tag.trim() || !revision.trim()} onClick={() => void prepare({ type: "tag-create", name: tag.trim(), revision: revision.trim(), ...(message.trim() ? { message: message.trim() } : {}) })}>创建标签</Button>
        <div className="workspace-dialog-field"><label htmlFor="manage-tag-remote">推送到远程</label><select id="manage-tag-remote" value={remote} disabled={busy} onChange={(event) => setRemote(event.target.value)}>{state?.remotes.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></div>
        {multiplePushUrls && <p>当前远程配置了多个 Push 地址，请先整理为单一推送地址再推送标签。</p>}
        {state?.tags.length === 0 && <p>尚无本地标签。</p>}
        <ul>{state?.tags.map((item) => <li key={item.name}><strong>{item.name}</strong> <span>{item.hash.slice(0, 8)} {item.subject}</span>
          <Button disabled={locked || !remote || multiplePushUrls} onClick={() => void prepare({ type: "tag-push", name: item.name, remote })}>推送标签</Button>
          <Button disabled={locked} onClick={() => void prepare({ type: "tag-delete", name: item.name })}>删除本地标签</Button>
        </li>)}</ul>
      </section>
    </>}
  </Dialog>;
}

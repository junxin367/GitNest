import { useEffect, useRef, useState } from "react";
import type { RepositoryCreationStateDto, RepositoryManagementBridge } from "@gitnest/contracts";
import { Button } from "../../shared/ui/Button";
import { Dialog } from "../../shared/ui/Dialog";
import { Input } from "../../shared/ui/Input";

export interface RepositoryCreationDialogProps {
  bridge: RepositoryManagementBridge;
  initialKind?: "clone" | "init";
  onDismiss(): void;
  onCreated(path: string): Promise<void>;
  pickDirectory?(): Promise<string | null>;
}
export function RepositoryCreationDialog({ bridge, initialKind = "clone", onDismiss, onCreated, pickDirectory }: RepositoryCreationDialogProps) {
  const [kind, setKind] = useState(initialKind);
  const [url, setUrl] = useState("");
  const [destination, setDestination] = useState("");
  const [branch, setBranch] = useState("main");
  const [job, setJob] = useState<RepositoryCreationStateDto | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const running = submitting || job?.state === "running";
  useEffect(() => {
    if (!job || job.state !== "running") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const result = await bridge.creationStatus({ operationId: job.operationId });
        if (cancelled) return;
        if (result.ok) { setJob(result.value); if (result.value.state === "running") timer = setTimeout(() => void poll(), 500); }
        else { setError(result.error.message); timer = setTimeout(() => void poll(), 1500); }
      } catch (failure) { if (!cancelled) { setError(String(failure)); timer = setTimeout(() => void poll(), 1500); } }
    };
    timer = setTimeout(() => void poll(), 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [bridge, job?.operationId, job?.state]);
  async function submit() {
    setSubmitting(true); setError(""); setJob(null);
    try {
      const result = await bridge.create({ kind, destination: destination.trim(), ...(kind === "clone" ? { url: url.trim() } : { initialBranch: branch.trim() }) });
      if (!mounted.current) return;
      if (result.ok) setJob(result.value); else setError(result.error.message);
    } catch (failure) { if (mounted.current) setError(String(failure)); } finally { if (mounted.current) setSubmitting(false); }
  }
  async function addCreated() {
    if (!job || job.state !== "succeeded") return;
    setSubmitting(true); setError("");
    try { await onCreated(job.destination); onDismiss(); } catch (failure) { setError(String(failure)); } finally { setSubmitting(false); }
  }
  return <Dialog icon="folder" title="创建或克隆仓库" size="target" dismissDisabled={running} onDismiss={onDismiss}
    footer={<>
      {job?.state === "running" ? <Button onClick={() => void bridge.cancelCreation({ operationId: job.operationId }).then((result) => { if (!result.ok) setError(result.error.message); }, (failure: unknown) => setError(String(failure)))}>取消操作</Button> : <Button disabled={submitting} onClick={onDismiss}>关闭</Button>}
      {job?.state === "succeeded" ? <Button variant="primary" disabled={submitting} onClick={() => void addCreated()}>加入 Workspace</Button> : <Button variant="primary" disabled={running || !destination.trim() || (kind === "clone" && !url.trim())} onClick={() => void submit()}>{running ? "处理中…" : kind === "clone" ? "开始克隆" : "初始化仓库"}</Button>}
    </>}>
    <div className="workspace-dialog-field"><label htmlFor="create-repository-kind">创建方式</label><select id="create-repository-kind" disabled={running || job?.state === "succeeded"} value={kind} onChange={(event) => setKind(event.target.value as "clone" | "init")}><option value="clone">克隆已有仓库</option><option value="init">初始化本地仓库</option></select></div>
    {kind === "clone" ? <><div className="workspace-dialog-field"><label htmlFor="create-repository-url">仓库 URL</label><Input id="create-repository-url" fullWidth disabled={running} value={url} onChange={(event) => setUrl(event.target.value)} /></div><p>认证使用系统 Git 凭据助手或 SSH 配置。请勿将令牌放入 URL。</p></> : <div className="workspace-dialog-field"><label htmlFor="create-repository-branch">初始分支</label><Input id="create-repository-branch" disabled={running} value={branch} onChange={(event) => setBranch(event.target.value)} /></div>}
    <div className="workspace-dialog-field"><label htmlFor="create-repository-destination">完整目标目录（不存在或为空）</label><Input id="create-repository-destination" fullWidth disabled={running} value={destination} onChange={(event) => setDestination(event.target.value)} />{pickDirectory && <Button disabled={running} onClick={() => void pickDirectory().then((path) => { if (path && mounted.current) setDestination(path); }, (failure: unknown) => setError(String(failure)))}>选择空目录</Button>}</div>
    <p>取消或失败后保留产生的目录；请检查后使用新的空目录重试。</p>
    {job && <p role="status" aria-live="polite">{job.message}</p>}
    {job && job.state !== "running" && <p>{job.destination}</p>}
    {error && <p role="alert">{error}</p>}
  </Dialog>;
}

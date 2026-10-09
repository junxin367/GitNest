import { useEffect, useRef, useState } from "react";
import type {
  RepositoryIgnorePreflightDto,
  RepositoryIgnoreScopeDto,
  RepositoryTargetDto,
  WorkspaceOperationDto
} from "@gitnest/contracts";
import { Button } from "../../shared/ui/Button";
import { Dialog } from "../../shared/ui/Dialog";

export interface RepositoryIgnoreSelection {
  path: string;
  scope: RepositoryIgnoreScopeDto;
}

/** Mount with a scope key so a repository switch cancels the visible draft. */
export function RepositoryIgnoreDialog({
  target, selection, operations, onDismiss, onCompleted
}: {
  target: RepositoryTargetDto;
  selection: RepositoryIgnoreSelection;
  operations: WorkspaceOperationDto[];
  onDismiss(): void;
  onCompleted(): void;
}) {
  const [preview, setPreview] = useState<RepositoryIgnorePreflightDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [operationId, setOperationId] = useState<string | null>(null);
  const flight = useRef(false);
  const mounted = useRef(true);
  const completed = useRef(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    setLoading(true);
    setPreview(null);
    setError(null);
    void window.gitnest.repositoryIgnore.preflight({ target, ...selection }).then(result => {
      if (cancelled) return;
      if (result.ok) setPreview(result.value);
      else setError(result.error.message);
    }).catch(reason => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "忽略规则预览失败。");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; mounted.current = false; };
  }, [target.repositoryId, target.worktreeId, selection.path, selection.scope, retry]);

  useEffect(() => {
    const operation = operations.find(item => item.id === operationId);
    if (!operation || completed.current ||
      ["queued", "running", "cancelling"].includes(operation.state)) return;
    completed.current = true;
    setOperationId(null);
    if (operation.state === "succeeded") {
      onCompleted();
      onDismiss();
    } else {
      setError(operation.message || "忽略规则写入失败，请重新预览。");
      setPreview(null);
    }
  }, [operations, operationId, onCompleted, onDismiss]);

  const confirm = async () => {
    if (!preview || flight.current || operationId) return;
    flight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const result = await window.gitnest.repositoryIgnore.execute({
        preflightId: preview.preflightId, confirmed: true
      });
      if (!mounted.current) return;
      setPreview(null);
      if (result.ok) {
        completed.current = false;
        setOperationId(result.value.operationId);
      } else setError(result.error.message);
    } catch (reason) {
      if (mounted.current) {
        setPreview(null);
        setError(reason instanceof Error ? reason.message : "忽略规则写入失败。");
      }
    } finally {
      flight.current = false;
      if (mounted.current) setSubmitting(false);
    }
  };
  const busy = submitting || operationId !== null;
  return (
    <Dialog title="预览忽略规则" icon="files" size="target" onDismiss={onDismiss}
      dismissDisabled={busy}
      footer={<>
        <Button data-modal-initial-focus="true" disabled={busy} onClick={onDismiss}>取消</Button>
        {!preview && !loading && !busy
          ? <Button onClick={() => setRetry(value => value + 1)}>重新预览</Button>
          : <Button variant="primary" disabled={!preview || loading || busy} onClick={() => void confirm()}>
              {busy ? "正在写入…" : "写入 .gitignore"}
            </Button>}
      </>}>
      <p style={{ overflowWrap: "anywhere" }}>{selection.path}</p>
      {loading && <p role="status">正在检查文件并生成规则…</p>}
      {preview && <>
        <p>{preview.summary}</p>
        <p>追加到 <code>{preview.ignoreFilePath}</code>：</p>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{preview.rule}</pre>
        {preview.warnings.length > 0 && <ul>
          {preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
        </ul>}
      </>}
      {operationId && <p role="status">操作已加入队列，完成后自动刷新文件列表。</p>}
      {error && <p role="alert">{error}</p>}
    </Dialog>
  );
}

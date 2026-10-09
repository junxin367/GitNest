import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  RepositoryTargetDto,
  RepositoryWorkflowActionDto,
  RepositoryWorkflowPreflightDto,
  RepositoryWorkflowStateDto,
  WorkspaceOperationDto
} from "@gitnest/contracts";

export interface RepositoryWorkflowController {
  state: RepositoryWorkflowStateDto | null;
  preflight: RepositoryWorkflowPreflightDto | null;
  busy: boolean;
  inspecting: boolean;
  error: string | null;
  notice: string | null;
  completionVersion: number;
  draft: { type: "create-stash" | "amend" | "undo-commit"; path?: string; paths?: string[] } | null;
  openDraft(type: "create-stash" | "amend" | "undo-commit", path?: string, originalPath?: string): void;
  closeDraft(): void;
  reload(): Promise<RepositoryWorkflowStateDto | null>;
  request(action: RepositoryWorkflowActionDto): Promise<boolean>;
  confirm(): Promise<boolean>;
  dismiss(): void;
  clearFeedback(): void;
}

const activeState = (state: WorkspaceOperationDto["state"]) =>
  state === "queued" || state === "running" || state === "cancelling";

export function useRepositoryWorkflow(
  target: RepositoryTargetDto | undefined,
  operations: WorkspaceOperationDto[],
  workspaceId?: string,
  autoInspect = true,
  contentRevision?: string
): RepositoryWorkflowController {
  const scope = useMemo(() => ({
    target: target ? { repositoryId: target.repositoryId, worktreeId: target.worktreeId } : undefined,
    workspaceId
  }), [target?.repositoryId, target?.worktreeId, workspaceId]);
  const current = useRef<typeof scope | null>(scope);
  current.current = scope;
  const [state, setState] = useState<RepositoryWorkflowStateDto | null>(null);
  const [preflight, setPreflight] = useState<RepositoryWorkflowPreflightDto | null>(null);
  const preflightRef = useRef<RepositoryWorkflowPreflightDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const [completionVersion, setCompletionVersion] = useState(0);
  const [draft, setDraft] = useState<RepositoryWorkflowController["draft"]>(null);
  const flight = useRef(false);
  const inspection = useMemo(() => ({
    revision: 0,
    requestedRevision: 0,
    explicitRead: false,
    promise: null as Promise<RepositoryWorkflowStateDto | null> | null
  }), [scope]);
  const operationsRef = useRef(operations);
  operationsRef.current = operations;
  const terminalStates = useMemo(() => new Map(operations.filter(item =>
    !activeState(item.state) && item.kind !== "status" && item.kind !== "scan" &&
    item.targetIds.includes(`${scope.target?.repositoryId}:${scope.target?.worktreeId}`)
  ).map(item => [item.id, item.state])), [operations, scope]);
  const previousTerminalStates = useRef(terminalStates);

  const reload = useCallback((explicit = true): Promise<RepositoryWorkflowStateDto | null> => {
    if (!scope.target || current.current !== scope) return Promise.resolve(null);
    inspection.explicitRead ||= explicit;
    inspection.requestedRevision = inspection.revision;
    setInspecting(true);
    if (inspection.promise) return inspection.promise;
    const target = scope.target;
    // Repeated reads share one IPC request. A mutation invalidates its snapshot
    // and asks this same flight to read again after the old request settles.
    inspection.promise = Promise.resolve().then(async () => {
      try {
        while (current.current === scope) {
          const revision = inspection.revision;
          try {
            const result = await window.gitnest.repositoryWorkflow.inspect({ target });
            if (current.current !== scope) return null;
            if (revision === inspection.revision) {
              if (!result.ok) {
                setError(result.error.message);
                return null;
              }
              setState(result.value);
              return result.value;
            }
          } catch (reason) {
            if (current.current !== scope) return null;
            if (revision === inspection.revision) {
              setError(reason instanceof Error ? reason.message : "读取 Git 操作状态失败。");
              return null;
            }
          }
          // A successful strict preflight supersedes this read without asking
          // for another one; an actual refresh requests the new revision.
          if (inspection.requestedRevision !== inspection.revision) return null;
        }
        return null;
      } finally {
        inspection.promise = null;
        inspection.explicitRead = false;
        if (current.current === scope) setInspecting(false);
      }
    });
    return inspection.promise;
  }, [scope, inspection]);

  const refresh = useCallback((explicit = true) => {
    inspection.revision++;
    return reload(explicit);
  }, [inspection, reload]);

  useEffect(() => {
    current.current = scope;
    flight.current = false;
    pendingRef.current = null;
    preflightRef.current = null;
    previousTerminalStates.current = terminalStates;
    setState(null);
    setPreflight(null);
    setError(null);
    setNotice(null);
    setActive(false);
    setInspecting(false);
    setPendingId(null);
    setDraft(null);
    return () => {
      if (current.current === scope) current.current = null;
      inspection.revision++;
    };
  }, [scope, inspection]);

  useEffect(() => {
    if (autoInspect) {
      void refresh(false);
    } else if (inspection.explicitRead && inspection.promise) {
      // A draft may be open outside the changes view. Its caller still needs
      // a fresh result, so refresh its shared promise when the snapshot changes.
      void refresh();
    } else {
      // Hidden views need no automatic follow-up. Explicit draft reads and
      // preflight recovery still use reload/refresh while the view is hidden.
      inspection.revision++;
      setInspecting(false);
    }
  }, [autoInspect, contentRevision, inspection, refresh]);

  useEffect(() => {
    const previous = previousTerminalStates.current;
    previousTerminalStates.current = terminalStates;
    if (autoInspect && [...terminalStates].some(([id, value]) => previous.get(id) !== value)) void refresh(false);
  }, [autoInspect, terminalStates, refresh]);

  useEffect(() => {
    if (!pendingId || pendingRef.current !== pendingId) return;
    const operation = operations.find(item => item.id === pendingId);
    if (!operation || activeState(operation.state)) return;
    pendingRef.current = null;
    setPendingId(null);
    setCompletionVersion(value => value + 1);
    if (operation.state === "succeeded") {
      setNotice(operation.message || "Git 操作已完成。");
      setError(null);
    } else {
      setError(operation.message || "Git 操作未完成，请检查仓库状态。");
      setNotice(null);
    }
  }, [operations, pendingId]);

  const hasActiveOperation = useCallback(() => {
    const key = `${scope.target?.repositoryId}:${scope.target?.worktreeId}`;
    return operationsRef.current.some(item => activeState(item.state) &&
      item.kind !== "status" && item.kind !== "scan" && item.targetIds.includes(key));
  }, [scope]);
  const request = useCallback(async (action: RepositoryWorkflowActionDto) => {
    if (!scope.target || current.current !== scope || flight.current || pendingRef.current ||
      preflightRef.current || hasActiveOperation()) return false;
    flight.current = true;
    setActive(true);
    setError(null);
    setNotice(null);
    try {
      const result = await window.gitnest.repositoryWorkflow.preflight({
        command: { ...action, target: scope.target }
      });
      if (current.current !== scope) return false;
      if (!result.ok) {
        setError(result.error.message);
        void refresh();
        return false;
      }
      inspection.revision++;
      inspection.explicitRead = false;
      setInspecting(false);
      setState(result.value.state);
      preflightRef.current = result.value;
      setPreflight(result.value);
      return true;
    } catch (reason) {
      if (current.current === scope) setError(reason instanceof Error ? reason.message : "操作预检失败。");
      return false;
    } finally {
      if (current.current === scope) {
        flight.current = false;
        setActive(false);
      }
    }
  }, [scope, hasActiveOperation, inspection, refresh]);

  const confirm = useCallback(async () => {
    const candidate = preflightRef.current;
    if (!candidate || current.current !== scope || flight.current || pendingRef.current) return false;
    flight.current = true;
    setActive(true);
    setError(null);
    try {
      const result = await window.gitnest.repositoryWorkflow.execute({
        command: candidate.command, preflightId: candidate.preflightId, confirmed: true
      });
      if (current.current !== scope) return false;
      preflightRef.current = null;
      setPreflight(null);
      if (!result.ok) {
        setError(result.error.message);
        void refresh();
        return false;
      }
      pendingRef.current = result.value.operationId;
      setPendingId(result.value.operationId);
      setNotice("操作已加入队列，完成后自动刷新。");
      return true;
    } catch (reason) {
      if (current.current === scope) {
        preflightRef.current = null;
        setPreflight(null);
        setError(reason instanceof Error ? reason.message : "提交操作失败。");
      }
      return false;
    } finally {
      if (current.current === scope) {
        flight.current = false;
        setActive(false);
      }
    }
  }, [scope, refresh]);

  return {
    state, preflight, inspecting, error, notice, completionVersion, draft,
    busy: active || pendingId !== null || hasActiveOperation(),
    reload, request, confirm,
    openDraft: (type, path, originalPath) => {
      if (flight.current || pendingRef.current || preflightRef.current) return;
      setError(null);
      setDraft(path ? { type, path, paths: [...new Set([originalPath, path].filter((item): item is string => Boolean(item)))] } : { type });
    },
    closeDraft: () => { if (!flight.current) setDraft(null); },
    dismiss: () => {
      if (flight.current) return;
      preflightRef.current = null;
      setPreflight(null);
    },
    clearFeedback: () => { setError(null); setNotice(null); }
  };
}

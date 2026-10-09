import { Activity, useEffect, useMemo, useState, type ReactNode } from "react";
import type { WorkspaceDetailsDto } from "@gitnest/contracts";
import { listWorkspaceTargets } from "../entities/workspace/model";

/** Retain one visited analysis page; hidden effects stop until it is shown again. */
export function AnalysisPageHost({
  active,
  workspace,
  children
}: {
  active: boolean;
  workspace: WorkspaceDetailsDto | null;
  children: ReactNode;
}) {
  const [visited, setVisited] = useState(false);
  useEffect(() => {
    if (active) setVisited(true);
  }, [active]);
  const contextKey = useMemo(() => {
    const targets = new Set(listWorkspaceTargets(workspace).map(
      target => JSON.stringify([target.repositoryId, target.worktreeId])
    ));
    return JSON.stringify([
      workspace?.id,
      workspace?.canonicalPath ?? workspace?.path,
      workspace?.worktrees
        .filter(tree => !tree.isBare && targets.has(JSON.stringify([tree.repositoryId, tree.id])))
        .map(tree => JSON.stringify([tree.repositoryId, tree.id, tree.canonicalPath ?? tree.path]))
        .sort()
    ]);
  }, [workspace?.id, workspace?.canonicalPath, workspace?.path, workspace?.groups, workspace?.worktrees]);

  if (!active && !visited) return null;
  return <Activity key={contextKey} mode={active ? "visible" : "hidden"}>
    {children}
  </Activity>;
}

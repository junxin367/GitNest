import type { RepositoryStatusSnapshotDto } from "@gitnest/contracts";

import { getSnapshotChangeCount } from "../../entities/workspace/model";

export function repositoryOverviewStatus(
  snapshot: RepositoryStatusSnapshotDto | undefined
): string {
  if (!snapshot) {
    return "等待状态";
  }
  if (snapshot.error) {
    return "读取失败";
  }
  if (snapshot.refreshPending) {
    return "刷新中";
  }
  if (snapshot.conflicted) {
    return `${snapshot.conflicted} 个冲突需要解决`;
  }
  const changes = getSnapshotChangeCount(snapshot);
  return changes > 0
    ? `${changes} 项未提交变更`
    : "工作区干净";
}

export function snapshotTone(
  snapshot: RepositoryStatusSnapshotDto | undefined
): "neutral" | "blue" | "green" | "yellow" | "red" {
  if (snapshot?.error) {
    return "red";
  }
  if (snapshot?.conflicted) {
    return "red";
  }
  if (!snapshot || snapshot.stale || snapshot.refreshPending) {
    return "blue";
  }
  if (getSnapshotChangeCount(snapshot) > 0) {
    return "yellow";
  }
  return "green";
}

export function snapshotStatus(
  snapshot: RepositoryStatusSnapshotDto | undefined
): string {
  if (!snapshot) {
    return "等待状态";
  }
  if (snapshot.refreshPending) {
    return "刷新中";
  }
  if (snapshot.error) {
    return "读取失败";
  }
  if (snapshot.stale) {
    return "缓存状态";
  }
  const changes = getSnapshotChangeCount(snapshot);
  return changes > 0 ? `${changes} 项变更` : "工作区干净";
}

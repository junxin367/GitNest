import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { createServer } from "node:net";
import {
  basename,
  dirname,
  join,
  resolve
} from "node:path";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { fileURLToPath } from "node:url";

import { CdpClient } from "./electron-cdp-client.mjs";
import { findElectronDistribution } from "./windows-release-support.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const desktopRoot = join(projectRoot, "apps", "desktop");
const workflowOnly = process.argv.includes("--workflow-only");
const temporaryDirectory = join(projectRoot, "temp");
await mkdir(temporaryDirectory, { recursive: true });
let electronExecutable;
const fixtureRoot = await mkdtemp(
  join(temporaryDirectory, "gitnest-e2e-m3-recovery-")
);
const workspacePath = join(fixtureRoot, "workspace");
const repositoryPath = join(
  workspacePath,
  "recovery repository 测试"
);
const userDataPath = join(fixtureRoot, "user-data");
const corruptUserDataPath = join(
  fixtureRoot,
  "corrupt-user-data"
);
const screenshotDirectory = join(projectRoot, "test-results");
const baselinePath = join(screenshotDirectory, "electron-workflow-baseline.json");
const baseline = {
  schemaVersion: 1,
  workflow: "startup-switch-watcher-search-diff-restart",
  startedAt: new Date().toISOString(),
  environment: {
    platform: platform(),
    arch: arch(),
    release: release(),
    node: process.version,
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    totalMemoryBytes: totalmem()
  },
  measurements: [],
  ok: false
};
let activeWorkspaceId = "default";
let firstLaunch;
let secondLaunch;
let corruptLaunch;

try {
  await mkdir(screenshotDirectory, { recursive: true });
  if (workflowOnly) {
    await rm(join(screenshotDirectory, "electron-workflow-diff.png"), { force: true });
  }
  const electronDistribution = await findElectronDistribution({
    projectRoot,
    desktopDirectory: desktopRoot
  });
  electronExecutable = join(electronDistribution, "electron.exe");
  baseline.environment.electron = (await readFile(
    join(electronDistribution, "version"), "utf8"
  )).trim();
  await createFixture();

  if (workflowOnly) {
    await runWorkflow();
  } else {
    await runRecovery();
  }
} catch (error) {
  if (workflowOnly) {
    baseline.error = error instanceof Error ? error.stack : String(error);
  }
  throw error;
} finally {
  for (const launch of [
    firstLaunch,
    secondLaunch,
    corruptLaunch
  ]) {
    if (launch) {
      await closeElectron(launch).catch(() => undefined);
    }
  }
  if (process.env.GITNEST_KEEP_E2E !== "1") {
    await removeFixtureRoot(fixtureRoot).catch((error) => {
      console.warn(
        `Unable to remove temporary fixture ${fixtureRoot}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });
  } else {
    console.log(`Temporary fixture retained at ${fixtureRoot}`);
  }
  if (workflowOnly) {
    baseline.finishedAt = new Date().toISOString();
    await mkdir(screenshotDirectory, { recursive: true });
    await writeFile(baselinePath, JSON.stringify(baseline, null, 2) + "\n", "utf8");
    console.log(JSON.stringify(baseline, null, 2));
  }
}

async function runRecovery() {
  firstLaunch = await launchElectron(userDataPath);
  await addWorkspacePath(firstLaunch.cdp, workspacePath);
  const firstState = await getWorkspaceState(firstLaunch.cdp);
  const target = firstState.workspace.selectedTarget;
  assert(target, "Initial Workspace target is missing.");
  await closeElectron(firstLaunch);
  firstLaunch = undefined;

  await prepareLegacyRecoveryState(firstState, target);

  secondLaunch = await launchElectron(userDataPath);
  const nativeWindow = await readNativeWindowBounds(
    secondLaunch.cdp
  );
  const availableScreen = await secondLaunch.cdp.evaluate(`({
    x: window.screen.availLeft,
    y: window.screen.availTop,
    width: window.screen.availWidth,
    height: window.screen.availHeight
  })`);
  assert(
    intersectionArea(nativeWindow, availableScreen) > 0,
    `Restored native window is off-screen: ${JSON.stringify(
      nativeWindow
    )}`
  );

  const recoveredState = await getWorkspaceState(
    secondLaunch.cdp
  );
  const interrupted = recoveredState.operations.find(
    (operation) =>
      operation.id ===
      "operation_41_20260904110000000"
  );
  assert(
    interrupted?.state === "interrupted",
    `Persisted running operation was not recovered as interrupted: ${JSON.stringify(recoveredState.operations)}`
  );
  assertIncludes(
    interrupted.message,
    "未假定操作成功、失败或已回滚"
  );

  await setWindowSize(secondLaunch.cdp, 1440, 900);
  await clickSelector(
    secondLaunch.cdp,
    'button[aria-label="操作中心"]'
  );
  await secondLaunch.cdp.waitFor(
    "interrupted operation in Operation Center",
    `String(document.querySelector(".operation-center-page")?.textContent)
      .includes("已中断")`
  );
  await capture(
    secondLaunch.cdp,
    join(
      screenshotDirectory,
      "gn-m3-02-1440-interrupted-operation.png"
    )
  );

  await clickSelector(
    secondLaunch.cdp,
    'button[aria-label="设置"]'
  );
  await secondLaunch.cdp.waitFor(
    "settings page",
    `Boolean(document.querySelector(".application-settings-page"))`
  );
  await clickSelector(secondLaunch.cdp, 'button[aria-controls="settings-subnav-account"]');
  await secondLaunch.cdp.waitFor(
    "system Git authentication settings",
    `document.body.textContent.includes("系统 Git 认证")`
  );

  const migratedWorkspace = JSON.parse(
    await readFile(workspaceFilePath(), "utf8")
  );
  assertEqual(
    migratedWorkspace.schemaVersion,
    2,
    "Workspace schema was not migrated."
  );
  assert(
    migratedWorkspace.unknownLegacyField === undefined,
    "Workspace migration retained an unknown field."
  );
  const migratedSnapshot = JSON.parse(
    await readFile(snapshotFilePath(), "utf8")
  );
  assertEqual(
    migratedSnapshot.schemaVersion,
    1,
    "Snapshot schema was not migrated."
  );
  assert(
    migratedSnapshot.unknownLegacyField === undefined,
    "Snapshot migration retained an unknown field."
  );
  await waitForNoPendingJsonWrites(
    dirname(operationFilePath())
  );
  const recoveredOperations = JSON.parse(
    await readFile(operationFilePath(), "utf8")
  );
  assertEqual(
    recoveredOperations.schemaVersion,
    1,
    "Operation schema was not migrated."
  );
  assert(
    recoveredOperations.operations.some(
      (operation) =>
        operation.id ===
          "operation_41_20260904110000000" &&
        operation.state === "interrupted"
    ),
    "Interrupted operation terminal state was not persisted."
  );

  await closeElectron(secondLaunch);
  secondLaunch = undefined;

  const savedWindowState = JSON.parse(
    await readFile(windowStateFilePath(), "utf8")
  );
  assertEqual(
    savedWindowState.schemaVersion,
    1,
    "Window state schema was not migrated."
  );
  assert(
    intersectionArea(
      savedWindowState.bounds,
      availableScreen
    ) > 0,
    "Saved window state is outside the active display work area."
  );
  const logDirectory = join(userDataPath, "logs");
  const logText = (
    await Promise.all(
      (await readdir(logDirectory))
        .filter((name) => name.startsWith("gitnest.log"))
        .map((name) =>
          readFile(join(logDirectory, name), "utf8")
        )
    )
  ).join("\n");
  assertIncludes(logText, "application.ready");
  assertIncludes(logText, "workspace.operation-state");

  await prepareCorruptWorkspace();
  corruptLaunch = await launchElectron(corruptUserDataPath);
  const corruptResult = await corruptLaunch.cdp.evaluate(`(async () =>
    window.gitnest.workspace.getState()
  )()`);
  assert(
    corruptResult?.ok === false &&
      corruptResult.error?.code ===
        "INVALID_PERSISTED_DATA",
    "Malformed Workspace was not reported as invalid persisted data."
  );
  const addResult = await corruptLaunch.cdp.evaluate(`(async () =>
    window.gitnest.workspace.addDirectory({
      path: ${JSON.stringify(repositoryPath)}
    })
  )()`);
  assert(
    addResult?.ok === false,
    "Malformed Workspace unexpectedly accepted a write."
  );
  assertEqual(
    await readFile(corruptWorkspaceFilePath(), "utf8"),
    "{ malformed workspace",
    "Malformed Workspace was silently overwritten."
  );
  await closeElectron(corruptLaunch);
  corruptLaunch = undefined;

  console.log(
    JSON.stringify(
      {
        ok: true,
        fixtureRoot,
        screenshot:
          "gn-m3-02-1440-interrupted-operation.png",
        recoveredOperation: interrupted.state,
        schemas: {
          workspace: migratedWorkspace.schemaVersion,
          snapshots: migratedSnapshot.schemaVersion,
          operations: recoveredOperations.schemaVersion,
          window: savedWindowState.schemaVersion
        },
        diagnosticsRecorded: true,
        corruptWorkspacePreserved: true
      },
      null,
      2
    )
  );
}

async function createFixture() {
  await createRepository(repositoryPath);
}

async function createRepository(path) {
  await mkdir(path, { recursive: true });
  await runGit(path, [
    "init",
    "--initial-branch=main"
  ]);
  await runGit(path, [
    "config",
    "user.name",
    "GitNest Recovery Smoke"
  ]);
  await runGit(path, [
    "config",
    "user.email",
    "recovery@example.invalid"
  ]);
  await writeFile(
    join(path, "README.md"),
    "# GitNest GN-M3-02 recovery smoke\n",
    "utf8"
  );
  await runGit(path, ["add", "README.md"]);
  await runGit(path, [
    "commit",
    "-m",
    "Initial recovery fixture"
  ]);
}

async function runWorkflow() {
  const secondaryPath = join(workspacePath, "secondary repository");
  await createRepository(secondaryPath);
  baseline.environment.gitRevision = await runGit(projectRoot, ["rev-parse", "HEAD"]);
  baseline.environment.buildModifiedAt = (
    await stat(join(desktopRoot, "out", "main", "index.js"))
  ).mtime.toISOString();
  baseline.fixture = { repositories: 2, filesPerRepository: 1 };
  firstLaunch = await measure("startup", () => launchElectron(userDataPath));
  await measure("scan", () => addWorkspacePath(firstLaunch.cdp, workspacePath));
  const state = await getWorkspaceState(firstLaunch.cdp);
  assertEqual(state.workspace.repositories.length, 2, "Fixture discovery must find both repositories.");
  const primary = state.workspace.worktrees.find((item) => item.path === repositoryPath);
  const secondary = state.workspace.worktrees.find((item) => item.path === secondaryPath);
  assert(primary && secondary, "Fixture worktrees are missing.");
  await measure("open-primary", () => openRepositoryThroughSearch(firstLaunch.cdp, primary));
  await measure("switch-secondary", () => openRepositoryThroughSearch(firstLaunch.cdp, secondary));
  await measure("switch-primary", () => openRepositoryThroughSearch(firstLaunch.cdp, primary));
  const changedFile = "workflow-watcher.txt";
  const marker = "gitnest-workflow-watcher-marker";
  await firstLaunch.cdp.waitFor("active filesystem watcher", `(async () => {
    const result = await window.gitnest.workspace.getState();
    return result.ok && result.value.monitor.mode === "watching" &&
      result.value.snapshots.every((snapshot) => !snapshot.refreshPending && !snapshot.stale);
  })()`, 30_000);
  const beforeChange = await getWorkspaceState(firstLaunch.cdp);
  const secondarySnapshot = beforeChange.snapshots.find((item) => item.worktreeId === secondary.id);
  assert(secondarySnapshot, "Secondary snapshot is missing.");
  await measure("watcher-update", async () => {
    await writeFile(join(repositoryPath, changedFile), `${marker}\n`, "utf8");
    // No explicit refresh: the filesystem watcher must publish the new snapshot.
    await firstLaunch.cdp.waitFor("watcher snapshot", `(async () => {
      const result = await window.gitnest.workspace.getState();
      return result.ok && result.value.snapshots.some((snapshot) =>
        snapshot.worktreeId === ${JSON.stringify(primary.id)} &&
        snapshot.untracked === 1 && !snapshot.refreshPending && !snapshot.stale
      );
    })()`, 30_000);
    const afterChange = await getWorkspaceState(firstLaunch.cdp);
    assertEqual(afterChange.monitor.mode, "watching", "Watcher fell back to polling.");
    assertEqual(
      JSON.stringify(afterChange.snapshots.find((item) => item.worktreeId === secondary.id)),
      JSON.stringify(secondarySnapshot),
      "A file change in the primary repository refreshed the unrelated repository."
    );
  });
  await measure("search-change", async () => {
    await openGlobalSearch(firstLaunch.cdp, changedFile);
    await firstLaunch.cdp.waitFor("changed file search result",
      `[...document.querySelectorAll(".global-search-result strong")].some(
        (item) => item.textContent === ${JSON.stringify(changedFile)}
      )`);
  });
  await measure("open-diff", async () => {
    await clickSearchResult(firstLaunch.cdp, changedFile);
    await firstLaunch.cdp.waitFor("changed file Diff",
      `document.querySelector(".diff-viewer-code")?.textContent.includes(${JSON.stringify(marker)})`);
  });
  await measure("search-diff", async () => {
    await firstLaunch.cdp.evaluate(`window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true })
    )`);
    await firstLaunch.cdp.waitFor("Diff search input",
      `Boolean(document.querySelector('input[aria-label="搜索文本"]'))`);
    await setInputValue(firstLaunch.cdp, 'input[aria-label="搜索文本"]', marker);
    await firstLaunch.cdp.waitFor("Diff search hit",
      `Boolean(document.querySelector('[data-diff-viewer-search-hit="0"]'))`);
  });
  await capture(firstLaunch.cdp, join(screenshotDirectory, "electron-workflow-diff.png"));
  await closeElectron(firstLaunch);
  firstLaunch = undefined;
  await measure("restart-recovery", async () => {
    secondLaunch = await launchElectron(userDataPath);
    await secondLaunch.cdp.waitFor("restored selected target", `(async () => {
      const result = await window.gitnest.workspace.getState();
      return result.ok && result.value.workspace.repositories.length === 2 &&
        result.value.workspace.selectedTarget?.worktreeId === ${JSON.stringify(primary.id)} &&
        Boolean(document.querySelector(".repository-page")) &&
        result.value.snapshots.some((snapshot) =>
          snapshot.worktreeId === ${JSON.stringify(primary.id)} && snapshot.untracked === 1
        );
    })()`, 30_000);
    // Reopen the persisted change to verify that the restored target still serves Diff data.
    await openGlobalSearch(secondLaunch.cdp, changedFile);
    await secondLaunch.cdp.waitFor("restored file search result",
      `[...document.querySelectorAll(".global-search-result strong")].some(
        (item) => item.textContent === ${JSON.stringify(changedFile)}
      )`);
    await clickSearchResult(secondLaunch.cdp, changedFile);
    await secondLaunch.cdp.waitFor("restored Diff content",
      `document.querySelector(".diff-viewer-code")?.textContent.includes(${JSON.stringify(marker)})`);
  });
  await closeElectron(secondLaunch);
  secondLaunch = undefined;
  baseline.ok = true;
}

async function measure(name, action) {
  const started = performance.now();
  const measurement = { name, durationMs: 0, ok: false };
  baseline.measurements.push(measurement);
  try {
    const value = await action();
    measurement.ok = true;
    return value;
  } finally {
    measurement.durationMs = Math.round((performance.now() - started) * 100) / 100;
  }
}

async function openGlobalSearch(client, query) {
  await clickSelector(client, 'button[aria-label="全局搜索"]');
  await client.waitFor("global search input",
    'Boolean(document.querySelector("#global-search-input"))');
  await setInputValue(client, "#global-search-input", query);
}

async function clickSearchResult(client, title) {
  const clicked = await client.evaluate(`(() => {
    const title = [...document.querySelectorAll(".global-search-result strong")]
      .find((item) => item.textContent === ${JSON.stringify(title)});
    const button = title?.closest("button");
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  assert(clicked, `Unable to open search result ${title}.`);
}

async function openRepositoryThroughSearch(client, worktree) {
  await openGlobalSearch(client, worktree.name);
  await client.waitFor("repository search result",
    `[...document.querySelectorAll(".global-search-result strong")].some(
      (item) => item.textContent === ${JSON.stringify(worktree.name)}
    )`);
  await clickSearchResult(client, worktree.name);
  await client.waitFor("selected repository", `(async () => {
    const result = await window.gitnest.workspace.getState();
    return result.ok &&
      result.value.workspace.selectedTarget?.worktreeId === ${JSON.stringify(worktree.id)} &&
      Boolean(document.querySelector(".repository-page")) &&
      !document.querySelector(".global-search-dialog");
  })()`);
}

async function prepareLegacyRecoveryState(
  firstState,
  target
) {
  const workspace = JSON.parse(
    await readFile(workspaceFilePath(), "utf8")
  );
  workspace.entries = [{
    id: "recovery-entry",
    displayName: workspace.name,
    path: workspace.path ?? workspacePath,
    canonicalPath: workspace.canonicalPath ?? workspacePath.toLowerCase(),
    excludes: workspace.excludes,
    order: 0,
    groups: workspace.groups,
    lastScannedAt: workspace.lastScannedAt,
    kind: "workspace-directory"
  }];
  workspace.selectedEntryId = "recovery-entry";
  workspace.schemaVersion = 0;
  workspace.unknownLegacyField = true;
  for (const entry of workspace.entries) {
    delete entry.scanIssues;
    for (const group of entry.groups) {
      delete group.collapsed;
    }
  }
  for (const worktree of workspace.worktrees) {
    delete worktree.isDetached;
    delete worktree.isLocked;
    delete worktree.isPrunable;
  }
  await writeFile(
    workspaceFilePath(),
    JSON.stringify(workspace, null, 2),
    "utf8"
  );

  const snapshot = JSON.parse(
    await readFile(snapshotFilePath(), "utf8")
  );
  snapshot.schemaVersion = 0;
  snapshot.unknownLegacyField = true;
  for (const item of snapshot.snapshots) {
    delete item.refreshPending;
    delete item.stale;
  }
  await writeFile(
    snapshotFilePath(),
    JSON.stringify(snapshot, null, 2),
    "utf8"
  );

  const operationDirectory = dirname(operationFilePath());
  await mkdir(operationDirectory, { recursive: true });
  const pendingPath = join(
    operationDirectory,
    `.${activeWorkspaceId}.operations.json.999.1.recovery.tmp`
  );
  await writeFile(
    pendingPath,
    JSON.stringify({
      schemaVersion: 0,
      workspaceId: firstState.workspace.id,
      operations: [
        {
          id: "operation_41_20260904110000000",
          kind: "worktree-create",
          targetIds: [
            `${target.repositoryId}:${target.worktreeId}`
          ],
          state: "running",
          message: "Creating a Worktree before shutdown.",
          startedAt: "2026-09-04T11:00:00.000Z"
        }
      ],
      updatedAt: "2026-09-04T11:00:00.000Z"
    }),
    "utf8"
  );
  await rm(operationFilePath(), { force: true });

  await mkdir(dirname(windowStateFilePath()), {
    recursive: true
  });
  await writeFile(
    windowStateFilePath(),
    JSON.stringify({
      schemaVersion: 0,
      x: 50_000,
      y: 50_000,
      width: 1_440,
      height: 900,
      isMaximized: false,
      updatedAt: "2026-09-04T11:00:00.000Z"
    }),
    "utf8"
  );
}

async function prepareCorruptWorkspace() {
  await mkdir(dirname(corruptWorkspaceFilePath()), {
    recursive: true
  });
  await writeFile(
    corruptWorkspaceFilePath(),
    "{ malformed workspace",
    "utf8"
  );
}

function workspaceFilePath() {
  return join(
    userDataPath,
    "workspaces",
    "items",
    `${activeWorkspaceId}.workspace.json`
  );
}

function snapshotFilePath() {
  return join(
    userDataPath,
    "cache",
    "repository-snapshots",
    "items",
    `${activeWorkspaceId}.snapshots.json`
  );
}

function operationFilePath() {
  return join(
    userDataPath,
    "operations",
    "items",
    `${activeWorkspaceId}.operations.json`
  );
}

function windowStateFilePath() {
  return join(
    userDataPath,
    "settings",
    "window-state.json"
  );
}

function corruptWorkspaceFilePath() {
  return join(
    corruptUserDataPath,
    "workspaces",
    "default.workspace.json"
  );
}

async function launchElectron(userData) {
  const port = await reservePort();
  const child = spawn(
    electronExecutable,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userData}`,
      desktopRoot
    ],
    {
      cwd: desktopRoot,
      env: {
        ...process.env,
        ELECTRON_RENDERER_URL: "",
        GIT_CONFIG_GLOBAL: join(fixtureRoot, "gitconfig"),
        GIT_CONFIG_NOSYSTEM: "1"
      },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  const logs = [];
  let spawnError;
  child.once("error", (error) => { spawnError = error; });
  child.stdout.on("data", (chunk) => {
    logs.push(chunk.toString("utf8"));
  });
  child.stderr.on("data", (chunk) => {
    logs.push(chunk.toString("utf8"));
  });
  let cdp;
  try {
    const target = await waitForPageTarget(port, child, () => spawnError);
    cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.waitForDocument();
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    await cdp.waitFor("GitNest renderer",
      `Boolean(document.querySelector(".app-shell"))`);
    return { child, cdp, logs };
  } catch (error) {
    cdp?.close();
    if (child.pid && child.exitCode === null) {
      await terminateProcessTree(child.pid);
    }
    throw new Error(`Electron startup failed: ${error instanceof Error ? error.message : error}\n${logs.join("")}`);
  }
}

async function closeElectron(launch) {
  if (!launch) {
    return;
  }
  try {
    await launch.cdp.evaluate(
      "window.gitnest.window.close().catch(() => undefined)"
    );
  } catch {}
  launch.cdp.close();
  const exited = await waitForExit(launch.child, 10_000);
  if (!exited && launch.child.pid) {
    await terminateProcessTree(launch.child.pid);
  }
  assert(
    launch.cdp.runtimeErrors.length === 0,
    `Renderer errors: ${launch.cdp.runtimeErrors.join("\n")}`
  );
  assert(
    launch.logs.every(
      (entry) =>
        !/unhandled|uncaught|fatal error/i.test(entry)
    ),
    `Electron emitted a fatal diagnostic: ${launch.logs.join("")}`
  );
}

async function waitForNoPendingJsonWrites(directory) {
  const startedAt = Date.now();
  let pending = [];
  while (Date.now() - startedAt < 10_000) {
    pending = (await readdir(directory)).filter((name) =>
      name.endsWith(".tmp")
    );
    if (pending.length === 0) {
      await delay(120);
      const confirmation = (
        await readdir(directory)
      ).filter((name) => name.endsWith(".tmp"));
      if (confirmation.length === 0) {
        return;
      }
      pending = confirmation;
    }
    await delay(120);
  }
  throw new Error(
    `Recovered operation store left pending temporary files: ${pending.join(
      ", "
    )}`
  );
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) {
    return true;
  }
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolvePromise(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolvePromise(true);
    };
    child.once("exit", onExit);
  });
}

async function readNativeWindowBounds(client) {
  return client.evaluate(`({
    x: window.screenX,
    y: window.screenY,
    width: window.outerWidth,
    height: window.outerHeight
  })`);
}

async function addWorkspacePath(client, path) {
  // Directory picking is a native OS dialog. Bootstrap via the public preload
  // contract; all subsequent navigation/search interactions use rendered UI.
  const result = await client.evaluate(`window.gitnest.workspace.addDirectory({
    path: ${JSON.stringify(path)}
  })`);
  assert(result?.ok, `Unable to add fixture: ${JSON.stringify(result)}`);
  await client.waitFor(
    "workspace repository row",
    `document.querySelectorAll(".repository-status-row").length > 1`,
    30_000
  );
  const state = await getWorkspaceState(client);
  activeWorkspaceId = state.workspace.id;
  await client.waitFor(
    "initial snapshot persistence",
    `(async () => {
      const result = await window.gitnest.workspace.getState();
      return Boolean(
        result.ok &&
        result.value.snapshots.length === result.value.workspace.worktrees.length &&
        result.value.snapshots.length > 0 &&
        result.value.snapshots.every(
          (snapshot) => !snapshot.refreshPending && !snapshot.stale && !snapshot.error
        )
      );
    })()`,
    30_000
  );
}

async function getWorkspaceState(client) {
  const result = await client.evaluate(`(async () =>
    window.gitnest.workspace.getState()
  )()`);
  if (!result?.ok) {
    throw new Error(
      result?.error?.message ?? "Workspace state unavailable."
    );
  }
  return result.value;
}

async function clickSelector(client, selector) {
  const clicked = await client.evaluate(`(() => {
    const element = document.querySelector(
      ${JSON.stringify(selector)}
    );
    if (!element || element.disabled) return false;
    element.click();
    return true;
  })()`);
  assert(clicked, `Unable to click selector ${selector}.`);
}

async function setInputValue(client, selector, value) {
  const changed = await client.evaluate(`(() => {
    const input = document.querySelector(
      ${JSON.stringify(selector)}
    );
    if (!(input instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;
    setter?.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  assert(changed, `Unable to set input ${selector}.`);
}

async function setWindowSize(client, width, height) {
  await client.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: width,
    screenHeight: height
  });
  await client.waitFor(
    `${width}x${height} viewport`,
    `window.innerWidth >= ${width - 2} &&
      window.innerWidth <= ${width + 2} &&
      window.innerHeight >= ${height - 2} &&
      window.innerHeight <= ${height + 2}`
  );
}

async function capture(client, path) {
  const result = await client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false
  });
  await writeFile(path, Buffer.from(result.data, "base64"));
}

async function runGit(cwd, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("git", args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GCM_INTERACTIVE: "Never",
        GIT_CONFIG_GLOBAL: join(fixtureRoot, "gitconfig"),
        GIT_CONFIG_NOSYSTEM: "1"
      },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stderr = [];
    const stdout = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", rejectPromise);
    child.once("close", (exitCode) => {
      if (exitCode === 0) {
        resolvePromise(Buffer.concat(stdout).toString("utf8").trim());
      } else {
        rejectPromise(
          new Error(
            `git ${args.join(" ")} failed (${exitCode}): ${Buffer.concat(stderr).toString("utf8")}`
          )
        );
      }
    });
  });
}

async function waitForPageTarget(port, child, getSpawnError = () => undefined) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    if (getSpawnError()) {
      throw getSpawnError();
    }
    if (child.exitCode !== null) {
      throw new Error(
        `Electron exited before exposing CDP (${child.exitCode}).`
      );
    }
    try {
      const targets = await fetch(
        `http://127.0.0.1:${port}/json/list`
      ).then((response) => response.json());
      const page = targets.find(
        (target) =>
          target.type === "page" &&
          target.webSocketDebuggerUrl
      );
      if (page) {
        return page;
      }
    } catch {}
    await delay(150);
  }
  throw new Error("Timed out waiting for Electron CDP.");
}

async function reservePort() {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer();
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port =
        address && typeof address === "object"
          ? address.port
          : undefined;
      server.close((error) => {
        if (error || !port) {
          rejectPromise(
            error ?? new Error("Unable to reserve a CDP port.")
          );
        } else {
          resolvePromise(port);
        }
      });
    });
  });
}

async function terminateProcessTree(pid) {
  await new Promise((resolvePromise) => {
    const child = spawn(
      "taskkill",
      ["/PID", String(pid), "/T", "/F"],
      {
        shell: false,
        windowsHide: true,
        stdio: "ignore"
      }
    );
    child.once("error", () => resolvePromise());
    child.once("close", () => resolvePromise());
  });
}

async function removeFixtureRoot(path) {
  if (
    dirname(path) !== temporaryDirectory ||
    !basename(path).startsWith(
      "gitnest-e2e-m3-recovery-"
    )
  ) {
    throw new Error(
      "Refusing to remove an unexpected fixture path."
    );
  }
  await rm(path, {
    recursive: true,
    force: true,
    maxRetries: 4,
    retryDelay: 150
  });
}

function intersectionArea(left, right) {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) -
      Math.max(left.x, right.x)
  );
  const height = Math.max(
    0,
    Math.min(
      left.y + left.height,
      right.y + right.height
    ) - Math.max(left.y, right.y)
  );
  return width * height;
}

function assert(value, message) {
  if (!value) {
    throw new Error(message);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      `${message} Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`
    );
  }
}

function assertIncludes(actual, expected) {
  if (!String(actual).includes(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(actual)} to include ${JSON.stringify(expected)}.`
    );
  }
}

function delay(milliseconds) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds)
  );
}

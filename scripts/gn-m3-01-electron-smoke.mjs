import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
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
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { CdpClient } from "./electron-cdp-client.mjs";
import { findElectronDistribution } from "./windows-release-support.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const desktopRoot = join(projectRoot, "apps", "desktop");
const electronDistribution =
  await findElectronDistribution({
    projectRoot,
    desktopDirectory: desktopRoot
  });
const electronExecutable = join(
  electronDistribution,
  "electron.exe"
);
const screenshotDirectory = join(projectRoot, "test-results");
const fixtureRoot = await mkdtemp(
  join(tmpdir(), "gitnest-e2e-m3-worktree-")
);
const workspacePath = join(fixtureRoot, "workspace root");
const repositoryPath = join(
  workspacePath,
  "repository & unicode 测试"
);
const stalePath = join(workspacePath, "stale worktree");
const createdPath = join(
  workspacePath,
  "created worktree 测试"
);
const movedPath = join(
  workspacePath,
  "moved worktree 测试"
);
const userDataPath = join(fixtureRoot, "user-data");
const debugPort = await reservePort();
let electron;
let cdp;

try {
  await createFixture();
  await mkdir(userDataPath, { recursive: true });
  await mkdir(screenshotDirectory, { recursive: true });

  electron = spawn(
    electronExecutable,
    [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataPath}`,
      desktopRoot
    ],
    {
      cwd: desktopRoot,
      env: {
        ...process.env,
        ELECTRON_RENDERER_URL: ""
      },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  const electronLogs = [];
  electron.stdout.on("data", (chunk) => {
    electronLogs.push(chunk.toString("utf8"));
  });
  electron.stderr.on("data", (chunk) => {
    electronLogs.push(chunk.toString("utf8"));
  });

  const target = await waitForPageTarget(debugPort, electron);
  cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.waitForDocument();
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.waitFor(
    "GitNest renderer",
    `Boolean(document.querySelector(".app-shell"))`
  );

  await setWindowSize(cdp, 1440, 900);
  await addWorkspacePath(cdp, workspacePath);
  await openRepository(cdp);
  await clickButton(cdp, "Worktrees", ".context-tabs");
  await cdp.waitFor(
    "Worktree management page",
    `Boolean(document.querySelector(".worktree-management"))`
  );
  await cdp.waitFor(
    "prunable Worktree card",
    `String(document.querySelector(".worktree-management")?.textContent)
      .includes("可清理登记")`
  );
  assert(
    await hasNoHorizontalOverflow(cdp),
    "Worktrees page overflowed at 1440px."
  );
  await capture(
    cdp,
    join(
      screenshotDirectory,
      "gn-m3-01-1440-worktrees.png"
    )
  );

  await clickButton(cdp, "新建 Worktree", ".worktree-management");
  await setInputValue(
    cdp,
    'input[aria-label="Worktree 目标绝对路径"]',
    createdPath
  );
  await setInputValue(
    cdp,
    "#worktree-create-branch",
    "feature/e2e-worktree"
  );
  await setWindowSize(cdp, 1100, 812);
  assert(
    await hasNoHorizontalOverflow(cdp),
    "Worktrees page overflowed at 1100px."
  );
  await capture(
    cdp,
    join(
      screenshotDirectory,
      "gn-m3-01-1100-worktrees.png"
    )
  );
  const createOperation = await runConfirmedCommand(
    cdp,
    "worktree-create",
    () =>
      clickButton(
        cdp,
        "预检并创建",
        ".worktree-create-panel"
      ),
    "确认并执行",
    async () => {
      const dialogText = await textOf(
        cdp,
        ".gn-dialog"
      );
      assertIncludes(dialogText, createdPath);
      assertIncludes(dialogText, "feature/e2e-worktree");
      await assertFocusedDialogButton(
        cdp,
        "确认并执行"
      );
      await pressKey(cdp, "Tab");
      await assertFocusedDialogButton(cdp, "取消");
      await pressKey(cdp, "Tab", true);
      await assertFocusedDialogButton(
        cdp,
        "确认并执行"
      );
      assert(
        await hasNoHorizontalOverflow(cdp),
        "Create Worktree dialog overflowed at 1100px."
      );
      await capture(
        cdp,
        join(
          screenshotDirectory,
          "gn-m3-01-1100-create-preflight.png"
        )
      );
    }
  );
  assert(
    createOperation.state === "succeeded",
    createOperation.message
  );
  await waitForWorktreeCard(cdp, createdPath);
  assertWorktreeRecord(
    await readWorktreeRecords(),
    createdPath,
    (record) =>
      record.includes("branch refs/heads/feature/e2e-worktree"),
    "Created Worktree registration is missing."
  );

  await setWindowSize(cdp, 1440, 900);
  // Lock/unlock/move/repair no longer have card actions. Verify their real
  // preload/IPC/service paths; create/remove/prune remain UI interactions.
  const lockOperation = await runBridgeCommand(cdp, createdPath, {
    type: "lock", reason: "release validation"
  });
  assert(
    lockOperation.state === "succeeded",
    lockOperation.message
  );
  assertWorktreeRecord(
    await readWorktreeRecords(),
    createdPath,
    (record) =>
      record.includes("locked release validation"),
    "Worktree lock reason was not preserved."
  );

  const unlockOperation = await runBridgeCommand(cdp, createdPath, {
    type: "unlock"
  });
  assert(
    unlockOperation.state === "succeeded",
    unlockOperation.message
  );
  assertWorktreeRecord(
    await readWorktreeRecords(),
    createdPath,
    (record) => !record.includes("\nlocked"),
    "Worktree remained locked after Unlock."
  );

  const moveOperation = await runBridgeCommand(cdp, createdPath, {
    type: "move", destination: movedPath
  });
  assert(
    moveOperation.state === "succeeded",
    moveOperation.message
  );
  await waitForWorktreeCard(cdp, movedPath);
  await assertPathExists(movedPath, true);
  await assertPathExists(createdPath, false);

  const repairOperation = await runBridgeCommand(cdp, movedPath, {
    type: "repair"
  });
  assert(
    repairOperation.state === "succeeded",
    repairOperation.message
  );

  await setWindowSize(cdp, 1100, 812);
  await clickButton(cdp, "筛选", ".worktree-toolbar");
  await setInputValue(cdp, 'input[aria-label="筛选 Worktree"]', movedPath);
  await clickButton(cdp, "已登记", ".worktree-filter-bar");
  await cdp.waitFor("clean Worktree delete action",
    `Boolean(document.querySelector('button[aria-label="删除筛选中的 Worktree"]:not(:disabled)'))`);
  const removeOperation = await runConfirmedCommand(
    cdp,
    "worktree-remove",
    () => clickSelector(cdp, 'button[aria-label="删除筛选中的 Worktree"]'),
    "确认删除 Worktree",
    async () => {
      const dialogText = await textOf(
        cdp,
        '.gn-dialog[data-tone="danger"]'
      );
      assertIncludes(dialogText, movedPath);
      assertIncludes(dialogText, "不使用 --force");
      await assertFocusedDialogButton(cdp, "取消");
      await pressKey(cdp, "Tab");
      await assertFocusedDialogButton(
        cdp,
        "确认删除 Worktree"
      );
      assert(
        await hasNoHorizontalOverflow(cdp),
        "Remove Worktree dialog overflowed at 1100px."
      );
      await capture(
        cdp,
        join(
          screenshotDirectory,
          "gn-m3-01-1100-remove-preflight.png"
        )
      );
    }
  );
  assert(
    removeOperation.state === "succeeded",
    removeOperation.message
  );
  await assertPathExists(movedPath, false);
  assert(
    !(await readWorktreeRecords()).some(
      (record) =>
        normalized(record).includes(normalized(movedPath))
    ),
    "Removed Worktree remains registered."
  );

  await setInputValue(cdp, 'input[aria-label="筛选 Worktree"]', "");
  await clickButton(cdp, "可清理登记", ".worktree-filter-bar");
  const pruneOperation = await runConfirmedCommand(
    cdp,
    "worktree-prune",
    () =>
      clickSelector(cdp, 'button[aria-label="清除失效 Worktree 登记"]'),
    "确认并执行",
    async () => {
      const dialogText = await textOf(
        cdp,
        ".gn-dialog"
      );
      assertIncludes(dialogText, stalePath);
      assertIncludes(dialogText, "不会递归删除仍存在的目录");
    }
  );
  assert(
    pruneOperation.state === "succeeded",
    pruneOperation.message
  );
  assert(
    !(await readWorktreeRecords()).some(
      (record) =>
        normalized(record).includes(normalized(stalePath))
    ),
    "Pruned Worktree remains registered."
  );

  await clickSelector(cdp, 'button[aria-label="操作中心"]');
  await cdp.waitFor(
    "operation center",
    `Boolean(document.querySelector(".operation-center-page"))`
  );
  const operationText = await textOf(
    cdp,
    ".operation-center-page"
  );
  for (const label of [
    "创建 Worktree",
    "锁定 Worktree",
    "解锁 Worktree",
    "移动 Worktree",
    "修复 Worktree 登记",
    "清除失效 Worktree 登记",
    "删除 Worktree"
  ]) {
    assertIncludes(operationText, label);
  }
  assert(
    await hasNoHorizontalOverflow(cdp),
    "Operation center overflowed at 1100px after Worktree operations."
  );
  await capture(
    cdp,
    join(
      screenshotDirectory,
      "gn-m3-01-1100-operation-center.png"
    )
  );

  const rendererBoundary = await cdp.evaluate(`({
    processType: typeof process,
    requireType: typeof require,
    bufferType: typeof Buffer
  })`);
  assertEqual(
    JSON.stringify(rendererBoundary),
    JSON.stringify({
      processType: "undefined",
      requireType: "undefined",
      bufferType: "undefined"
    }),
    "Renderer Node globals are exposed."
  );
  assert(
    cdp.runtimeErrors.length === 0,
    `Renderer errors: ${cdp.runtimeErrors.join("\n")}`
  );
  assert(
    electronLogs.every(
      (entry) =>
        !/unhandled|uncaught|fatal error/i.test(entry)
    ),
    `Electron emitted a fatal diagnostic: ${electronLogs.join("")}`
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        fixtureRoot,
        screenshots: [
          "gn-m3-01-1440-worktrees.png",
          "gn-m3-01-1100-worktrees.png",
          "gn-m3-01-1100-create-preflight.png",
          "gn-m3-01-1100-remove-preflight.png",
          "gn-m3-01-1100-operation-center.png"
        ],
        operations: {
          create: createOperation.state,
          lock: lockOperation.state,
          unlock: unlockOperation.state,
          move: moveOperation.state,
          repair: repairOperation.state,
          remove: removeOperation.state,
          prune: pruneOperation.state
        },
        interactionCoverage: {
          ui: ["create", "remove", "prune"],
          publicBridge: ["lock", "unlock", "move", "repair"]
        }
      },
      null,
      2
    )
  );
} finally {
  if (cdp) {
    try {
      await cdp.evaluate(
        "window.gitnest.window.close().catch(() => undefined)"
      );
    } catch {}
    cdp.close();
  }
  if (electron?.pid) {
    await terminateProcessTree(electron.pid);
  }
  if (process.env.GITNEST_KEEP_E2E !== "1") {
    try {
      await removeFixtureRoot(fixtureRoot);
    } catch (error) {
      console.warn(
        `Unable to remove temporary fixture ${fixtureRoot}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  } else {
    console.log(`Temporary fixture retained at ${fixtureRoot}`);
  }
}

async function createFixture() {
  await mkdir(repositoryPath, { recursive: true });
  await runGit(repositoryPath, [
    "init",
    "--initial-branch=main"
  ]);
  await runGit(repositoryPath, [
    "config",
    "user.name",
    "GitNest Worktree Smoke"
  ]);
  await runGit(repositoryPath, [
    "config",
    "user.email",
    "worktree@example.invalid"
  ]);
  await writeFile(
    join(repositoryPath, "README.md"),
    "# GitNest GN-M3-01 smoke\n",
    "utf8"
  );
  await runGit(repositoryPath, ["add", "README.md"]);
  await runGit(repositoryPath, [
    "commit",
    "-m",
    "Initial Worktree smoke fixture"
  ]);
  await runGit(repositoryPath, [
    "worktree",
    "add",
    "-b",
    "feature/stale",
    stalePath,
    "HEAD"
  ]);
  await rm(stalePath, {
    recursive: true,
    force: true
  });
}

async function readWorktreeRecords() {
  const output = (
    await runGit(repositoryPath, [
      "worktree",
      "list",
      "--porcelain"
    ])
  ).stdout.trim();
  return output
    ? output.split(/\r?\n\r?\n/).filter(Boolean)
    : [];
}

function assertWorktreeRecord(
  records,
  path,
  predicate,
  message
) {
  const record = records.find((candidate) =>
    normalized(candidate).includes(normalized(path))
  );
  assert(record && predicate(record), message);
}

async function addWorkspacePath(client, path) {
  // Directory picking uses a native dialog; bootstrap the fixture through
  // the public bridge and exercise create/remove/prune actions in the UI.
  const result = await client.evaluate(`window.gitnest.workspace.addDirectory({
    path: ${JSON.stringify(path)}
  })`);
  assert(result?.ok, `Unable to add fixture: ${JSON.stringify(result)}`);
  await client.waitFor(
    "workspace repository row",
    `document.querySelectorAll(".repository-status-row").length > 1`,
    30_000
  );
}

async function openRepository(client) {
  const clicked = await client.evaluate(`(() => {
    const rows = [...document.querySelectorAll(
      "button.repository-status-row"
    )];
    const row = rows.find((candidate) =>
      String(candidate.textContent).includes(
        "repository & unicode 测试"
      )
    );
    if (!row) return false;
    row.click();
    return true;
  })()`);
  assert(clicked, "Unable to open the temporary repository.");
  await client.waitFor(
    "repository page",
    `Boolean(document.querySelector(".repository-page"))`
  );
}

async function runImmediateCommand(client, kind, trigger) {
  const previousIds = new Set(
    (await getOperations(client))
      .filter((operation) => operation.kind === kind)
      .map((operation) => operation.id)
  );
  await trigger();
  return waitForNewOperation(
    client,
    kind,
    previousIds,
    new Set(["succeeded", "failed", "cancelled"])
  );
}

async function runBridgeCommand(client, path, options) {
  return runImmediateCommand(client, `worktree-${options.type}`, async () => {
    const result = await client.evaluate(`(async () => {
      const state = await window.gitnest.workspace.getState();
      if (!state.ok) return state;
      const worktree = state.value.workspace.worktrees.find(
        (item) => item.path === ${JSON.stringify(path)}
      );
      if (!worktree) throw new Error("Fixture worktree missing.");
      const command = { ...${JSON.stringify(options)}, worktreeId: worktree.id };
      const preflight = await window.gitnest.worktree.preflightCommand({ command });
      if (!preflight.ok) return preflight;
      return window.gitnest.worktree.executeCommand({
        command: preflight.value.command,
        preflightId: preflight.value.preflightId,
        confirmed: preflight.value.confirmationRequired
      });
    })()`);
    assert(result?.ok, `Worktree ${options.type} failed: ${JSON.stringify(result)}`);
  });
}

async function runConfirmedCommand(
  client,
  kind,
  trigger,
  confirmLabel,
  inspectDialog = async () => undefined
) {
  const previousIds = new Set(
    (await getOperations(client))
      .filter((operation) => operation.kind === kind)
      .map((operation) => operation.id)
  );
  await trigger();
  await client.waitFor(
    `${kind} preflight dialog`,
    `Boolean(document.querySelector(".gn-dialog"))`,
    20_000
  );
  await inspectDialog();
  await clickButton(client, confirmLabel, ".gn-dialog");
  return waitForNewOperation(
    client,
    kind,
    previousIds,
    new Set(["succeeded", "failed", "cancelled"])
  );
}

async function getOperations(client) {
  const result = await client.evaluate(`(async () =>
    window.gitnest.workspace.getState()
  )()`);
  if (!result?.ok) {
    throw new Error(
      result?.error?.message ?? "Workspace state is unavailable."
    );
  }
  return result.value.operations;
}

async function waitForNewOperation(
  client,
  kind,
  previousIds,
  desiredStates
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 45_000) {
    const operation = (await getOperations(client)).find(
      (candidate) =>
        candidate.kind === kind &&
        !previousIds.has(candidate.id)
    );
    if (operation && desiredStates.has(operation.state)) {
      return operation;
    }
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${kind} operation.`);
}

async function waitForWorktreeCard(client, path) {
  await client.waitFor(
    `Worktree card ${path}`,
    worktreeCardExpression(path)
  );
}

function worktreeCardExpression(path) {
  return `(() => {
    const normalize = (value) =>
      String(value ?? "").replace(/\\s+/g, " ").trim();
    return [...document.querySelectorAll(
      ".worktree-card"
    )].some((candidate) =>
      normalize(candidate.textContent).includes(
        ${JSON.stringify(path)}
      )
    );
  })()`;
}

async function clickButton(
  client,
  label,
  rootSelector = "body"
) {
  const clicked = await client.evaluate(`(() => {
    const normalize = (value) =>
      String(value ?? "").replace(/\\s+/g, " ").trim();
    const root = document.querySelector(
      ${JSON.stringify(rootSelector)}
    );
    const button = root && [...root.querySelectorAll("button")]
      .find((candidate) => {
        const content = candidate.cloneNode(true);
        content.querySelectorAll(".tab-count, .worktree-filter-chip-count").forEach((badge) => badge.remove());
        return normalize(content.textContent) === ${JSON.stringify(label)};
      });
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  assert(clicked, `Unable to click button ${label}.`);
}

async function assertFocusedDialogButton(
  client,
  label
) {
  await client.waitFor(
    `focused dialog button ${label}`,
    `(() => {
      const normalize = (value) =>
        String(value ?? "").replace(/\\s+/g, " ").trim();
      const active = document.activeElement;
      return (
        active instanceof HTMLButtonElement &&
        Boolean(active.closest(".gn-dialog")) &&
        normalize(active.textContent) ===
          ${JSON.stringify(label)}
      );
    })()`
  );
}

async function pressKey(client, key, shift = false) {
  const keyCode =
    key === "Tab" ? 9 : key === "Escape" ? 27 : 0;
  const code =
    key === "Escape" ? "Escape" : key;
  const parameters = {
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
    modifiers: shift ? 8 : 0
  };
  await client.send("Input.dispatchKeyEvent", {
    ...parameters,
    type: "keyDown"
  });
  await client.send("Input.dispatchKeyEvent", {
    ...parameters,
    type: "keyUp"
  });
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

async function textOf(client, selector) {
  return client.evaluate(
    `document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`
  );
}

async function hasNoHorizontalOverflow(client) {
  return client.evaluate(`(
    document.documentElement.scrollWidth <= window.innerWidth &&
    document.body.scrollWidth <= window.innerWidth
  )`);
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
    `${width}x${height} window`,
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

async function assertPathExists(path, expected) {
  let exists = true;
  try {
    await stat(path);
  } catch {
    exists = false;
  }
  assertEqual(
    exists,
    expected,
    `Unexpected filesystem state for ${path}.`
  );
}

async function runGit(cwd, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("git", args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GCM_INTERACTIVE: "Never"
      },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", rejectPromise);
    child.once("close", (exitCode) => {
      const result = {
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      };
      if (exitCode === 0) {
        resolvePromise(result);
      } else {
        rejectPromise(
          new Error(
            `git ${args.join(" ")} failed (${exitCode}): ${result.stderr}`
          )
        );
      }
    });
  });
}

async function waitForPageTarget(port, child) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
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
        (candidate) =>
          candidate.type === "page" &&
          candidate.webSocketDebuggerUrl
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
    dirname(path) !== tmpdir() ||
    !basename(path).startsWith(
      "gitnest-e2e-m3-worktree-"
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

function normalized(value) {
  return String(value)
    .replace(/\//g, "\\")
    .toLocaleLowerCase("en-US");
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

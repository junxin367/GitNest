import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
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
const workspaceRoot = resolve(scriptDirectory, "..");
const desktopRoot = join(workspaceRoot, "apps", "desktop");
const electronDistribution =
  await findElectronDistribution({
    projectRoot: workspaceRoot,
    desktopDirectory: desktopRoot
  });
const electronExecutable = join(
  electronDistribution,
  "electron.exe"
);
const screenshotDirectory = join(workspaceRoot, "test-results");
const fixtureRoot = await mkdtemp(
  join(tmpdir(), "gitnest-e2e-m2-sync-")
);
const remotePath = join(fixtureRoot, "origin.git");
const localPath = join(
  fixtureRoot,
  "local & unicode 测试"
);
const peerPath = join(fixtureRoot, "peer clone");
const userDataPath = join(fixtureRoot, "user-data");
const port = await reservePort();
let electron;
let cdp;

try {
  await createFixture();
  await mkdir(userDataPath, { recursive: true });
  await mkdir(screenshotDirectory, { recursive: true });

  electron = spawn(
    electronExecutable,
    [
      `--remote-debugging-port=${port}`,
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

  const target = await waitForPageTarget(port, electron);
  cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.waitFor(
    "GitNest renderer",
    `Boolean(document.querySelector(".app-shell"))`
  );

  await setWindowSize(cdp, 1440, 900);
  await addWorkspacePath(cdp, localPath);
  await openRepository(cdp);

  const fetch = await runImmediateCommand(cdp, "fetch", () =>
    clickButton(cdp, "Fetch", ".repository-actions")
  );
  assert(fetch.state === "succeeded", fetch.message);
  assertEqual(
    await gitOutput(localPath, [
      "rev-parse",
      "refs/remotes/origin/main"
    ]),
    await gitOutput(peerPath, ["rev-parse", "HEAD"]),
    "Fetch did not update origin/main."
  );

  const pull = await runConfirmedCommand(
    cdp,
    "pull",
    () => clickButton(cdp, "Pull", ".repository-actions"),
    async () => {
      const dialogText = await textOf(cdp, ".command-dialog");
      assertIncludes(dialogText, "Pull origin/main");
      assertIncludes(dialogText, localPath);
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
      await capture(
        cdp,
        join(
          screenshotDirectory,
          "gn-m2-03-1440-pull-preflight.png"
        )
      );
    }
  );
  assert(pull.state === "succeeded", pull.message);
  assertEqual(
    await gitOutput(localPath, ["rev-parse", "HEAD"]),
    await gitOutput(peerPath, ["rev-parse", "HEAD"]),
    "Pull did not fast-forward local HEAD."
  );

  await setWindowSize(cdp, 1100, 812);
  await clickSelector(cdp, ".force-push-button");
  await cdp.waitFor(
    "force-with-lease dialog",
    `Boolean(document.querySelector(".command-dialog.danger"))`
  );
  const forceDialog = await textOf(cdp, ".command-dialog");
  assertIncludes(forceDialog, "Force with lease");
  assertIncludes(forceDialog, "origin/main");
  await assertFocusedDialogButton(cdp, "取消");
  await pressKey(cdp, "Tab");
  await assertFocusedDialogButton(
    cdp,
    "确认 Force with lease"
  );
  assert(
    await hasNoHorizontalOverflow(cdp),
    "Force-with-lease dialog overflowed at 1100px."
  );
  await capture(
    cdp,
    join(
      screenshotDirectory,
      "gn-m2-03-1100-force-preflight.png"
    )
  );
  await clickButton(cdp, "取消", ".command-dialog");
  await cdp.waitFor(
    "force dialog dismissal",
    `!document.querySelector(".command-dialog")`
  );

  await setWindowSize(cdp, 1440, 900);
  await commitFile(
    localPath,
    "local-push.txt",
    "local push\n",
    "Local push through GitNest"
  );
  const push = await runConfirmedCommand(
    cdp,
    "push",
    () => clickButton(cdp, "Push", ".repository-actions")
  );
  assert(push.state === "succeeded", push.message);
  assertEqual(
    await gitOutput(remotePath, [
      "rev-parse",
      "refs/heads/main"
    ]),
    await gitOutput(localPath, ["rev-parse", "HEAD"]),
    "Push did not update remote main."
  );

  await clickButton(cdp, "分支", ".context-tabs");
  await cdp.waitFor(
    "branches page",
    `Boolean(document.querySelector(".branches-panel"))`
  );
  await setInputValue(
    cdp,
    "#new-branch-name",
    "feature/e2e"
  );
  const createBranch = await runConfirmedCommand(
    cdp,
    "create-branch",
    () =>
      clickButton(
        cdp,
        "创建",
        ".branch-management-toolbar"
      )
  );
  assert(createBranch.state === "succeeded", createBranch.message);
  await waitForGitRef(localPath, "refs/heads/feature/e2e", true);
  await waitForBranchRow(cdp, "feature/e2e");

  const switchBranch = await runConfirmedCommand(
    cdp,
    "switch-branch",
    () => clickBranchAction(cdp, "feature/e2e", "切换")
  );
  assert(switchBranch.state === "succeeded", switchBranch.message);
  assertEqual(
    await gitOutput(localPath, ["branch", "--show-current"]),
    "feature/e2e",
    "Branch switch did not update HEAD."
  );
  await waitForBranchRow(cdp, "feature/e2e");

  await clickBranchAction(cdp, "feature/e2e", "重命名");
  await setInputValue(
    cdp,
    ".branch-rename-form input",
    "feature/e2e-renamed"
  );
  const renameBranch = await runConfirmedCommand(
    cdp,
    "rename-branch",
    () => clickBranchAction(cdp, "feature/e2e", "保存")
  );
  assert(renameBranch.state === "succeeded", renameBranch.message);
  assertEqual(
    await gitOutput(localPath, ["branch", "--show-current"]),
    "feature/e2e-renamed",
    "Branch rename did not update the current branch."
  );

  const switchMain = await runConfirmedCommand(
    cdp,
    "switch-branch",
    () => selectValue(cdp, ".header-branch-switcher select", "main")
  );
  assert(switchMain.state === "succeeded", switchMain.message);
  assertEqual(
    await gitOutput(localPath, ["branch", "--show-current"]),
    "main",
    "Header branch switcher did not return to main."
  );
  await waitForBranchRow(cdp, "feature/e2e-renamed");

  const deleteBranch = await runConfirmedCommand(
    cdp,
    "delete-branch",
    () =>
      clickBranchAction(
        cdp,
        "feature/e2e-renamed",
        "删除"
      ),
    async () => {
      const dialogText = await textOf(cdp, ".command-dialog");
      assertIncludes(dialogText, "feature/e2e-renamed");
      assertIncludes(dialogText, localPath);
    }
  );
  assert(deleteBranch.state === "succeeded", deleteBranch.message);
  await waitForGitRef(
    localPath,
    "refs/heads/feature/e2e-renamed",
    false
  );
  assert(
    await hasNoHorizontalOverflow(cdp),
    "Branches page overflowed at 1440px."
  );
  await capture(
    cdp,
    join(
      screenshotDirectory,
      "gn-m2-03-1440-branches.png"
    )
  );

  const remoteBeforeCancelledPush = await gitOutput(remotePath, [
    "rev-parse",
    "refs/heads/main"
  ]);
  await commitFile(
    localPath,
    "cancelled-push.txt",
    "must stay local\n",
    "Cancelled push"
  );
  const hookPath = join(localPath, ".git", "hooks", "pre-push");
  await writeFile(
    hookPath,
    "#!/bin/sh\nsleep 30\n",
    {
      encoding: "utf8",
      mode: 0o755
    }
  );

  const existingPushIds = new Set(
    (await getOperations(cdp))
      .filter((operation) => operation.kind === "push")
      .map((operation) => operation.id)
  );
  await clickButton(cdp, "Push", ".repository-actions");
  await cdp.waitFor(
    "cancelled Push preflight",
    `Boolean(document.querySelector(".command-dialog"))`
  );
  await clickButton(cdp, "确认并执行", ".command-dialog");
  const runningPush = await waitForNewOperation(
    cdp,
    "push",
    existingPushIds,
    new Set(["running"])
  );
  await delay(1_500);
  await waitForOperationState(
    cdp,
    runningPush.id,
    new Set(["running"])
  );
  await clickSelector(
    cdp,
    'button[aria-label="Workspace 总览"]'
  );
  await cdp.waitFor(
    "Push cancel button",
    `(() => {
      const normalize = (value) =>
        String(value ?? "").replace(/\\s+/g, " ").trim();
      return [...document.querySelectorAll(".operation-row")]
        .some((row) =>
          normalize(row.textContent).includes("推送分支") &&
          [...row.querySelectorAll("button")]
            .some((button) => normalize(button.textContent) === "取消")
        );
    })()`
  );
  await clickOperationCancel(cdp, runningPush.id);
  const cancelledPush = await waitForOperationState(
    cdp,
    runningPush.id,
    new Set(["cancelled"])
  );
  assert(
    cancelledPush.state === "cancelled",
    "Push cancellation did not reach the cancelled state."
  );
  assertEqual(
    await gitOutput(remotePath, [
      "rev-parse",
      "refs/heads/main"
    ]),
    remoteBeforeCancelledPush,
    "Cancelled Push modified the remote."
  );
  await setWindowSize(cdp, 1100, 812);
  assert(
    await hasNoHorizontalOverflow(cdp),
    "Operation center overflowed at 1100px."
  );
  await capture(
    cdp,
    join(
      screenshotDirectory,
      "gn-m2-03-1100-cancelled-push.png"
    )
  );

  await clickSelector(cdp, 'button[aria-label="操作中心"]');
  await cdp.waitFor(
    "full operation center",
    `Boolean(document.querySelector(".operation-center-page"))`
  );
  const operationCenterText = await textOf(
    cdp,
    ".operation-center-page"
  );
  assertIncludes(operationCenterText, "Workspace 批量同步");
  assertIncludes(operationCenterText, "Push 已取消");
  assert(
    await hasNoHorizontalOverflow(cdp),
    "Full operation center overflowed at 1100px."
  );
  await capture(
    cdp,
    join(
      screenshotDirectory,
      "gn-m2-04-1100-operation-center.png"
    )
  );

  await clickSelector(cdp, 'button[aria-label="设置"]');
  await cdp.waitFor(
    "account settings",
    `Boolean(document.querySelector(".settings-page"))`
  );
  await setWindowSize(cdp, 1440, 900);
  await selectValue(
    cdp,
    ".account-form-grid label:nth-child(1) select",
    "custom"
  );
  await setInputValue(
    cdp,
    ".account-form-grid label:nth-child(2) input",
    "git.example.test"
  );
  await setInputValue(
    cdp,
    ".account-form-grid label:nth-child(4) input",
    "e2e-user"
  );
  const accountToken = "e2e-safe-storage-token-测试";
  await setInputValue(
    cdp,
    ".account-token-field input",
    accountToken
  );
  await clickButton(cdp, "保存账号", ".account-form");
  await cdp.waitFor(
    "saved account card",
    `(() => {
      const card = document.querySelector(".account-card");
      const tokenInput = document.querySelector(
        ".account-token-field input"
      );
      return Boolean(
        card &&
        String(card.textContent).includes("git.example.test") &&
        tokenInput instanceof HTMLInputElement &&
        tokenInput.value === "" &&
        !String(document.body.textContent).includes(
          ${JSON.stringify(accountToken)}
        )
      );
    })()`,
    20_000
  );
  const metadataPath = join(
    userDataPath,
    "accounts",
    "metadata.json"
  );
  const metadataText = await readFile(metadataPath, "utf8");
  assert(
    !metadataText.includes(accountToken),
    "Account metadata contains the plaintext token."
  );
  assert(
    !/"(?:token|secret|password|privateKey)"\s*:/.test(
      metadataText
    ),
    "Account metadata contains a forbidden secret field."
  );
  const credentialDirectory = join(
    userDataPath,
    "accounts",
    "credentials"
  );
  const credentialFiles = (
    await readdir(credentialDirectory)
  ).filter((name) => name.endsWith(".bin"));
  assert(
    credentialFiles.length === 1,
    "Expected one protected credential file."
  );
  const protectedCredential = await readFile(
    join(
      credentialDirectory,
      credentialFiles[0]
    )
  );
  assert(
    !protectedCredential
      .toString("utf8")
      .includes(accountToken),
    "Protected credential file contains plaintext."
  );

  await clickButton(
    cdp,
    "绑定当前仓库",
    ".account-card"
  );
  await cdp.waitFor(
    "repository account binding",
    `String(document.querySelector(".account-card")?.textContent)
      .includes("取消当前仓库绑定")`
  );
  const boundMetadata = JSON.parse(
    await readFile(metadataPath, "utf8")
  );
  assert(
    boundMetadata.bindings.some(
      (binding) =>
        binding.repositoryId &&
        binding.accountId === boundMetadata.profiles[0]?.id
    ),
    "Repository account binding was not persisted."
  );
  assert(
    String(
      await textOf(cdp, ".terminal-settings-panel")
    ).includes("可用"),
    "Settings did not expose detected terminal profiles."
  );
  await capture(
    cdp,
    join(
      screenshotDirectory,
      "gn-m2-04-1440-accounts.png"
    )
  );

  await clickButton(cdp, "删除", ".account-card");
  await cdp.waitFor(
    "account removal impact",
    `Boolean(document.querySelector(".account-removal-dialog"))`
  );
  const accountRemovalText = await textOf(
    cdp,
    ".account-removal-dialog"
  );
  assertIncludes(accountRemovalText, "git.example.test");
  assertIncludes(accountRemovalText, "local & unicode 测试");
  await clickButton(
    cdp,
    "取消",
    ".account-removal-dialog"
  );

  await setWindowSize(cdp, 1100, 812);
  await clickSelector(cdp, 'button[aria-label="当前仓库"]');
  await cdp.waitFor(
    "repository after settings",
    `Boolean(document.querySelector(".repository-page"))`
  );
  await clickSelector(cdp, ".terminal-menu > summary");
  await cdp.waitFor(
    "terminal whitelist menu",
    `Boolean(document.querySelector(".terminal-menu[open] .toolbar-menu-popover"))`
  );
  const terminalMenuText = await textOf(
    cdp,
    ".terminal-menu .toolbar-menu-popover"
  );
  assert(
    /PowerShell|Command Prompt|Git Bash|Windows Terminal/.test(
      terminalMenuText
    ),
    "Terminal menu did not contain a supported profile."
  );
  assert(
    await hasNoHorizontalOverflow(cdp),
    "Repository terminal menu overflowed at 1100px."
  );
  await capture(
    cdp,
    join(
      screenshotDirectory,
      "gn-m2-04-1100-terminal-menu.png"
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
          "gn-m2-03-1440-pull-preflight.png",
          "gn-m2-03-1100-force-preflight.png",
          "gn-m2-03-1440-branches.png",
          "gn-m2-03-1100-cancelled-push.png",
          "gn-m2-04-1100-operation-center.png",
          "gn-m2-04-1440-accounts.png",
          "gn-m2-04-1100-terminal-menu.png"
        ],
        operations: {
          fetch: fetch.state,
          pull: pull.state,
          push: push.state,
          createBranch: createBranch.state,
          switchBranch: switchBranch.state,
          renameBranch: renameBranch.state,
          deleteBranch: deleteBranch.state,
          cancelledPush: cancelledPush.state
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
  await mkdir(localPath, { recursive: true });
  await runGit(localPath, ["init", "--initial-branch=main"]);
  await configureIdentity(localPath, "Local");
  await writeFile(
    join(localPath, "README.md"),
    "# GitNest GN-M2-03 smoke\n",
    "utf8"
  );
  await runGit(localPath, ["add", "README.md"]);
  await runGit(localPath, [
    "commit",
    "-m",
    "Initial smoke fixture"
  ]);
  await runGit(fixtureRoot, [
    "init",
    "--bare",
    "--initial-branch=main",
    remotePath
  ]);
  await runGit(localPath, [
    "remote",
    "add",
    "origin",
    remotePath
  ]);
  await runGit(localPath, [
    "push",
    "--set-upstream",
    "origin",
    "main"
  ]);
  await runGit(fixtureRoot, [
    "clone",
    "--branch",
    "main",
    remotePath,
    peerPath
  ]);
  await configureIdentity(peerPath, "Peer");
  await commitFile(
    peerPath,
    "remote-update.txt",
    "remote update\n",
    "Remote update"
  );
  await runGit(peerPath, ["push", "origin", "main"]);
}

async function configureIdentity(path, suffix) {
  await runGit(path, [
    "config",
    "user.name",
    `GitNest ${suffix} Smoke`
  ]);
  await runGit(path, [
    "config",
    "user.email",
    `${suffix.toLowerCase()}@example.invalid`
  ]);
}

async function commitFile(path, name, content, message) {
  await writeFile(join(path, name), content, "utf8");
  await runGit(path, ["add", "--", name]);
  await runGit(path, ["commit", "-m", message]);
  return gitOutput(path, ["rev-parse", "HEAD"]);
}

async function runGit(cwd, args, allowFailure = false) {
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
      if (exitCode === 0 || allowFailure) {
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

async function gitOutput(cwd, args) {
  return (await runGit(cwd, args)).stdout.trim();
}

async function waitForGitRef(cwd, ref, exists) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    const result = await runGit(
      cwd,
      ["show-ref", "--verify", "--quiet", ref],
      true
    );
    if ((result.exitCode === 0) === exists) {
      return;
    }
    await delay(120);
  }
  throw new Error(
    `${ref} did not become ${exists ? "available" : "absent"}.`
  );
}

async function addWorkspacePath(client, path) {
  await clickButton(client, "手动路径");
  await client.waitFor(
    "manual path form",
    `Boolean(document.querySelector(".manual-path-form input"))`
  );
  await setInputValue(
    client,
    ".manual-path-form input",
    path
  );
  await clickButton(client, "扫描并添加", ".manual-path-form");
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
      String(candidate.textContent).includes("local & unicode 测试")
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
  const before = new Set(
    (await getOperations(client))
      .filter((operation) => operation.kind === kind)
      .map((operation) => operation.id)
  );
  await trigger();
  const operation = await waitForNewOperation(
    client,
    kind,
    before,
    new Set(["succeeded", "failed", "cancelled"])
  );
  return operation;
}

async function runConfirmedCommand(
  client,
  kind,
  trigger,
  inspectDialog = async () => undefined
) {
  const before = new Set(
    (await getOperations(client))
      .filter((operation) => operation.kind === kind)
      .map((operation) => operation.id)
  );
  await trigger();
  await client.waitFor(
    `${kind} preflight dialog`,
    `Boolean(document.querySelector(".command-dialog"))`,
    20_000
  );
  await inspectDialog();
  await clickButton(client, "确认并执行", ".command-dialog");
  return waitForNewOperation(
    client,
    kind,
    before,
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
  while (Date.now() - startedAt < 40_000) {
    const operation = (await getOperations(client)).find(
      (candidate) =>
        candidate.kind === kind &&
        !previousIds.has(candidate.id)
    );
    if (operation && desiredStates.has(operation.state)) {
      return operation;
    }
    if (
      operation &&
      ["failed", "cancelled"].includes(operation.state) &&
      !desiredStates.has(operation.state)
    ) {
      throw new Error(operation.message);
    }
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${kind} operation.`);
}

async function waitForOperationState(
  client,
  operationId,
  desiredStates
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 40_000) {
    const operation = (await getOperations(client)).find(
      (candidate) => candidate.id === operationId
    );
    if (operation && desiredStates.has(operation.state)) {
      return operation;
    }
    if (
      operation &&
      operation.state === "failed" &&
      !desiredStates.has("failed")
    ) {
      throw new Error(operation.message);
    }
    await delay(150);
  }
  throw new Error(
    `Timed out waiting for operation ${operationId}.`
  );
}

async function waitForBranchRow(client, branch) {
  await client.waitFor(
    `branch row ${branch}`,
    `(() => {
      const normalize = (value) =>
        String(value ?? "").replace(/\\s+/g, " ").trim();
      return [...document.querySelectorAll(".branches-row")]
        .some((row) =>
          normalize(row.querySelector("strong")?.textContent) ===
          ${JSON.stringify(branch)}
        );
    })()`
  );
}

async function clickBranchAction(client, branch, action) {
  const clicked = await client.evaluate(`(() => {
    const normalize = (value) =>
      String(value ?? "").replace(/\\s+/g, " ").trim();
    const row = [...document.querySelectorAll(".branches-row")]
      .find((candidate) =>
        normalize(candidate.querySelector("strong")?.textContent) ===
        ${JSON.stringify(branch)}
      );
    const button = row && [...row.querySelectorAll("button")]
      .find((candidate) =>
        normalize(candidate.textContent) === ${JSON.stringify(action)}
      );
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  assert(
    clicked,
    `Unable to click ${action} for branch ${branch}.`
  );
}

async function clickOperationCancel(client, operationId) {
  const clicked = await client.evaluate(`(() => {
    const normalize = (value) =>
      String(value ?? "").replace(/\\s+/g, " ").trim();
    const rows = [...document.querySelectorAll(".operation-row")];
    const row = rows.find((candidate) =>
      normalize(candidate.textContent).includes("推送分支")
    );
    const button = row && [...row.querySelectorAll("button")]
      .find((candidate) => normalize(candidate.textContent) === "取消");
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  assert(
    clicked,
    `Unable to cancel operation ${operationId}.`
  );
}

async function clickButton(client, label, rootSelector = "body") {
  const clicked = await client.evaluate(`(() => {
    const normalize = (value) =>
      String(value ?? "").replace(/\\s+/g, " ").trim();
    const root = document.querySelector(
      ${JSON.stringify(rootSelector)}
    );
    const button = root && [...root.querySelectorAll("button")]
      .find((candidate) =>
        normalize(candidate.textContent) === ${JSON.stringify(label)}
      );
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
        Boolean(active.closest(".command-dialog")) &&
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

async function selectValue(client, selector, value) {
  const changed = await client.evaluate(`(() => {
    const select = document.querySelector(
      ${JSON.stringify(selector)}
    );
    if (!(select instanceof HTMLSelectElement)) return false;
    const option = [...select.options].find(
      (candidate) => candidate.value === ${JSON.stringify(value)}
    );
    if (!option || option.disabled || select.disabled) return false;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value"
    )?.set;
    setter?.call(select, ${JSON.stringify(value)});
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  assert(changed, `Unable to select ${value} in ${selector}.`);
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

async function waitForPageTarget(debugPort, child) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    if (child.exitCode !== null) {
      throw new Error(
        `Electron exited before exposing CDP (${child.exitCode}).`
      );
    }
    try {
      const targets = await fetch(
        `http://127.0.0.1:${debugPort}/json/list`
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
      const portNumber =
        address && typeof address === "object"
          ? address.port
          : undefined;
      server.close((error) => {
        if (error || !portNumber) {
          rejectPromise(
            error ?? new Error("Unable to reserve a CDP port.")
          );
        } else {
          resolvePromise(portNumber);
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
    !basename(path).startsWith("gitnest-e2e-m2-sync-")
  ) {
    throw new Error("Refusing to remove an unexpected fixture path.");
  }
  await rm(path, {
    recursive: true,
    force: true,
    maxRetries: 4,
    retryDelay: 150
  });
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

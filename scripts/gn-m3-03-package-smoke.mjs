import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
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
  isAbsolute,
  join,
  relative,
  resolve
} from "node:path";
import { fileURLToPath } from "node:url";

import { extractFile } from "@electron/asar";

import { CdpClient } from "./electron-cdp-client.mjs";
import { findElectronDistribution } from "./windows-release-support.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const desktopDirectory = join(
  projectRoot,
  "apps",
  "desktop"
);
const releaseDirectory = join(projectRoot, "release");
const fixtureParentDirectory = join(projectRoot, "temp");
const screenshotDirectory = join(
  projectRoot,
  "test-results"
);
const packageMetadata = JSON.parse(
  await readFile(
    join(desktopDirectory, "package.json"),
    "utf8"
  )
);
const version = packageMetadata.version;
const legacyVersion = "0.9.0";
const setupName = `GitNest-Setup-${version}-x64.exe`;
const portableName =
  `GitNest-Portable-${version}-x64.exe`;
const setupPath = join(releaseDirectory, setupName);
const portablePath = join(
  releaseDirectory,
  portableName
);
const unpackedExecutable = join(
  releaseDirectory,
  "win-unpacked",
  "GitNest.exe"
);
const uninstallRegistryRoot =
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall";
const readOnlySamples = [
  {
    path: "D:\\code\\sc\\sc_code\\.git\\index",
    length: 10_300,
    sha256:
      "F91FC883F3E8DBEEFDB92DA0B4F3B41FC42AE1E9992A08975D891AC26C2D5647"
  },
  {
    path:
      "D:\\code\\sc\\sc_code\\web\\scportal\\.git\\index",
    length: 39_425,
    sha256:
      "EE1F8E90B66DBB823B1AEB66A80EC610C37B47CEE5E398A03D466BC9B4303382"
  }
];
const activeLaunches = new Set();
let fixtureRoot;
let installDirectory;
let installed = false;
let knownFolders;
let hostShortcutsWereClean = false;

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error(
    "GN-M3-03 package smoke requires Windows x64."
  );
}

try {
  const manifest = await verifyReleaseArtifacts();
  const sampleBefore = await readSampleState();
  knownFolders = await readKnownFolders();
  await assertHostIsClean(knownFolders);
  hostShortcutsWereClean = true;

  await mkdir(fixtureParentDirectory, {
    recursive: true
  });
  fixtureRoot = await mkdtemp(
    join(
      fixtureParentDirectory,
      "gitnest-e2e-m3-delivery-"
    )
  );
  installDirectory = join(
    fixtureRoot,
    "installed-GitNest-测试"
  );
  const installedUserData = join(
    fixtureRoot,
    "installed-user-data"
  );
  const sentinelPath = join(
    installedUserData,
    "upgrade-retention-sentinel.txt"
  );

  await mkdir(screenshotDirectory, {
    recursive: true
  });
  const launchEvidence = [];
  launchEvidence.push(
    await runLaunchScenario({
      label: "unpacked",
      executable: unpackedExecutable,
      userData: join(
        fixtureRoot,
        "unpacked-user-data"
      ),
      expectedVersion: version
    })
  );
  launchEvidence.push(
    await runLaunchScenario({
      label: "portable",
      executable: portablePath,
      userData: join(
        fixtureRoot,
        "portable-user-data"
      ),
      expectedVersion: version,
      allowLauncherExit: true
    })
  );

  const legacyInstaller =
    await buildLegacyInstaller();
  await installApplication(
    legacyInstaller,
    legacyVersion
  );
  installed = true;
  assert(
    !(await pathExists(
      knownFolders.desktopShortcut
    )) &&
      !(await pathExists(
        knownFolders.startMenuShortcut
      )),
    "Legacy fixture unexpectedly created a shortcut."
  );
  launchEvidence.push(
    await runLaunchScenario({
      label: "installed-legacy",
      executable: join(
        installDirectory,
        "GitNest.exe"
      ),
      userData: installedUserData,
      expectedVersion: legacyVersion
    })
  );

  await writeFile(
    sentinelPath,
    "GitNest upgrade retention sentinel\n",
    "utf8"
  );
  await installApplication(setupPath, version);
  await assertRegistryVersion(version);
  await assertFile(
    knownFolders.desktopShortcut,
    "Official installer did not create the desktop shortcut."
  );
  await assertFile(
    knownFolders.startMenuShortcut,
    "Official installer did not create the Start Menu shortcut."
  );
  assertEqual(
    await readFile(sentinelPath, "utf8"),
    "GitNest upgrade retention sentinel\n",
    "Cover upgrade changed retained user data."
  );

  launchEvidence.push(
    await runLaunchScenario({
      label: "installed-current",
      executable: join(
        installDirectory,
        "GitNest.exe"
      ),
      userData: installedUserData,
      expectedVersion: version,
      screenshotPath: join(
        screenshotDirectory,
        "gn-m3-03-packaged-startup.png"
      )
    })
  );

  const uninstaller = await findUninstaller();
  await runProcess(uninstaller, ["/S"], {
    timeoutMs: 180_000
  });
  await waitForPath(
    installDirectory,
    false,
    60_000,
    "installed application removal"
  );
  installed = false;
  assertEqual(
    await readFile(sentinelPath, "utf8"),
    "GitNest upgrade retention sentinel\n",
    "Uninstall removed retained user data."
  );
  await waitForNoUninstallEntries();
  await waitForPath(
    knownFolders.desktopShortcut,
    false,
    30_000,
    "desktop shortcut removal"
  );
  await waitForPath(
    knownFolders.startMenuShortcut,
    false,
    30_000,
    "Start Menu shortcut removal"
  );
  await assertNoProductProcesses();

  const sampleAfter = await readSampleState();
  assertSampleStateEqual(sampleBefore, sampleAfter);

  console.log(
    JSON.stringify(
      {
        ok: true,
        product: manifest.product,
        version,
        artifacts: {
          setup: setupName,
          portable: portableName
        },
        launchEvidence,
        upgrade: `${legacyVersion} -> ${version}`,
        uninstallRetainedUserData: true,
        shortcutsRemoved: true,
        readOnlySampleUnchanged: true,
        screenshot:
          "gn-m3-03-packaged-startup.png"
      },
      null,
      2
    )
  );
} finally {
  for (const launch of [...activeLaunches]) {
    await closeApplication(launch).catch(() => undefined);
  }
  if (
    installed &&
    installDirectory &&
    (await pathExists(installDirectory))
  ) {
    const uninstaller = await findUninstaller().catch(
      () => undefined
    );
    if (uninstaller) {
      await runProcess(uninstaller, ["/S"], {
        timeoutMs: 180_000
      }).catch(() => undefined);
    }
  }
  await assertNoProductProcesses().catch(() => undefined);
  if (hostShortcutsWereClean && knownFolders) {
    await rm(knownFolders.desktopShortcut, {
      force: true
    }).catch(() => undefined);
    await rm(knownFolders.startMenuShortcut, {
      force: true
    }).catch(() => undefined);
  }
  if (
    fixtureRoot &&
    process.env.GITNEST_KEEP_E2E !== "1"
  ) {
    await removeFixtureRoot(fixtureRoot).catch((error) => {
      console.warn(
        `Unable to remove temporary fixture ${fixtureRoot}: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`
      );
    });
  } else if (fixtureRoot) {
    console.log(
      `Temporary fixture retained at ${fixtureRoot}`
    );
  }
}

async function verifyReleaseArtifacts() {
  const manifest = JSON.parse(
    await readFile(
      join(releaseDirectory, "release-manifest.json"),
      "utf8"
    )
  );
  assertEqual(
    manifest.schemaVersion,
    1,
    "Release manifest schema mismatch."
  );
  assertEqual(
    manifest.product,
    "GitNest",
    "Release product mismatch."
  );
  assertEqual(
    manifest.version,
    version,
    "Release version mismatch."
  );
  assertEqual(
    manifest.platform,
    "win32",
    "Release platform mismatch."
  );
  assertEqual(
    manifest.architecture,
    "x64",
    "Release architecture mismatch."
  );
  assert(
    manifest.autoUpdateEnabled === true,
    "Release does not enable automatic updates."
  );
  assert(
    manifest.packageAudit?.asar === true &&
      manifest.packageAudit?.sourceMaps === false &&
      manifest.packageAudit?.testContent === false &&
      manifest.packageAudit?.developmentServer ===
        false &&
      manifest.packageAudit?.autoUpdateMetadata ===
        false,
    "Release manifest package audit is incomplete."
  );

  const sums = parseChecksumFile(
    await readFile(
      join(releaseDirectory, "SHA256SUMS.txt"),
      "utf8"
    )
  );
  const requiredRecords = new Map(
    manifest.artifacts.map((artifact) => [
      artifact.name,
      artifact
    ])
  );
  for (const name of [
    setupName,
    portableName,
    "win-unpacked/GitNest.exe"
  ]) {
    const record = requiredRecords.get(name);
    assert(record, `Manifest is missing ${name}.`);
    const artifactPath = join(
      releaseDirectory,
      ...name.split("/")
    );
    await assertFile(
      artifactPath,
      `Release artifact is missing: ${name}`
    );
    const fileInfo = await stat(artifactPath);
    assertEqual(
      fileInfo.size,
      record.size,
      `Release size mismatch for ${name}.`
    );
    const actualHash = await sha256(artifactPath);
    assertEqual(
      actualHash,
      record.sha256,
      `Manifest checksum mismatch for ${name}.`
    );
    assertEqual(
      actualHash,
      sums.get(name),
      `SHA256SUMS mismatch for ${name}.`
    );
  }
  const expectedSignatureStatus =
    manifest.signing?.configured
      ? "Valid"
      : "NotSigned";
  assert(
    manifest.signing?.observed?.every(
      (signature) =>
        signature.status === expectedSignatureStatus
    ),
    "Release signature observations do not match the configured signing state."
  );
  const updateManifest = JSON.parse(
    await readFile(
      join(releaseDirectory, "latest.json"),
      "utf8"
    )
  );
  assertEqual(
    updateManifest.schemaVersion,
    1,
    "Update manifest schema mismatch."
  );
  assertEqual(
    updateManifest.product,
    "GitNest",
    "Update manifest product mismatch."
  );
  assertEqual(
    updateManifest.version,
    version,
    "Update manifest version mismatch."
  );
  assertEqual(
    updateManifest.tag,
    `v${version}`,
    "Update manifest tag mismatch."
  );
  assertEqual(
    updateManifest.asset?.name,
    setupName,
    "Update manifest installer mismatch."
  );
  assertEqual(
    updateManifest.asset?.sizeBytes,
    requiredRecords.get(setupName)?.size,
    "Update manifest installer size mismatch."
  );
  assertEqual(
    String(updateManifest.asset?.sha256).toUpperCase(),
    requiredRecords.get(setupName)?.sha256,
    "Update manifest installer checksum mismatch."
  );
  return manifest;
}

function parseChecksumFile(contents) {
  const records = new Map();
  for (const line of contents
    .split(/\r?\n/)
    .filter(Boolean)) {
    const match = /^([A-F0-9]{64}) {2}(.+)$/.exec(
      line
    );
    assert(match, `Invalid checksum line: ${line}`);
    records.set(match[2], match[1]);
  }
  return records;
}

async function readSampleState() {
  const snapshots = [];
  for (const sample of readOnlySamples) {
    const info = await stat(sample.path);
    const hash = await sha256(sample.path);
    assertEqual(
      info.size,
      sample.length,
      `Read-only sample length changed before delivery smoke: ${sample.path}`
    );
    assertEqual(
      hash,
      sample.sha256,
      `Read-only sample checksum changed before delivery smoke: ${sample.path}`
    );
    snapshots.push({
      path: sample.path,
      length: info.size,
      modifiedAt: info.mtimeMs,
      sha256: hash
    });
  }
  return snapshots;
}

function assertSampleStateEqual(before, after) {
  assertEqual(
    JSON.stringify(after),
    JSON.stringify(before),
    "Read-only repository samples changed during delivery smoke."
  );
}

async function readKnownFolders() {
  const command =
    "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); [pscustomobject]@{ desktop = [Environment]::GetFolderPath('Desktop'); programs = [Environment]::GetFolderPath('Programs') } | ConvertTo-Json -Compress";
  for (const executable of [
    "pwsh.exe",
    "powershell.exe"
  ]) {
    try {
      const result = await runProcess(
        executable,
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          command
        ],
        { timeoutMs: 30_000 }
      );
      const folders = JSON.parse(result.stdout.trim());
      if (
        isAbsolute(folders.desktop) &&
        isAbsolute(folders.programs)
      ) {
        return {
          desktopShortcut: join(
            folders.desktop,
            "GitNest.lnk"
          ),
          startMenuShortcut: join(
            folders.programs,
            "GitNest.lnk"
          )
        };
      }
    } catch {}
  }
  throw new Error(
    "Unable to resolve Windows shortcut folders."
  );
}

async function assertHostIsClean(folders) {
  await assertNoProductProcesses();
  const uninstallEntries =
    await findUninstallEntries();
  assert(
    uninstallEntries.length === 0,
    "An existing GitNest installation was found. Delivery smoke refuses to overwrite it."
  );
  assert(
    !(await pathExists(folders.desktopShortcut)),
    `An existing GitNest desktop shortcut was found: ${folders.desktopShortcut}`
  );
  assert(
    !(await pathExists(folders.startMenuShortcut)),
    `An existing GitNest Start Menu shortcut was found: ${folders.startMenuShortcut}`
  );
}

async function buildLegacyInstaller() {
  const outputDirectory = join(
    fixtureRoot,
    "legacy-installer"
  );
  const artifactName =
    `GitNest-Legacy-Setup-${legacyVersion}-x64.exe`;
  const electronDistribution =
    await findElectronDistribution({
      projectRoot,
      desktopDirectory
    });
  await runPnpm([
    "--filter",
    "@gitnest/desktop",
    "exec",
    "electron-builder",
    "--win",
    "nsis",
    "--x64",
    "--config",
    "electron-builder.yml",
    `--config.directories.output=${outputDirectory}`,
    `--config.extraMetadata.version=${legacyVersion}`,
    `--config.electronDist=${electronDistribution}`,
    "--config.compression=store",
    "--config.nsis.createDesktopShortcut=false",
    "--config.nsis.createStartMenuShortcut=false",
    `--config.nsis.artifactName=${artifactName}`
  ]);
  const installer = join(outputDirectory, artifactName);
  await assertFile(
    installer,
    "Legacy upgrade fixture installer was not generated."
  );
  const legacyMetadata = JSON.parse(
    extractFile(
      join(
        outputDirectory,
        "win-unpacked",
        "resources",
        "app.asar"
      ),
      "package.json"
    ).toString("utf8")
  );
  assertEqual(
    legacyMetadata.version,
    legacyVersion,
    "Legacy fixture package version mismatch."
  );
  return installer;
}

async function installApplication(
  installer,
  expectedVersion
) {
  await runProcess(
    installer,
    ["/S", `/D=${installDirectory}`],
    { timeoutMs: 180_000 }
  );
  await waitForPath(
    join(installDirectory, "GitNest.exe"),
    true,
    60_000,
    `GitNest ${expectedVersion} installation`
  );
  await assertRegistryVersion(expectedVersion);
}

async function assertRegistryVersion(
  expectedVersion
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    const entries = await findUninstallEntries();
    if (
      entries.some((entry) =>
        new RegExp(
          `DisplayVersion\\s+REG_SZ\\s+${escapeRegExp(
            expectedVersion
          )}`,
          "i"
        ).test(entry.contents)
      )
    ) {
      return;
    }
    await delay(250);
  }
  throw new Error(
    `GitNest ${expectedVersion} uninstall registry entry was not found.`
  );
}

async function waitForNoUninstallEntries() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    if ((await findUninstallEntries()).length === 0) {
      return;
    }
    await delay(250);
  }
  throw new Error(
    "GitNest uninstall registry entry remained after uninstall."
  );
}

async function findUninstallEntries() {
  const search = await runProcess(
    "reg.exe",
    [
      "query",
      uninstallRegistryRoot,
      "/s",
      "/f",
      "GitNest"
    ],
    {
      allowedExitCodes: [0, 1],
      timeoutMs: 30_000
    }
  );
  if (search.exitCode === 1) {
    return [];
  }
  const keys = [
    ...new Set(
      search.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(
          (line) =>
            line.startsWith("HKEY_") &&
            line
              .toLocaleLowerCase()
              .includes(
                "\\software\\microsoft\\windows\\currentversion\\uninstall\\"
              )
        )
    )
  ];
  return Promise.all(
    keys.map(async (key) => {
      const result = await runProcess(
        "reg.exe",
        ["query", key],
        { timeoutMs: 30_000 }
      );
      return {
        key,
        contents: result.stdout
      };
    })
  );
}

async function findUninstaller() {
  const entries = await readdir(installDirectory);
  const name = entries.find((entry) =>
    /^Uninstall .+\.exe$/i.test(entry)
  );
  assert(
    name,
    `No uninstaller found in ${installDirectory}.`
  );
  return join(installDirectory, name);
}

async function runLaunchScenario(options) {
  const launch = await launchApplication(options);
  try {
    const runtimeInfo = await launch.cdp.evaluate(
      "(async () => window.gitnest.system.getRuntimeInfo())()"
    );
    assertEqual(
      runtimeInfo.appVersion,
      options.expectedVersion,
      `${options.label} app version mismatch.`
    );
    assertEqual(
      runtimeInfo.platform,
      "win32",
      `${options.label} runtime platform mismatch.`
    );
    const security = await launch.cdp.evaluate(`({
      requireType: typeof require,
      processType: typeof process,
      bufferType: typeof Buffer,
      bridgeType: typeof window.gitnest,
      protocol: location.protocol
    })`);
    assertEqual(
      security.requireType,
      "undefined",
      `${options.label} exposed require to Renderer.`
    );
    assertEqual(
      security.processType,
      "undefined",
      `${options.label} exposed process to Renderer.`
    );
    assertEqual(
      security.bufferType,
      "undefined",
      `${options.label} exposed Buffer to Renderer.`
    );
    assertEqual(
      security.bridgeType,
      "object",
      `${options.label} did not expose the controlled bridge.`
    );
    assertEqual(
      security.protocol,
      "file:",
      `${options.label} did not load the packaged renderer.`
    );
    const workspaceState = await launch.cdp.evaluate(
      "(async () => window.gitnest.workspace.getState())()"
    );
    assert(
      workspaceState?.ok === true,
      `${options.label} Workspace state failed to load.`
    );
    assert(
      await launch.cdp.evaluate(
        "document.documentElement.scrollWidth <= window.innerWidth + 1"
      ),
      `${options.label} startup page has horizontal overflow.`
    );
    const versionDialog = await launch.cdp.evaluate(`(async () => {
      const waitForRender = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(resolve)
          )
        );
      const helpButton = document.querySelector(
        ".titlebar-help-menu > button"
      );
      helpButton?.click();
      await waitForRender();
      const versionItem = [...document.querySelectorAll(
        '[role="menuitem"]'
      )].find((element) =>
        element.textContent?.trim().startsWith("版本 v")
      );
      versionItem?.click();
      await waitForRender();
      const title = document.querySelector(
        "#version-dialog-title"
      )?.textContent?.trim() ?? "";
      const updateBridgeReady =
        typeof window.gitnest.update?.getState === "function" &&
        typeof window.gitnest.update?.check === "function";
      const closeButton = [...document.querySelectorAll(
        ".version-dialog button"
      )].find(
        (element) =>
          element.textContent?.trim() === "关闭"
      );
      closeButton?.click();
      return {
        title,
        updateBridgeReady,
        opened: Boolean(versionItem && title)
      };
    })()`);
    assert(
      versionDialog.opened,
      `${options.label} version dialog did not open from the Help menu.`
    );
    assertEqual(
      versionDialog.title,
      `版本 v${options.expectedVersion}`,
      `${options.label} version dialog title mismatch.`
    );
    assert(
      versionDialog.updateBridgeReady,
      `${options.label} update bridge is unavailable.`
    );
    if (options.screenshotPath) {
      await setWindowSize(launch.cdp, 1440, 900);
      await capture(
        launch.cdp,
        options.screenshotPath
      );
    }
    return {
      label: options.label,
      appVersion: runtimeInfo.appVersion,
      electronVersion:
        runtimeInfo.electronVersion,
      startupMs: launch.startupMs,
      rendererNodeGlobals: false,
      versionDialog: true
    };
  } finally {
    await closeApplication(launch);
  }
}

async function launchApplication({
  label,
  executable,
  userData,
  allowLauncherExit = false
}) {
  await assertFile(
    executable,
    `${label} executable is missing.`
  );
  await mkdir(userData, { recursive: true });
  const port = await reservePort();
  const startedAt = Date.now();
  const child = spawn(
    executable,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userData}`
    ],
    {
      cwd: dirname(executable),
      env: {
        ...process.env,
        ELECTRON_RENDERER_URL: "",
        GITNEST_DISABLE_UPDATE_CHECK: "1"
      },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  const logs = [];
  child.stdout.on("data", (chunk) => {
    logs.push(chunk.toString("utf8"));
  });
  child.stderr.on("data", (chunk) => {
    logs.push(chunk.toString("utf8"));
  });
  const launch = {
    label,
    child,
    port,
    logs,
    cdp: undefined,
    startupMs: undefined
  };
  activeLaunches.add(launch);
  try {
    const target = await waitForPageTarget(
      port,
      child,
      allowLauncherExit,
      logs
    );
    launch.cdp = await CdpClient.connect(
      target.webSocketDebuggerUrl
    );
    await launch.cdp.send("Page.enable");
    await launch.cdp.send("Runtime.enable");
    await launch.cdp.send("Log.enable");
    await launch.cdp.waitFor(
      `${label} GitNest renderer`,
      `Boolean(document.querySelector(".app-shell"))`,
      30_000
    );
    launch.startupMs = Date.now() - startedAt;
    return launch;
  } catch (error) {
    await closeApplication(launch).catch(
      () => undefined
    );
    throw error;
  }
}

async function closeApplication(launch) {
  if (!launch || !activeLaunches.has(launch)) {
    return;
  }
  try {
    await launch.cdp?.evaluate(
      "window.gitnest.window.close().catch(() => undefined)"
    );
  } catch {}
  launch.cdp?.close();
  const parentExited = await waitForExit(
    launch.child,
    15_000
  );
  if (!parentExited && launch.child.pid) {
    await terminateProcessTree(launch.child.pid);
  }
  let portClosed = await waitForPortClosed(
    launch.port,
    15_000
  );
  if (!portClosed) {
    for (const pid of await findPortProcessIds(
      launch.port
    )) {
      await terminateProcessTree(pid);
    }
    portClosed = await waitForPortClosed(
      launch.port,
      10_000
    );
  }
  activeLaunches.delete(launch);
  assert(
    portClosed,
    `${launch.label} CDP listener remained after close.`
  );
  assert(
    launch.logs.every(
      (entry) =>
        !/unhandled|uncaught|fatal error/i.test(entry)
    ),
    `${launch.label} emitted a fatal diagnostic: ${launch.logs.join(
      ""
    )}`
  );
  assert(
    (launch.cdp?.runtimeErrors.length ?? 0) === 0,
    `${launch.label} renderer errors: ${(
      launch.cdp?.runtimeErrors ?? []
    ).join("; ")}`
  );
}

async function waitForPageTarget(
  port,
  child,
  allowLauncherExit,
  logs
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 60_000) {
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
    if (
      !allowLauncherExit &&
      child.exitCode !== null
    ) {
      throw new Error(
        `Application exited before exposing CDP (${child.exitCode}): ${logs.join(
          ""
        )}`
      );
    }
    await delay(150);
  }
  throw new Error(
    `Timed out waiting for application CDP: ${logs.join(
      ""
    )}`
  );
}

async function waitForPortClosed(port, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await fetch(
        `http://127.0.0.1:${port}/json/version`
      );
    } catch {
      return true;
    }
    await delay(150);
  }
  return false;
}

async function findPortProcessIds(port) {
  const result = await runProcess(
    "netstat.exe",
    ["-ano", "-p", "tcp"],
    { timeoutMs: 30_000 }
  );
  const ids = new Set();
  for (const line of result.stdout.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (
      columns.length >= 4 &&
      columns[0].toUpperCase() === "TCP" &&
      columns[1].endsWith(`:${port}`)
    ) {
      const pid = Number(columns.at(-1));
      if (Number.isInteger(pid) && pid > 0) {
        ids.add(pid);
      }
    }
  }
  return [...ids];
}

async function assertNoProductProcesses() {
  const result = await runProcess(
    "tasklist.exe",
    ["/FO", "CSV", "/NH"],
    { timeoutMs: 30_000 }
  );
  const names = result.stdout
    .split(/\r?\n/)
    .map((line) => /^"([^"]+)"/.exec(line)?.[1])
    .filter(Boolean);
  const matching = names.filter((name) =>
    [
      "gitnest.exe",
      portableName.toLocaleLowerCase()
    ].includes(name.toLocaleLowerCase())
  );
  assert(
    matching.length === 0,
    `GitNest processes are already running: ${matching.join(
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
            error ??
              new Error(
                "Unable to reserve a CDP port."
              )
          );
        } else {
          resolvePromise(port);
        }
      });
    });
  });
}

async function setWindowSize(client, width, height) {
  await client.send(
    "Emulation.setDeviceMetricsOverride",
    {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: width,
      screenHeight: height
    }
  );
  await client.waitFor(
    `${width}x${height} viewport`,
    `window.innerWidth >= ${width - 2} &&
      window.innerWidth <= ${width + 2} &&
      window.innerHeight >= ${height - 2} &&
      window.innerHeight <= ${height + 2}`
  );
}

async function capture(client, path) {
  const result = await client.send(
    "Page.captureScreenshot",
    {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false
    }
  );
  await writeFile(
    path,
    Buffer.from(result.data, "base64")
  );
}

async function runPnpm(args) {
  const pnpmEntry = process.env.npm_execpath;
  if (!pnpmEntry) {
    throw new Error(
      "The package smoke must be started through pnpm so npm_execpath is available."
    );
  }
  await runProcess(
    process.execPath,
    [pnpmEntry, ...args],
    {
      timeoutMs: 600_000,
      echoOutput: true
    }
  );
}

function runProcess(
  executable,
  args,
  {
    allowedExitCodes = [0],
    cwd = projectRoot,
    echoOutput = false,
    environment = {},
    timeoutMs = 120_000
  } = {}
) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, {
      cwd,
      env: {
        ...process.env,
        ...environment
      },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    let finished = false;
    const finish = (action, value) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      action(value);
    };
    const timer = setTimeout(() => {
      void (async () => {
        if (child.pid) {
          await terminateProcessTree(child.pid);
        }
        finish(
          rejectPromise,
          new Error(
            `${basename(executable)} timed out after ${timeoutMs}ms.`
          )
        );
      })();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout.push(chunk);
      if (echoOutput) {
        process.stdout.write(chunk);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr.push(chunk);
      if (echoOutput) {
        process.stderr.write(chunk);
      }
    });
    child.once("error", (error) => {
      finish(rejectPromise, error);
    });
    child.once("close", (exitCode) => {
      const result = {
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      };
      if (allowedExitCodes.includes(exitCode)) {
        finish(resolvePromise, result);
      } else {
        finish(
          rejectPromise,
          new Error(
            `${basename(executable)} ${args.join(
              " "
            )} exited with ${String(
              exitCode
            )}: ${result.stderr || result.stdout}`
          )
        );
      }
    });
  });
}

async function terminateProcessTree(pid) {
  await new Promise((resolvePromise) => {
    const child = spawn(
      "taskkill.exe",
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

async function waitForPath(
  path,
  shouldExist,
  timeoutMs,
  label
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if ((await pathExists(path)) === shouldExist) {
      return;
    }
    await delay(200);
  }
  throw new Error(
    `Timed out waiting for ${label}: ${path}`
  );
}

async function assertFile(path, message) {
  const info = await stat(path).catch(() => undefined);
  assert(Boolean(info?.isFile()), message);
}

async function pathExists(path) {
  return Boolean(await stat(path).catch(() => undefined));
}

async function sha256(path) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", rejectPromise);
    stream.once("end", resolvePromise);
  });
  return hash.digest("hex").toUpperCase();
}

async function removeFixtureRoot(path) {
  const resolvedFixtureParent = resolve(
    fixtureParentDirectory
  );
  const resolvedFixture = resolve(path);
  const pathFromFixtureParent = relative(
    resolvedFixtureParent,
    resolvedFixture
  );
  if (
    dirname(resolvedFixture) !==
      resolvedFixtureParent ||
    !basename(resolvedFixture).startsWith(
      "gitnest-e2e-m3-delivery-"
    ) ||
    pathFromFixtureParent.startsWith("..") ||
    isAbsolute(pathFromFixtureParent)
  ) {
    throw new Error(
      "Refusing to remove an unexpected delivery fixture path."
    );
  }
  await rm(resolvedFixture, {
    recursive: true,
    force: true,
    maxRetries: 4,
    retryDelay: 200
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assert(value, message) {
  if (!value) {
    throw new Error(message);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      `${message} Expected ${JSON.stringify(
        expected
      )}, received ${JSON.stringify(actual)}.`
    );
  }
}

function delay(milliseconds) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds)
  );
}

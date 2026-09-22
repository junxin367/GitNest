import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  readFile,
  readdir,
  stat,
  writeFile
} from "node:fs/promises";
import {
  basename,
  delimiter,
  dirname,
  join,
  resolve,
  sep
} from "node:path";
import { fileURLToPath } from "node:url";

import {
  extractFile,
  listPackage
} from "@electron/asar";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const releaseDirectory = join(projectRoot, "release");
const desktopPackage = JSON.parse(
  await readFile(
    join(projectRoot, "apps", "desktop", "package.json"),
    "utf8"
  )
);
const version = desktopPackage.version;
const requiredArtifacts = [
  `GitNest-Setup-${version}-x64.exe`,
  `GitNest-Portable-${version}-x64.exe`
];
const unpackedExecutable = join(
  releaseDirectory,
  "win-unpacked",
  "GitNest.exe"
);
const asarPath = join(
  releaseDirectory,
  "win-unpacked",
  "resources",
  "app.asar"
);

for (const artifact of requiredArtifacts) {
  await assertFile(join(releaseDirectory, artifact));
}
await assertFile(unpackedExecutable);
await assertFile(asarPath);

const releaseEntries = await readdir(releaseDirectory);
assert(
  !releaseEntries.some((name) =>
    /^(?:latest|app-update|dev-app-update).*\.ya?ml$/i.test(
      name
    )
  ),
  "Release directory contains an auto-update manifest."
);
const allowedReleaseEntries = new Set([
  ...requiredArtifacts,
  "win-unpacked",
  "SHA256SUMS.txt",
  "release-manifest.json",
  "latest.json"
]);
const unexpectedReleaseEntries = releaseEntries.filter(
  (name) => !allowedReleaseEntries.has(name)
);
assert(
  unexpectedReleaseEntries.length === 0,
  `Release directory contains unexpected files: ${unexpectedReleaseEntries.join(
    ", "
  )}`
);
const resourceEntries = await readdir(
  join(releaseDirectory, "win-unpacked", "resources")
);
assert(
  !resourceEntries.some((name) =>
    /app-update\.ya?ml$/i.test(name)
  ),
  "Packaged resources contain auto-update configuration."
);
assert(
  !resourceEntries.includes("default_app.asar"),
  "Packaged resources retained Electron's default application."
);
const unpackedEntries = await readdir(
  join(releaseDirectory, "win-unpacked")
);
assert(
  !unpackedEntries.includes("version"),
  "Packaged application retained Electron's raw version marker."
);
assert(
  unpackedEntries.includes("LICENSE.electron.txt"),
  "Packaged application is missing the Electron license."
);

const asarEntries = listPackage(asarPath, {
  isPack: false
}).map((entry) =>
  entry.replace(/^[/\\]+/, "").replace(/\\/g, "/")
);
for (const entry of asarEntries) {
  assert(
    isAllowedAsarEntry(entry),
    `Unexpected file in app.asar: ${entry}`
  );
  assert(
    !/\.map$/i.test(entry),
    `Source map found in app.asar: ${entry}`
  );
  assert(
    !/(?:^|\/)(?:src|test-results|scripts|coverage)(?:\/|$)/i.test(
      entry
    ) &&
      !/\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(entry),
    `Development or test content found in app.asar: ${entry}`
  );
}

const packagedMetadata = JSON.parse(
  extractAsarFile("package.json").toString("utf8")
);
assertEqual(
  packagedMetadata.version,
  version,
  "Packaged application version mismatch."
);
assertEqual(
  packagedMetadata.main,
  "out/main/index.js",
  "Packaged Main entry mismatch."
);
assert(
  !packagedMetadata.dependencies ||
    Object.keys(packagedMetadata.dependencies).length === 0,
  "Packaged metadata retained runtime dependency declarations."
);

const textEntries = asarEntries.filter((entry) =>
  /\.(?:js|css|html|json)$/i.test(entry)
);
for (const entry of textEntries) {
  const contents = extractAsarFile(entry).toString(
    "utf8"
  );
  assert(
    !/sourceMappingURL=|remote-debugging-port|http:\/\/localhost:5173|__vitest|must-not-appear|secret-canary/i.test(
      contents
    ),
    `Forbidden development or secret marker found in ${entry}.`
  );
}
const rendererHtml = extractAsarFile(
  "out/renderer/index.html"
).toString("utf8");
assert(
  rendererHtml.includes(
    "Content-Security-Policy"
  ),
  "Packaged renderer CSP is missing."
);
for (const directive of [
  "default-src 'self'",
  "script-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'"
]) {
  assert(
    rendererHtml.includes(directive),
    `Packaged renderer CSP is missing required directive: ${directive}.`
  );
}
assert(
  !rendererHtml.includes("'unsafe-eval'") &&
    !rendererHtml.includes("script-src *") &&
    !rendererHtml.includes("connect-src *"),
  "Packaged renderer CSP contains an unsafe script or connection policy."
);

const signingConfigured = Boolean(
  process.env.WIN_CSC_LINK || process.env.CSC_LINK
);
const signatureTargets = [
  unpackedExecutable,
  ...requiredArtifacts
    .filter((name) => name.endsWith(".exe"))
    .map((name) => join(releaseDirectory, name))
];
const signatures = [];
for (const path of signatureTargets) {
  signatures.push({
    file: basename(path),
    status:
      process.platform === "win32"
        ? await readAuthenticodeStatus(path)
        : "not-checked"
  });
}
if (signingConfigured) {
  assert(
    signatures.every(
      (signature) => signature.status === "Valid"
    ),
    "A signing certificate was configured, but at least one executable is not validly signed."
  );
}

const artifactRecords = [];
for (const name of requiredArtifacts) {
  const path = join(releaseDirectory, name);
  artifactRecords.push({
    name,
    size: (await stat(path)).size,
    sha256: await sha256(path)
  });
}
artifactRecords.push({
  name: "win-unpacked/GitNest.exe",
  size: (await stat(unpackedExecutable)).size,
  sha256: await sha256(unpackedExecutable)
});

await writeFile(
  join(releaseDirectory, "SHA256SUMS.txt"),
  `${artifactRecords
    .map(
      (artifact) =>
        `${artifact.sha256}  ${artifact.name}`
    )
    .join("\n")}\n`,
  "utf8"
);
const manifest = {
  schemaVersion: 1,
  product: "GitNest",
  version,
  platform: "win32",
  architecture: "x64",
  generatedAt: new Date().toISOString(),
  autoUpdateEnabled: true,
  signing: {
    configured: signingConfigured,
    expectedStatus: signingConfigured
      ? "signed"
      : "unsigned",
    observed: signatures
  },
  packageAudit: {
    asar: true,
    sourceMaps: false,
    testContent: false,
    developmentServer: false,
    autoUpdateMetadata: false,
    asarEntries: asarEntries.length
  },
  artifacts: artifactRecords
};
await writeFile(
  join(releaseDirectory, "release-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8"
);

console.log(JSON.stringify(manifest, null, 2));

function isAllowedAsarEntry(entry) {
  return (
    entry === "package.json" ||
    entry === "out" ||
    entry === "out/main" ||
    entry === "out/main/index.js" ||
    /^out\/main\/code-analysis-process-entry-[A-Za-z0-9_-]+\.js$/.test(
      entry
    ) ||
    entry === "out/preload" ||
    entry === "out/preload/index.js" ||
    entry === "out/renderer" ||
    entry === "out/renderer/index.html" ||
    entry === "out/renderer/assets" ||
    entry.startsWith("out/renderer/assets/")
  );
}

function extractAsarFile(entry) {
  return extractFile(
    asarPath,
    entry.split("/").join(sep)
  );
}

async function readAuthenticodeStatus(path) {
  const command =
    "$signature = Get-AuthenticodeSignature -LiteralPath $env:GITNEST_SIGNATURE_PATH; [Console]::Out.Write($signature.Status.ToString())";
  const errors = [];
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
        {
          GITNEST_SIGNATURE_PATH: path,
          ...(executable === "powershell.exe"
            ? {
                PSModulePath:
                  windowsPowerShellModulePath()
              }
            : {})
        }
      );
      return result.stdout.trim() || "Unknown";
    } catch (error) {
      errors.push(
        `${executable}: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`
      );
    }
  }
  throw new Error(
    `Unable to inspect Authenticode signature.\n${errors.join(
      "\n"
    )}`
  );
}

function windowsPowerShellModulePath() {
  const systemRoot =
    process.env.SystemRoot || process.env.WINDIR;
  if (!systemRoot) {
    return process.env.PSModulePath;
  }
  const systemModules = join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "Modules"
  );
  const currentEntries = (
    process.env.PSModulePath || ""
  )
    .split(delimiter)
    .filter(Boolean);
  return [
    systemModules,
    ...currentEntries.filter(
      (entry) =>
        entry.toLocaleLowerCase() !==
        systemModules.toLocaleLowerCase()
    )
  ].join(delimiter);
}

function runProcess(
  executable,
  args,
  extraEnvironment = {}
) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, {
      cwd: projectRoot,
      env: {
        ...process.env,
        ...extraEnvironment
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
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      };
      if (exitCode === 0) {
        resolvePromise(result);
      } else {
        rejectPromise(
          new Error(
            `${executable} exited with ${String(
              exitCode
            )}: ${result.stderr}`
          )
        );
      }
    });
  });
}

async function assertFile(path) {
  const info = await stat(path).catch(() => undefined);
  assert(
    Boolean(info?.isFile()),
    `Required release file is missing: ${path}`
  );
}

async function sha256(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex")
    .toUpperCase();
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

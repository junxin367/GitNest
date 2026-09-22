import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  readFile,
  stat,
  writeFile
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  resolve
} from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const releaseDirectory = resolveArgument(
  readArgument("--release-dir") ??
    join(projectRoot, "release")
);
const desktopPackage = JSON.parse(
  await readFile(
    join(
      projectRoot,
      "apps",
      "desktop",
      "package.json"
    ),
    "utf8"
  )
);
const rootPackage = JSON.parse(
  await readFile(
    join(projectRoot, "package.json"),
    "utf8"
  )
);
const version = desktopPackage.version;
const tag =
  readArgument("--tag") ??
  process.env.GITNEST_RELEASE_TAG ??
  `v${version}`;
const expectedTag = `v${version}`;

assert(
  isStableVersion(version),
  `Desktop package version is not a stable semantic version: ${version}`
);
assertEqual(
  rootPackage.version,
  version,
  "Root and desktop package versions must match."
);
assertEqual(
  tag,
  expectedTag,
  "Release tag and desktop package version must match."
);

const releaseManifest = JSON.parse(
  await readFile(
    join(releaseDirectory, "release-manifest.json"),
    "utf8"
  )
);
assertEqual(
  releaseManifest.schemaVersion,
  1,
  "Release manifest schema mismatch."
);
assertEqual(
  releaseManifest.product,
  "GitNest",
  "Release manifest product mismatch."
);
assertEqual(
  releaseManifest.version,
  version,
  "Release manifest version mismatch."
);
assert(
  releaseManifest.autoUpdateEnabled === true,
  "Release manifest does not enable automatic updates."
);

const installerName =
  `GitNest-Setup-${version}-x64.exe`;
const installerRecord = releaseManifest.artifacts.find(
  (artifact) => artifact.name === installerName
);
assert(
  installerRecord,
  `Release manifest is missing ${installerName}.`
);
const installerPath = join(
  releaseDirectory,
  installerName
);
const installerInfo = await stat(installerPath);
const installerSha256 = await sha256(installerPath);
assertEqual(
  installerInfo.size,
  installerRecord.size,
  "Installer size does not match the release manifest."
);
assertEqual(
  installerSha256.toUpperCase(),
  String(installerRecord.sha256).toUpperCase(),
  "Installer SHA-256 does not match the release manifest."
);
assert(
  installerInfo.size > 0 &&
    installerInfo.size <= 512 * 1_024 * 1_024,
  "Installer size is outside the updater limit."
);

const notes = await readReleaseNotes(version, tag);
const publishedAt =
  process.env.GITNEST_RELEASE_PUBLISHED_AT ??
  new Date().toISOString();
assert(
  !Number.isNaN(Date.parse(publishedAt)),
  "Release publication timestamp is invalid."
);

const manifest = {
  schemaVersion: 1,
  product: "GitNest",
  version,
  tag,
  releaseUrl:
    `https://github.com/junxin367/GitNest/releases/tag/${tag}`,
  publishedAt,
  notes,
  asset: {
    kind: "nsis",
    platform: "win32",
    architecture: "x64",
    name: installerName,
    downloadUrl:
      `https://github.com/junxin367/GitNest/releases/download/${tag}/${installerName}`,
    sizeBytes: installerInfo.size,
    sha256: installerSha256.toLowerCase()
  }
};

validateGeneratedManifest(manifest);
await writeFile(
  join(releaseDirectory, "latest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8"
);
console.log(JSON.stringify(manifest, null, 2));

async function readReleaseNotes(currentVersion, currentTag) {
  const explicitPath = readArgument("--notes-file");
  const versionedPath = join(
    projectRoot,
    ".github",
    "release-notes",
    `${currentVersion}.md`
  );
  if (explicitPath) {
    return validateNotes(
      await readFile(resolveArgument(explicitPath), "utf8"),
      true
    );
  }
  const versionedNotes = await readFile(
    versionedPath,
    "utf8"
  ).catch((error) =>
    error?.code === "ENOENT"
      ? null
      : Promise.reject(error)
  );
  if (versionedNotes !== null) {
    return validateNotes(versionedNotes, true);
  }

  const tags = (
    await runGit([
      "tag",
      "--list",
      "v*",
      "--sort=-version:refname"
    ]).catch(() => "")
  )
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .filter(
      (candidate) =>
        candidate !== currentTag &&
        /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(
          candidate
        )
    );
  const previousTag = tags[0];
  const range = previousTag
    ? `${previousTag}..HEAD`
    : "HEAD";
  const generated = await runGit([
    "log",
    range,
    "--max-count=50",
    "--pretty=format:- %s"
  ]).catch(() => "");
  return validateNotes(generated, false);
}

function validateNotes(value, strict) {
  const normalized = value.trim();
  if (normalized.length <= 32 * 1_024) {
    return normalized;
  }
  if (strict) {
    throw new Error(
      "Release notes exceed the 32 KiB updater limit."
    );
  }
  return `${normalized.slice(0, 32 * 1_024 - 32)}\n\n…更多内容请查看 Release 页面。`;
}

function validateGeneratedManifest(manifest) {
  assertEqual(
    manifest.schemaVersion,
    1,
    "Update manifest schema mismatch."
  );
  assertEqual(
    manifest.product,
    "GitNest",
    "Update manifest product mismatch."
  );
  assert(
    isStableVersion(manifest.version),
    "Update manifest version is invalid."
  );
  assertEqual(
    manifest.tag,
    `v${manifest.version}`,
    "Update manifest tag mismatch."
  );
  assert(
    /^[a-f0-9]{64}$/.test(manifest.asset.sha256),
    "Update manifest SHA-256 is invalid."
  );
  assert(
    manifest.asset.name ===
      `GitNest-Setup-${manifest.version}-x64.exe`,
    "Update manifest installer name mismatch."
  );
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function runGit(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("git", args, {
      cwd: projectRoot,
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
      if (exitCode === 0) {
        resolvePromise(
          Buffer.concat(stdout).toString("utf8")
        );
      } else {
        rejectPromise(
          new Error(
            Buffer.concat(stderr).toString("utf8")
          )
        );
      }
    });
  });
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}.`);
  }
  return value;
}

function resolveArgument(path) {
  return isAbsolute(path)
    ? resolve(path)
    : resolve(projectRoot, path);
}

function isStableVersion(version) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(
    version
  );
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

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const tag =
  process.argv[2] ?? process.env.GITNEST_RELEASE_TAG;

if (
  !tag ||
  !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(
    tag
  )
) {
  throw new Error(
    `Release tag must use vX.Y.Z: ${String(tag)}`
  );
}

const expectedVersion = tag.slice(1);
for (const path of [
  join(projectRoot, "package.json"),
  join(projectRoot, "apps", "desktop", "package.json")
]) {
  const metadata = JSON.parse(await readFile(path, "utf8"));
  if (metadata.version !== expectedVersion) {
    throw new Error(
      `${path} has version ${String(metadata.version)}, expected ${expectedVersion}.`
    );
  }
}

if (process.env.GITHUB_ACTIONS === "true") {
  const tagCommit = runGit([
    "rev-parse",
    `${tag}^{commit}`
  ]);
  const headCommit = runGit(["rev-parse", "HEAD"]);
  if (tagCommit !== headCommit) {
    throw new Error(
      `Checked out commit ${headCommit} does not match ${tag} (${tagCommit}).`
    );
  }
}

console.log(
  `Release version validated: ${tag}`
);

function runGit(args) {
  return execFileSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true
  }).trim();
}

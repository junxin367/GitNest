import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import {
  dirname,
  join,
  relative,
  resolve
} from "node:path";
import { fileURLToPath } from "node:url";

import { findElectronDistribution } from "./windows-release-support.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const desktopDirectory = join(projectRoot, "apps", "desktop");
const releaseDirectory = resolve(projectRoot, "release");
const relativeRelease = relative(
  projectRoot,
  releaseDirectory
);

await import("./generate-app-icon.mjs");

if (
  relativeRelease !== "release" ||
  relativeRelease.startsWith("..")
) {
  throw new Error(
    `Refusing to clean unexpected release path: ${releaseDirectory}`
  );
}

await rm(releaseDirectory, {
  recursive: true,
  force: true,
  maxRetries: 4,
  retryDelay: 150
});

await runPnpm(
  ["--filter", "@gitnest/desktop", "build"],
  {
    GITNEST_RELEASE_BUILD: "1"
  }
);
const electronDistribution =
  await findElectronDistribution({
    projectRoot,
    desktopDirectory
  });
console.log(
  `Using verified Electron distribution: ${electronDistribution}`
);
await runPnpm([
  "--filter",
  "@gitnest/desktop",
  "exec",
  "electron-builder",
  "--win",
  "--x64",
  "--config",
  "electron-builder.yml",
  `--config.electronDist=${electronDistribution}`
]);
await rm(
  join(releaseDirectory, "builder-effective-config.yaml"),
  {
    force: true
  }
);
await rm(join(releaseDirectory, "builder-debug.yml"), {
  force: true
});
await rm(join(releaseDirectory, ".icon-ico"), {
  recursive: true,
  force: true
});
await import("./audit-windows-release.mjs");
await import("./generate-update-manifest.mjs");

function runPnpm(args, extraEnvironment = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const pnpmEntry = process.env.npm_execpath;
    if (!pnpmEntry) {
      rejectPromise(
        new Error(
          "The release build must be started through pnpm so npm_execpath is available."
        )
      );
      return;
    }
    const child = spawn(process.execPath, [pnpmEntry, ...args], {
      cwd: projectRoot,
      env: {
        ...process.env,
        ...extraEnvironment
      },
      shell: false,
      windowsHide: true,
      stdio: "inherit"
    });
    child.once("error", rejectPromise);
    child.once("close", (exitCode) => {
      if (exitCode === 0) {
        resolvePromise();
      } else {
        rejectPromise(
          new Error(
            `pnpm ${args.join(" ")} exited with ${String(
              exitCode
            )}.`
          )
        );
      }
    });
  });
}

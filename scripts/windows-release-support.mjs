import {
  open,
  readFile,
  readdir,
  realpath,
  stat
} from "node:fs/promises";
import {
  isAbsolute,
  join,
  relative,
  sep
} from "node:path";

export async function findElectronDistribution({
  projectRoot,
  desktopDirectory
}) {
  const nodeModulesDirectory = join(
    projectRoot,
    "node_modules"
  );
  const electronPackage = JSON.parse(
    await readFile(
      join(
        desktopDirectory,
        "node_modules",
        "electron",
        "package.json"
      ),
      "utf8"
    )
  );
  const expectedVersion = electronPackage.version;
  if (
    typeof expectedVersion !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(expectedVersion)
  ) {
    throw new Error(
      "The installed Electron package has an invalid version."
    );
  }

  const candidates = [
    join(
      desktopDirectory,
      "node_modules",
      "electron",
      "dist"
    )
  ];
  const pnpmDirectory = join(
    nodeModulesDirectory,
    ".pnpm"
  );
  const entries = await readdir(pnpmDirectory, {
    withFileTypes: true
  });
  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      (entry.name === `electron@${expectedVersion}` ||
        entry.name.startsWith(
          `electron@${expectedVersion}_`
        ))
    ) {
      candidates.push(
        join(
          pnpmDirectory,
          entry.name,
          "node_modules",
          "electron",
          "dist"
        )
      );
    }
  }

  const visited = new Set();
  for (const candidate of candidates) {
    const resolvedCandidate = await realpath(
      candidate
    ).catch(() => undefined);
    if (
      !resolvedCandidate ||
      visited.has(resolvedCandidate)
    ) {
      continue;
    }
    visited.add(resolvedCandidate);
    assertPathWithinNodeModules(
      resolvedCandidate,
      nodeModulesDirectory
    );
    if (
      await isValidElectronDistribution(
        resolvedCandidate,
        expectedVersion
      )
    ) {
      return resolvedCandidate;
    }
  }

  throw new Error(
    `No complete Electron ${expectedVersion} x64 distribution was found under ${nodeModulesDirectory}. Run the approved Electron install script before packaging.`
  );
}

async function isValidElectronDistribution(
  candidate,
  expectedVersion
) {
  const candidateInfo = await stat(candidate).catch(
    () => undefined
  );
  if (!candidateInfo?.isDirectory()) {
    return false;
  }
  const version = await readFile(
    join(candidate, "version"),
    "utf8"
  )
    .then((value) => value.trim().replace(/^v/, ""))
    .catch(() => undefined);
  if (version !== expectedVersion) {
    return false;
  }
  for (const requiredFile of [
    "electron.exe",
    join("resources", "default_app.asar"),
    join("locales", "en-US.pak")
  ]) {
    const fileInfo = await stat(
      join(candidate, requiredFile)
    ).catch(() => undefined);
    if (!fileInfo?.isFile()) {
      return false;
    }
  }
  return (
    (await readPortableExecutableMachine(
      join(candidate, "electron.exe")
    )) === 0x8664
  );
}

async function readPortableExecutableMachine(path) {
  const file = await open(path, "r");
  try {
    const dosHeader = Buffer.alloc(64);
    const dosRead = await file.read(
      dosHeader,
      0,
      dosHeader.length,
      0
    );
    if (
      dosRead.bytesRead !== dosHeader.length ||
      dosHeader.toString("ascii", 0, 2) !== "MZ"
    ) {
      return undefined;
    }
    const peOffset = dosHeader.readUInt32LE(0x3c);
    const peHeader = Buffer.alloc(6);
    const peRead = await file.read(
      peHeader,
      0,
      peHeader.length,
      peOffset
    );
    if (
      peRead.bytesRead !== peHeader.length ||
      peHeader.toString("ascii", 0, 4) !== "PE\u0000\u0000"
    ) {
      return undefined;
    }
    return peHeader.readUInt16LE(4);
  } finally {
    await file.close();
  }
}

function assertPathWithinNodeModules(
  path,
  nodeModulesDirectory
) {
  const pathFromNodeModules = relative(
    nodeModulesDirectory,
    path
  );
  if (
    pathFromNodeModules === "" ||
    pathFromNodeModules === ".." ||
    pathFromNodeModules.startsWith(`..${sep}`) ||
    isAbsolute(pathFromNodeModules)
  ) {
    throw new Error(
      `Refusing to use Electron distribution outside node_modules: ${path}`
    );
  }
}

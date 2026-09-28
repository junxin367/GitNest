const {
  access,
  mkdir,
  writeFile
} = require("node:fs/promises");
const {
  join,
  resolve
} = require("node:path");

const { app } = require("electron");

const supportedKinds = new Set([
  "vscode",
  "cursor",
  "intellij-idea",
  "sublime-text",
  "file-explorer",
  "terminal",
  "git-bash"
]);
const projectRoot = resolve(__dirname, "..");
const outputDirectory = join(
  projectRoot,
  "prototypes",
  "workspace-shell",
  "assets",
  "open-in"
);
void main();

async function main() {
  const iconSources = parseIconSources(process.argv.slice(2));
  if (iconSources.length === 0) {
    throw new Error(
      "Provide one or more icon sources as <kind>=<executable-path>."
    );
  }

  await app.whenReady();

  try {
    await mkdir(outputDirectory, { recursive: true });
    for (const [kind, executablePath] of iconSources) {
      await access(executablePath);
      const icon = await app.getFileIcon(executablePath, {
        size: "normal"
      });
      if (icon.isEmpty()) {
        throw new Error(
          `Windows returned an empty icon for ${kind}.`
        );
      }
      const outputPath = join(outputDirectory, `${kind}.png`);
      await writeFile(outputPath, icon.toPNG());
      console.log(outputPath);
    }
  } finally {
    app.quit();
  }
}

function parseIconSources(argumentsList) {
  return argumentsList.map((argument) => {
    const separatorIndex = argument.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error(
        `Invalid icon source "${argument}". Expected <kind>=<path>.`
      );
    }
    const kind = argument.slice(0, separatorIndex);
    const executablePath = argument.slice(separatorIndex + 1);
    if (!supportedKinds.has(kind)) {
      throw new Error(`Unsupported Open in application kind "${kind}".`);
    }
    if (!executablePath) {
      throw new Error(`Missing executable path for "${kind}".`);
    }
    return [kind, executablePath];
  });
}

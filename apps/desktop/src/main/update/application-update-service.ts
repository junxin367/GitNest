import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  open,
  readdir,
  rename,
  stat,
  unlink
} from "node:fs/promises";
import { basename, join } from "node:path";

import {
  GITNEST_PROJECT_URL,
  type ApplicationUpdateDistributionDto,
  type ApplicationUpdateStateDto
} from "@gitnest/contracts";
import { AtomicJsonStore } from "@gitnest/persistence-json";

const UPDATE_MANIFEST_URL =
  "https://github.com/junxin367/GitNest/releases/latest/download/latest.json";
const RELEASES_URL =
  `${GITNEST_PROJECT_URL}/releases`;
const RELEASE_DOWNLOAD_ROOT =
  "https://github.com/junxin367/GitNest/releases/download";
const MAX_MANIFEST_BYTES = 1_024 * 1_024;
const MAX_RELEASE_NOTES_LENGTH = 32 * 1_024;
const MAX_INSTALLER_BYTES = 512 * 1_024 * 1_024;
const MAX_REMEMBERED_VERSIONS = 20;
const DOWNLOAD_RETENTION_MS = 14 * 24 * 60 * 60 * 1_000;
const DOWNLOAD_CACHE_BYTES = 512 * 1_024 * 1_024;
const MANIFEST_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const STABLE_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

interface UpdateManifest {
  schemaVersion: 1;
  product: "GitNest";
  version: string;
  tag: string;
  releaseUrl: string;
  publishedAt: string;
  notes: string;
  asset: {
    kind: "nsis";
    platform: "win32";
    architecture: "x64";
    name: string;
    downloadUrl: string;
    sizeBytes: number;
    sha256: string;
  };
}

interface PersistedUpdateState {
  schemaVersion: 1;
  remindedVersions: string[];
  lastSuccessfulCheckAt: string | null;
}

interface ApplicationUpdateDiagnostic {
  level: "info" | "warning";
  name: string;
  context: Readonly<Record<string, unknown>>;
}

export interface ApplicationUpdateServiceOptions {
  currentVersion: string;
  distribution: ApplicationUpdateDistributionDto;
  platform: NodeJS.Platform;
  architecture: string;
  stateFilePath: string;
  downloadDirectory: string;
  fetch?: typeof fetch;
  now?: () => Date;
  launchInstaller(path: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  requestQuit(): void;
  onDiagnostic?(
    diagnostic: ApplicationUpdateDiagnostic
  ): void;
}

export class ApplicationUpdateService {
  readonly #currentVersion: string;
  readonly #distribution: ApplicationUpdateDistributionDto;
  readonly #platform: NodeJS.Platform;
  readonly #architecture: string;
  readonly #downloadDirectory: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;
  readonly #launchInstaller: (path: string) => Promise<void>;
  readonly #openExternal: (url: string) => Promise<void>;
  readonly #requestQuit: () => void;
  readonly #onDiagnostic:
    | ((
        diagnostic: ApplicationUpdateDiagnostic
      ) => void)
    | undefined;
  readonly #store: AtomicJsonStore;
  readonly #listeners = new Set<
    (state: ApplicationUpdateStateDto) => void
  >();
  readonly #ready: Promise<void>;
  #state: ApplicationUpdateStateDto;
  #persisted: PersistedUpdateState = {
    schemaVersion: 1,
    remindedVersions: [],
    lastSuccessfulCheckAt: null
  };
  #manifest: UpdateManifest | null = null;
  #checkTask: Promise<ApplicationUpdateStateDto> | null = null;
  #downloadTask: Promise<ApplicationUpdateStateDto> | null =
    null;
  #manifestAbort: AbortController | null = null;
  #downloadAbort: AbortController | null = null;
  #disposed = false;

  constructor(options: ApplicationUpdateServiceOptions) {
    this.#currentVersion = options.currentVersion;
    this.#distribution = options.distribution;
    this.#platform = options.platform;
    this.#architecture = options.architecture;
    this.#downloadDirectory = options.downloadDirectory;
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? (() => new Date());
    this.#launchInstaller = options.launchInstaller;
    this.#openExternal = options.openExternal;
    this.#requestQuit = options.requestQuit;
    this.#onDiagnostic = options.onDiagnostic;
    this.#store = new AtomicJsonStore(
      options.stateFilePath,
      { maxBytes: 64 * 1_024 }
    );
    this.#state = {
      currentVersion: this.#currentVersion,
      distribution: this.#distribution,
      phase: "idle",
      checkedAt: null,
      latestVersion: null,
      releaseUrl: null,
      publishedAt: null,
      releaseNotes: null,
      updateAvailable: false,
      promptPending: false,
      installSupported:
        this.#distribution === "installed" &&
        this.#platform === "win32" &&
        this.#architecture === "x64",
      downloadedBytes: 0,
      totalBytes: null,
      errorCode: null,
      errorMessage: null
    };
    this.#ready = this.#initialize();
  }

  async getState(): Promise<ApplicationUpdateStateDto> {
    await this.#ready;
    return this.#snapshot();
  }

  check(
    source: "startup" | "manual"
  ): Promise<ApplicationUpdateStateDto> {
    if (this.#downloadTask) {
      return this.getState();
    }
    if (this.#checkTask) {
      return this.#checkTask;
    }
    this.#checkTask = this.#runCheck(source).finally(() => {
      this.#checkTask = null;
    });
    return this.#checkTask;
  }

  async acknowledgePrompt(
    version: string
  ): Promise<ApplicationUpdateStateDto> {
    await this.#ready;
    if (
      !this.#state.updateAvailable ||
      this.#state.latestVersion !== version
    ) {
      return this.#snapshot();
    }
    this.#persisted.remindedVersions = [
      ...this.#persisted.remindedVersions.filter(
        (candidate) => candidate !== version
      ),
      version
    ].slice(-MAX_REMEMBERED_VERSIONS);
    if (!(await this.#persist())) {
      return this.#snapshot();
    }
    this.#setState({
      promptPending: false
    });
    return this.#snapshot();
  }

  downloadAndInstall(): Promise<ApplicationUpdateStateDto> {
    if (this.#downloadTask) {
      return this.#downloadTask;
    }
    this.#downloadTask =
      this.#runDownloadAndInstall().finally(() => {
        this.#downloadTask = null;
      });
    return this.#downloadTask;
  }

  async openReleasePage(): Promise<ApplicationUpdateStateDto> {
    await this.#ready;
    const releaseUrl = this.#state.releaseUrl ?? RELEASES_URL;
    try {
      await this.#openExternal(releaseUrl);
      return this.#snapshot();
    } catch (error) {
      this.#diagnostic(
        "warning",
        "update.open-release-failed",
        { error: getErrorMessage(error) }
      );
      return this.#fail(
        "UPDATE_OPEN_RELEASE_FAILED",
        "无法打开 GitHub Release 页面。"
      );
    }
  }

  async openProjectPage(): Promise<ApplicationUpdateStateDto> {
    await this.#ready;
    try {
      await this.#openExternal(GITNEST_PROJECT_URL);
      return this.#snapshot();
    } catch (error) {
      this.#diagnostic(
        "warning",
        "update.open-project-failed",
        { error: getErrorMessage(error) }
      );
      return this.#fail(
        "UPDATE_OPEN_PROJECT_FAILED",
        "无法打开 GitNest 项目页面。"
      );
    }
  }

  subscribe(
    listener: (state: ApplicationUpdateStateDto) => void
  ): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  dispose(): void {
    this.#disposed = true;
    this.#manifestAbort?.abort();
    this.#downloadAbort?.abort();
    this.#listeners.clear();
  }

  async #initialize(): Promise<void> {
    try {
      const persisted = await this.#store.read();
      if (persisted !== null) {
        this.#persisted =
          validatePersistedUpdateState(persisted);
        this.#state = {
          ...this.#state,
          checkedAt:
            this.#persisted.lastSuccessfulCheckAt
        };
      }
    } catch (error) {
      this.#diagnostic("warning", "update.state-load-failed", {
        error: getErrorMessage(error)
      });
    }
    await this.#cleanupDownloadCache().catch((error) => {
      this.#diagnostic(
        "warning",
        "update.cache-maintenance-failed",
        { error: getErrorMessage(error) }
      );
    });
  }

  async #runCheck(
    source: "startup" | "manual"
  ): Promise<ApplicationUpdateStateDto> {
    await this.#ready;
    if (this.#disposed) {
      return this.#snapshot();
    }

    this.#setState({
      phase: "checking",
      downloadedBytes: 0,
      totalBytes: null,
      errorCode: null,
      errorMessage: null
    });
    const controller = new AbortController();
    this.#manifestAbort = controller;
    const timeout = setTimeout(
      () => controller.abort(),
      MANIFEST_TIMEOUT_MS
    );

    try {
      if (!isStableVersion(this.#currentVersion)) {
        throw new UpdateError(
          "UPDATE_CURRENT_VERSION_INVALID",
          `当前应用版本 ${this.#currentVersion} 不是正式版本号。`
        );
      }
      const response = await this.#fetch(
        UPDATE_MANIFEST_URL,
        {
          headers: {
            Accept: "application/json",
            "User-Agent": `GitNest/${this.#currentVersion}`
          },
          redirect: "follow",
          signal: controller.signal
        }
      );
      if (!response.ok) {
        throw new UpdateError(
          "UPDATE_MANIFEST_REQUEST_FAILED",
          `更新服务返回 HTTP ${response.status}。`
        );
      }
      const declaredLength = readContentLength(response.headers);
      if (
        declaredLength !== null &&
        declaredLength > MAX_MANIFEST_BYTES
      ) {
        throw new UpdateError(
          "UPDATE_MANIFEST_TOO_LARGE",
          "更新清单超过允许的大小。"
        );
      }
      const bytes = await readResponseBodyBounded(
        response,
        MAX_MANIFEST_BYTES
      );
      const manifest = validateUpdateManifest(
        JSON.parse(bytes.toString("utf8")) as unknown
      );
      this.#manifest = manifest;
      const checkedAt = this.#now().toISOString();
      this.#persisted.lastSuccessfulCheckAt = checkedAt;
      await this.#persist();
      const updateAvailable =
        compareStableVersions(
          manifest.version,
          this.#currentVersion
        ) > 0;
      const promptPending =
        updateAvailable &&
        source === "startup" &&
        !this.#persisted.remindedVersions.includes(
          manifest.version
        );
      this.#setState({
        phase: updateAvailable ? "available" : "up-to-date",
        checkedAt,
        latestVersion: manifest.version,
        releaseUrl: manifest.releaseUrl,
        publishedAt: manifest.publishedAt,
        releaseNotes: manifest.notes,
        updateAvailable,
        promptPending,
        downloadedBytes: 0,
        totalBytes: updateAvailable
          ? manifest.asset.sizeBytes
          : null,
        errorCode: null,
        errorMessage: null
      });
      this.#diagnostic("info", "update.check-complete", {
        source,
        currentVersion: this.#currentVersion,
        latestVersion: manifest.version,
        updateAvailable
      });
      return this.#snapshot();
    } catch (error) {
      const normalized = normalizeUpdateError(
        error,
        "UPDATE_CHECK_FAILED",
        "无法检查更新。"
      );
      this.#diagnostic("warning", "update.check-failed", {
        source,
        code: normalized.code,
        error: normalized.message
      });
      return this.#fail(
        normalized.code,
        normalized.message
      );
    } finally {
      clearTimeout(timeout);
      if (this.#manifestAbort === controller) {
        this.#manifestAbort = null;
      }
    }
  }

  async #runDownloadAndInstall(): Promise<ApplicationUpdateStateDto> {
    await this.#ready;
    let partialPath: string | null = null;
    try {
      if (this.#disposed) {
        return this.#snapshot();
      }
      if (!this.#state.installSupported) {
        throw new UpdateError(
          "UPDATE_INSTALL_UNSUPPORTED",
          "当前运行方式不支持应用内安装更新。"
        );
      }
      const manifest = this.#manifest;
      if (
        !manifest ||
        !this.#state.updateAvailable ||
        manifest.version !== this.#state.latestVersion
      ) {
        throw new UpdateError(
          "UPDATE_CHECK_REQUIRED",
          "请先检查更新，再下载安装包。"
        );
      }
      await mkdir(this.#downloadDirectory, {
        recursive: true
      });
      await this.#cleanupDownloadCache();
      const installerName = basename(manifest.asset.name);
      const installerPath = join(
        this.#downloadDirectory,
        installerName
      );
      partialPath = `${installerPath}.partial`;

      if (
        await fileMatchesAsset(
          installerPath,
          manifest.asset
        )
      ) {
        this.#setState({
          phase: "verifying",
          downloadedBytes: manifest.asset.sizeBytes,
          totalBytes: manifest.asset.sizeBytes,
          errorCode: null,
          errorMessage: null
        });
      } else {
        await unlink(installerPath).catch(() => undefined);
        await unlink(partialPath).catch(() => undefined);
        await this.#downloadInstaller(
          manifest,
          partialPath
        );
        this.#setState({
          phase: "verifying",
          downloadedBytes: manifest.asset.sizeBytes,
          totalBytes: manifest.asset.sizeBytes
        });
        if (
          !(await fileMatchesAsset(
            partialPath,
            manifest.asset
          ))
        ) {
          throw new UpdateError(
            "UPDATE_INSTALLER_INTEGRITY_FAILED",
            "安装包大小或 SHA-256 校验失败。"
          );
        }
        await unlink(installerPath).catch(() => undefined);
        await rename(partialPath, installerPath);
        partialPath = null;
      }

      this.#setState({
        phase: "launching",
        downloadedBytes: manifest.asset.sizeBytes,
        totalBytes: manifest.asset.sizeBytes,
        errorCode: null,
        errorMessage: null
      });
      await this.#launchInstaller(installerPath);
      this.#diagnostic("info", "update.installer-launched", {
        version: manifest.version,
        installer: installerName
      });
      this.#requestQuit();
      return this.#snapshot();
    } catch (error) {
      if (partialPath) {
        await unlink(partialPath).catch(() => undefined);
      }
      const normalized = normalizeUpdateError(
        error,
        "UPDATE_INSTALL_FAILED",
        "无法下载或启动更新安装包。"
      );
      this.#diagnostic("warning", "update.install-failed", {
        code: normalized.code,
        error: normalized.message
      });
      return this.#fail(
        normalized.code,
        normalized.message
      );
    }
  }

  async #downloadInstaller(
    manifest: UpdateManifest,
    partialPath: string
  ): Promise<void> {
    const controller = new AbortController();
    this.#downloadAbort = controller;
    const timeout = setTimeout(
      () => controller.abort(),
      DOWNLOAD_TIMEOUT_MS
    );
    this.#setState({
      phase: "downloading",
      downloadedBytes: 0,
      totalBytes: manifest.asset.sizeBytes,
      errorCode: null,
      errorMessage: null
    });

    let handle:
      | Awaited<ReturnType<typeof open>>
      | undefined;
    try {
      const response = await this.#fetch(
        manifest.asset.downloadUrl,
        {
          headers: {
            Accept: "application/octet-stream",
            "User-Agent": `GitNest/${this.#currentVersion}`
          },
          redirect: "follow",
          signal: controller.signal
        }
      );
      if (!response.ok || !response.body) {
        throw new UpdateError(
          "UPDATE_DOWNLOAD_REQUEST_FAILED",
          `安装包下载返回 HTTP ${response.status}。`
        );
      }
      const declaredLength = readContentLength(response.headers);
      if (
        declaredLength !== null &&
        declaredLength !== manifest.asset.sizeBytes
      ) {
        throw new UpdateError(
          "UPDATE_DOWNLOAD_SIZE_MISMATCH",
          "安装包响应大小与更新清单不一致。"
        );
      }
      handle = await open(partialPath, "wx");
      const reader = response.body.getReader();
      const hash = createHash("sha256");
      let downloadedBytes = 0;
      let lastPublishedAt = 0;
      while (true) {
        const result = await reader.read();
        if (result.done) {
          break;
        }
        const chunk = Buffer.from(result.value);
        downloadedBytes += chunk.byteLength;
        if (downloadedBytes > manifest.asset.sizeBytes) {
          throw new UpdateError(
            "UPDATE_DOWNLOAD_SIZE_MISMATCH",
            "安装包下载大小超过更新清单声明值。"
          );
        }
        hash.update(chunk);
        await writeAll(handle, chunk);
        const now = Date.now();
        if (
          now - lastPublishedAt >= 250 ||
          downloadedBytes === manifest.asset.sizeBytes
        ) {
          lastPublishedAt = now;
          this.#setState({ downloadedBytes });
        }
      }
      if (downloadedBytes !== manifest.asset.sizeBytes) {
        throw new UpdateError(
          "UPDATE_DOWNLOAD_SIZE_MISMATCH",
          "安装包下载未达到更新清单声明的大小。"
        );
      }
      if (hash.digest("hex") !== manifest.asset.sha256) {
        throw new UpdateError(
          "UPDATE_INSTALLER_INTEGRITY_FAILED",
          "安装包 SHA-256 与更新清单不一致。"
        );
      }
      await handle.sync();
      await handle.close();
      handle = undefined;
    } finally {
      clearTimeout(timeout);
      await handle?.close().catch(() => undefined);
      if (this.#downloadAbort === controller) {
        this.#downloadAbort = null;
      }
    }
  }

  async #persist(): Promise<boolean> {
    try {
      await this.#store.write(this.#persisted);
      return true;
    } catch (error) {
      this.#diagnostic("warning", "update.state-save-failed", {
        error: getErrorMessage(error)
      });
      return false;
    }
  }

  async #cleanupDownloadCache(): Promise<void> {
    let entries;
    try {
      entries = await readdir(this.#downloadDirectory, {
        withFileTypes: true
      });
    } catch (error) {
      if (getErrorCode(error) === "ENOENT") {
        return;
      }
      throw error;
    }
    const now = this.#now().getTime();
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const path = join(
        this.#downloadDirectory,
        entry.name
      );
      const information = await stat(path);
      files.push({
        path,
        size: information.size,
        modifiedAt: information.mtimeMs
      });
    }
    files.sort(
      (left, right) =>
        right.modifiedAt - left.modifiedAt
    );
    let retainedBytes = 0;
    for (const file of files) {
      retainedBytes += file.size;
      if (
        now - file.modifiedAt > DOWNLOAD_RETENTION_MS ||
        retainedBytes > DOWNLOAD_CACHE_BYTES
      ) {
        await unlink(file.path).catch(() => undefined);
      }
    }
  }

  #fail(
    code: string,
    message: string
  ): ApplicationUpdateStateDto {
    this.#setState({
      phase: "error",
      promptPending: false,
      errorCode: code,
      errorMessage: message
    });
    return this.#snapshot();
  }

  #setState(
    patch: Partial<ApplicationUpdateStateDto>
  ): void {
    this.#state = {
      ...this.#state,
      ...patch
    };
    const state = this.#snapshot();
    for (const listener of this.#listeners) {
      try {
        listener(state);
      } catch {
        // A renderer may close while an update event is being sent.
      }
    }
  }

  #snapshot(): ApplicationUpdateStateDto {
    return { ...this.#state };
  }

  #diagnostic(
    level: ApplicationUpdateDiagnostic["level"],
    name: string,
    context: Readonly<Record<string, unknown>>
  ): void {
    this.#onDiagnostic?.({ level, name, context });
  }
}

export function detectApplicationUpdateDistribution(
  packaged: boolean,
  environment: NodeJS.ProcessEnv = process.env
): ApplicationUpdateDistributionDto {
  if (!packaged) {
    return "development";
  }
  if (
    environment.PORTABLE_EXECUTABLE_FILE ||
    environment.PORTABLE_EXECUTABLE_DIR
  ) {
    return "portable";
  }
  return "installed";
}

export function compareStableVersions(
  left: string,
  right: string
): number {
  const leftParts = parseStableVersion(left);
  const rightParts = parseStableVersion(right);
  for (let index = 0; index < 3; index += 1) {
    const difference =
      (leftParts[index] ?? 0) -
      (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function validateUpdateManifest(
  value: unknown
): UpdateManifest {
  const record = readRecord(value, "更新清单");
  const version = readStableVersion(
    record.version,
    "更新版本"
  );
  const tag = readString(record.tag, "更新标签", 64);
  const expectedTag = `v${version}`;
  if (tag !== expectedTag) {
    throw new UpdateError(
      "UPDATE_MANIFEST_INVALID",
      "更新清单的版本标签不匹配。"
    );
  }
  const expectedReleaseUrl =
    `https://github.com/junxin367/GitNest/releases/tag/${tag}`;
  const releaseUrl = readString(
    record.releaseUrl,
    "发布页地址",
    2_048
  );
  if (releaseUrl !== expectedReleaseUrl) {
    throw new UpdateError(
      "UPDATE_MANIFEST_INVALID",
      "更新清单包含非预期的发布页地址。"
    );
  }
  const publishedAt = readString(
    record.publishedAt,
    "发布时间",
    128
  );
  if (Number.isNaN(Date.parse(publishedAt))) {
    throw new UpdateError(
      "UPDATE_MANIFEST_INVALID",
      "更新清单的发布时间无效。"
    );
  }
  const notes = readString(
    record.notes,
    "发行说明",
    MAX_RELEASE_NOTES_LENGTH,
    true
  );
  const assetRecord = readRecord(
    record.asset,
    "安装包"
  );
  const expectedName =
    `GitNest-Setup-${version}-x64.exe`;
  const name = readString(
    assetRecord.name,
    "安装包名称",
    255
  );
  if (
    name !== expectedName ||
    basename(name) !== name
  ) {
    throw new UpdateError(
      "UPDATE_MANIFEST_INVALID",
      "更新清单包含非预期的安装包名称。"
    );
  }
  const expectedDownloadUrl =
    `${RELEASE_DOWNLOAD_ROOT}/${tag}/${name}`;
  const downloadUrl = readString(
    assetRecord.downloadUrl,
    "安装包地址",
    2_048
  );
  if (downloadUrl !== expectedDownloadUrl) {
    throw new UpdateError(
      "UPDATE_MANIFEST_INVALID",
      "更新清单包含非预期的安装包地址。"
    );
  }
  const sizeBytes = assetRecord.sizeBytes;
  if (
    typeof sizeBytes !== "number" ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes < 1 ||
    sizeBytes > MAX_INSTALLER_BYTES
  ) {
    throw new UpdateError(
      "UPDATE_MANIFEST_INVALID",
      "更新清单中的安装包大小无效。"
    );
  }
  const sha256 = readString(
    assetRecord.sha256,
    "安装包 SHA-256",
    64
  ).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new UpdateError(
      "UPDATE_MANIFEST_INVALID",
      "更新清单中的安装包 SHA-256 无效。"
    );
  }
  if (
    record.schemaVersion !== 1 ||
    record.product !== "GitNest" ||
    assetRecord.kind !== "nsis" ||
    assetRecord.platform !== "win32" ||
    assetRecord.architecture !== "x64"
  ) {
    throw new UpdateError(
      "UPDATE_MANIFEST_INVALID",
      "更新清单与当前应用不兼容。"
    );
  }
  return {
    schemaVersion: 1,
    product: "GitNest",
    version,
    tag,
    releaseUrl,
    publishedAt,
    notes,
    asset: {
      kind: "nsis",
      platform: "win32",
      architecture: "x64",
      name,
      downloadUrl,
      sizeBytes,
      sha256
    }
  };
}

function validatePersistedUpdateState(
  value: unknown
): PersistedUpdateState {
  const record = readRecord(value, "更新状态");
  if (record.schemaVersion !== 1) {
    throw new Error("Unsupported update state schema.");
  }
  if (!Array.isArray(record.remindedVersions)) {
    throw new Error("Invalid reminded update versions.");
  }
  const remindedVersions = record.remindedVersions
    .map((version) =>
      readStableVersion(version, "已提醒版本")
    )
    .slice(-MAX_REMEMBERED_VERSIONS);
  const lastSuccessfulCheckAt =
    record.lastSuccessfulCheckAt;
  if (
    lastSuccessfulCheckAt !== null &&
    (typeof lastSuccessfulCheckAt !== "string" ||
      Number.isNaN(Date.parse(lastSuccessfulCheckAt)))
  ) {
    throw new Error("Invalid update check timestamp.");
  }
  return {
    schemaVersion: 1,
    remindedVersions: [...new Set(remindedVersions)],
    lastSuccessfulCheckAt
  };
}

async function fileMatchesAsset(
  path: string,
  asset: UpdateManifest["asset"]
): Promise<boolean> {
  const information = await stat(path).catch(
    () => undefined
  );
  if (
    !information?.isFile() ||
    information.size !== asset.sizeBytes
  ) {
    return false;
  }
  return (await sha256(path)) === asset.sha256;
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  buffer: Buffer
): Promise<void> {
  let offset = 0;
  while (offset < buffer.byteLength) {
    const result = await handle.write(
      buffer,
      offset,
      buffer.byteLength - offset,
      null
    );
    if (result.bytesWritten === 0) {
      throw new Error(
        "Unable to make progress while writing the installer."
      );
    }
    offset += result.bytesWritten;
  }
}

async function readResponseBodyBounded(
  response: Response,
  maxBytes: number
): Promise<Buffer> {
  if (!response.body) {
    throw new UpdateError(
      "UPDATE_MANIFEST_INVALID",
      "更新清单响应为空。"
    );
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    const chunk = Buffer.from(result.value);
    totalBytes += chunk.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new UpdateError(
        "UPDATE_MANIFEST_TOO_LARGE",
        "更新清单超过允许的大小。"
      );
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, totalBytes);
}

function readContentLength(
  headers: Headers
): number | null {
  const value = headers.get("content-length");
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0
    ? parsed
    : null;
}

function readRecord(
  value: unknown,
  label: string
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new UpdateError(
      "UPDATE_MANIFEST_INVALID",
      `${label}格式无效。`
    );
  }
  return value as Record<string, unknown>;
}

function readString(
  value: unknown,
  label: string,
  maxLength: number,
  allowEmpty = false
): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.length > maxLength
  ) {
    throw new UpdateError(
      "UPDATE_MANIFEST_INVALID",
      `${label}无效。`
    );
  }
  return value;
}

function readStableVersion(
  value: unknown,
  label: string
): string {
  const version = readString(value, label, 64);
  if (!isStableVersion(version)) {
    throw new UpdateError(
      "UPDATE_MANIFEST_INVALID",
      `${label}不是正式版本号。`
    );
  }
  return version;
}

function parseStableVersion(
  version: string
): [number, number, number] {
  if (!isStableVersion(version)) {
    throw new Error(`Invalid stable version: ${version}`);
  }
  const parts = version
    .split(".")
    .map((part) => Number(part));
  return [
    parts[0] ?? 0,
    parts[1] ?? 0,
    parts[2] ?? 0
  ];
}

function isStableVersion(version: string): boolean {
  return STABLE_VERSION_PATTERN.test(version);
}

class UpdateError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "UpdateError";
    this.code = code;
  }
}

function normalizeUpdateError(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string
): UpdateError {
  if (error instanceof UpdateError) {
    return error;
  }
  if (
    error &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "AbortError"
  ) {
    return new UpdateError(
      "UPDATE_REQUEST_TIMEOUT",
      "更新请求超时。"
    );
  }
  return new UpdateError(
    fallbackCode,
    fallbackMessage
  );
}

function getErrorCode(error: unknown): string {
  return error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

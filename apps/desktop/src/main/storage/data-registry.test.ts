import { isAbsolute, relative, resolve } from "node:path";
import { join } from "node:path";
import {
  mkdir,
  mkdtemp,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

import { GITNEST_PROJECT_URL } from "@gitnest/contracts";

import { createDataRegistry } from "./data-registry";
import {
  ApplicationUpdateService,
  compareStableVersions,
  detectApplicationUpdateDistribution
} from "../update/application-update-service";

vi.mock("@gitnest/persistence-json", async () =>
  import(
    "../../../../../packages/persistence-json/src/atomic-json-store"
  )
);

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) =>
        rm(path, { recursive: true, force: true })
      )
  );
});

describe("createDataRegistry", () => {
  it("keeps every unique dataset inside the user data root", () => {
    const registry = createDataRegistry(
      resolve("C:\\fixture\\gitnest-user-data")
    );
    const ids = registry.descriptors.map(
      (descriptor) => descriptor.id
    );
    const paths = registry.descriptors.map(
      (descriptor) => descriptor.path
    );

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) {
      const child = relative(registry.root, path);
      expect(isAbsolute(child)).toBe(false);
      expect(child).not.toBe("..");
      expect(child.startsWith(`..\\`)).toBe(false);
      expect(child.startsWith("../")).toBe(false);
    }
  });

  it("classifies secrets, durable state, caches and runtime data", () => {
    const registry = createDataRegistry(
      resolve("C:\\fixture\\gitnest-user-data")
    );
    const byId = new Map(
      registry.descriptors.map((descriptor) => [
        descriptor.id,
        descriptor
      ])
    );

    expect(byId.get("app-settings")).toMatchObject({
      category: "durable",
      rebuildable: false,
      sensitive: true
    });
    expect(byId.get("credential-vault")).toMatchObject({
      category: "durable",
      rebuildable: false,
      sensitive: true
    });
    expect(
      byId.get("code-analysis-index")?.retention
    ).toMatchObject({
      policy: "bounded",
      maxAgeDays: 30
    });
    expect(byId.get("askpass-runtime")).toMatchObject({
      category: "runtime",
      rebuildable: true,
      sensitive: true
    });
    expect(
      byId.get("application-update-state")
    ).toMatchObject({
      category: "durable",
      rebuildable: true,
      sensitive: false
    });
    expect(
      byId.get("application-update-downloads")
        ?.retention
    ).toEqual({
      policy: "bounded",
      maxAgeDays: 14,
      maxBytes: 512 * 1_024 * 1_024
    });
  });

  it("rejects a relative root", () => {
    expect(() =>
      createDataRegistry("relative/user-data")
    ).toThrow(/absolute/i);
  });
});

describe("ApplicationUpdateService", () => {
  it("detects distributions and compares stable versions", () => {
    expect(
      detectApplicationUpdateDistribution(false, {})
    ).toBe("development");
    expect(
      detectApplicationUpdateDistribution(true, {
        PORTABLE_EXECUTABLE_FILE:
          "C:\\GitNest\\GitNest.exe"
      })
    ).toBe("portable");
    expect(
      detectApplicationUpdateDistribution(true, {})
    ).toBe("installed");
    expect(compareStableVersions("1.10.0", "1.9.9")).toBe(
      1
    );
    expect(compareStableVersions("1.0.0", "1.0.0")).toBe(
      0
    );
  });

  it("opens the fixed GitNest project page", async () => {
    const root = await createTemporaryDirectory();
    const openExternal = vi.fn(async () => undefined);
    const service = new ApplicationUpdateService({
      currentVersion: "1.0.0",
      distribution: "development",
      platform: "win32",
      architecture: "x64",
      stateFilePath: join(root, "updates", "state.json"),
      downloadDirectory: join(
        root,
        "updates",
        "downloads"
      ),
      launchInstaller: vi.fn(async () => undefined),
      openExternal,
      requestQuit: vi.fn()
    });

    await service.openProjectPage();

    expect(openExternal).toHaveBeenCalledWith(
      GITNEST_PROJECT_URL
    );
    service.dispose();
  });

  it("persists a once-per-version startup reminder", async () => {
    const root = await createTemporaryDirectory();
    const manifest = createUpdateManifest();
    const fetchUpdate = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify(manifest), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      })
    );
    const options = {
      currentVersion: "1.0.0",
      distribution: "installed" as const,
      platform: "win32" as const,
      architecture: "x64",
      stateFilePath: join(root, "updates", "state.json"),
      downloadDirectory: join(
        root,
        "updates",
        "downloads"
      ),
      fetch: fetchUpdate,
      launchInstaller: vi.fn(async () => undefined),
      openExternal: vi.fn(async () => undefined),
      requestQuit: vi.fn()
    };
    const first = new ApplicationUpdateService(options);

    await expect(first.check("startup")).resolves.toMatchObject({
      phase: "available",
      latestVersion: "1.1.0",
      publishedAt: "2026-09-22T00:00:00.000Z",
      releaseNotes: "A stable update.",
      updateAvailable: true,
      promptPending: true
    });
    await expect(
      first.acknowledgePrompt("1.1.0")
    ).resolves.toMatchObject({
      promptPending: false
    });
    first.dispose();

    const second = new ApplicationUpdateService(options);
    await expect(second.check("startup")).resolves.toMatchObject(
      {
        phase: "available",
        latestVersion: "1.1.0",
        updateAvailable: true,
        promptPending: false
      }
    );
    second.dispose();
  });

  it("rejects updater manifests that point outside the GitNest release", async () => {
    const root = await createTemporaryDirectory();
    const manifest = createUpdateManifest();
    manifest.asset.downloadUrl =
      "https://attacker.invalid/GitNest.exe";
    const service = new ApplicationUpdateService({
      currentVersion: "1.0.0",
      distribution: "installed",
      platform: "win32",
      architecture: "x64",
      stateFilePath: join(root, "updates", "state.json"),
      downloadDirectory: join(
        root,
        "updates",
        "downloads"
      ),
      fetch: vi.fn<typeof fetch>(async () =>
        new Response(JSON.stringify(manifest), {
          status: 200
        })
      ),
      launchInstaller: vi.fn(async () => undefined),
      openExternal: vi.fn(async () => undefined),
      requestQuit: vi.fn()
    });

    await expect(service.check("manual")).resolves.toMatchObject(
      {
        phase: "error",
        errorCode: "UPDATE_MANIFEST_INVALID",
        updateAvailable: false
      }
    );
    service.dispose();
  });

  it.each([
    ["declared-size", "UPDATE_DOWNLOAD_SIZE_MISMATCH"],
    ["stream-size", "UPDATE_DOWNLOAD_SIZE_MISMATCH"],
    ["http-status", "UPDATE_DOWNLOAD_REQUEST_FAILED"],
    ["open-file", "UPDATE_INSTALL_FAILED"]
  ] as const)(
    "cancels rejected installer responses (%s)",
    async (failure, errorCode) => {
      const root = await createTemporaryDirectory();
      const manifest = createUpdateManifest();
      const cancel = vi.fn();
      let downloadSignal: AbortSignal | null | undefined;
      const launchInstaller = vi.fn(async () => undefined);
      const service = new ApplicationUpdateService({
        currentVersion: "1.0.0",
        distribution: "installed",
        platform: "win32",
        architecture: "x64",
        stateFilePath: join(root, "updates", "state.json"),
        downloadDirectory: join(root, "updates", "downloads"),
        fetch: vi.fn<typeof fetch>(async (url, init) => {
          if (String(url) !== manifest.asset.downloadUrl) {
            return new Response(JSON.stringify(manifest));
          }
          downloadSignal = init?.signal;
          if (failure === "open-file") {
            await mkdir(join(
              root,
              "updates",
              "downloads",
              `${manifest.asset.name}.partial`
            ));
          }
          return new Response(new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(manifest.asset.sizeBytes + 1));
            },
            cancel
          }), {
            status: failure === "http-status" ? 503 : 200,
            headers: failure === "declared-size"
              ? { "content-length": String(manifest.asset.sizeBytes + 1) }
              : {}
          });
        }),
        launchInstaller,
        openExternal: vi.fn(async () => undefined),
        requestQuit: vi.fn()
      });
      try {
        await service.check("manual");
        await expect(service.downloadAndInstall()).resolves.toMatchObject({
          phase: "error",
          errorCode
        });
        expect(downloadSignal?.aborted).toBe(true);
        expect(cancel).toHaveBeenCalledOnce();
        expect(launchInstaller).not.toHaveBeenCalled();
      } finally {
        service.dispose();
      }
    }
  );

  it.each(["declared-size", "http-status", "read-error"] as const)(
    "releases failed manifest responses (%s)",
    async (failure) => {
      const root = await createTemporaryDirectory();
      const cancel = vi.fn(() => {
        if (failure === "http-status") {
          throw new Error("cancel failed");
        }
      });
      let signal: AbortSignal | null | undefined;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          if (failure === "read-error") {
            controller.error(new Error("broken response"));
          } else {
            controller.enqueue(new Uint8Array([1]));
          }
        },
        cancel
      });
      const service = new ApplicationUpdateService({
        currentVersion: "1.0.0",
        distribution: "installed",
        platform: "win32",
        architecture: "x64",
        stateFilePath: join(root, "updates", "state.json"),
        downloadDirectory: join(root, "updates", "downloads"),
        fetch: vi.fn<typeof fetch>(async (_input, init) => {
          signal = init?.signal;
          return new Response(body, {
            status: failure === "http-status" ? 503 : 200,
            headers: failure === "declared-size"
              ? { "content-length": "1048577" }
              : {}
          });
        }),
        launchInstaller: vi.fn(async () => undefined),
        openExternal: vi.fn(async () => undefined),
        requestQuit: vi.fn()
      });
      try {
        await expect(service.check("manual")).resolves.toMatchObject({
          phase: "error",
          errorCode: failure === "declared-size"
            ? "UPDATE_MANIFEST_TOO_LARGE"
            : failure === "http-status"
              ? "UPDATE_MANIFEST_REQUEST_FAILED"
              : "UPDATE_CHECK_FAILED"
        });
        expect(signal?.aborted).toBe(true);
        expect(body.locked).toBe(false);
        if (failure !== "read-error") {
          expect(cancel).toHaveBeenCalledOnce();
        }
      } finally {
        service.dispose();
      }
    }
  );

  it("does not apply a manifest after disposal interrupts the check", async () => {
    const root = await createTemporaryDirectory();
    const manifest = createUpdateManifest();
    let markManifestStarted!: () => void;
    const manifestStarted = new Promise<void>((resolve) => {
      markManifestStarted = resolve;
    });
    let releaseManifest!: () => void;
    const manifestGate = new Promise<void>((resolve) => {
      releaseManifest = resolve;
    });
    let manifestCancelled = false;
    const diagnostics = vi.fn();
    const service = new ApplicationUpdateService({
      currentVersion: "1.0.0",
      distribution: "installed",
      platform: "win32",
      architecture: "x64",
      stateFilePath: join(root, "updates", "state.json"),
      downloadDirectory: join(
        root,
        "updates",
        "downloads"
      ),
      fetch: vi.fn<typeof fetch>(async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              markManifestStarted();
              void manifestGate.then(() => {
                if (manifestCancelled) {
                  return;
                }
                controller.enqueue(
                  Buffer.from(JSON.stringify(manifest))
                );
                controller.close();
              });
            },
            cancel() {
              manifestCancelled = true;
            }
          }),
          { status: 200 }
        )
      ),
      launchInstaller: vi.fn(async () => undefined),
      openExternal: vi.fn(async () => undefined),
      requestQuit: vi.fn(),
      onDiagnostic: diagnostics
    });

    const check = service.check("manual");
    await manifestStarted;
    service.dispose();
    releaseManifest();
    const state = await check;

    expect(state).toMatchObject({
      latestVersion: null,
      updateAvailable: false
    });
    expect(diagnostics).not.toHaveBeenCalledWith(
      expect.objectContaining({
        name: "update.check-complete"
      })
    );
  });

  it("downloads, verifies and launches the declared installer", async () => {
    const root = await createTemporaryDirectory();
    const installer = Buffer.from("safe installer");
    const manifest = createUpdateManifest();
    manifest.asset.sizeBytes = installer.byteLength;
    manifest.asset.sha256 = createHash("sha256")
      .update(installer)
      .digest("hex");
    const launchInstaller = vi.fn(async () => undefined);
    const requestQuit = vi.fn();
    const service = new ApplicationUpdateService({
      currentVersion: "1.0.0",
      distribution: "installed",
      platform: "win32",
      architecture: "x64",
      stateFilePath: join(root, "updates", "state.json"),
      downloadDirectory: join(
        root,
        "updates",
        "downloads"
      ),
      fetch: vi.fn<typeof fetch>(async (input) =>
        String(input).endsWith("latest.json")
          ? new Response(JSON.stringify(manifest), {
              status: 200
            })
          : new Response(installer, {
              status: 200,
              headers: {
                "content-length": String(
                  installer.byteLength
                )
              }
            })
      ),
      launchInstaller,
      openExternal: vi.fn(async () => undefined),
      requestQuit
    });

    await service.check("manual");
    await expect(
      service.downloadAndInstall()
    ).resolves.toMatchObject({
      phase: "launching",
      downloadedBytes: installer.byteLength,
      totalBytes: installer.byteLength
    });
    expect(launchInstaller).toHaveBeenCalledWith(
      join(
        root,
        "updates",
        "downloads",
        "GitNest-Setup-1.1.0-x64.exe"
      )
    );
    expect(requestQuit).toHaveBeenCalledOnce();
    service.dispose();
  });

  it("does not launch the installer after disposal interrupts a download", async () => {
    const root = await createTemporaryDirectory();
    const installer = Buffer.from("safe installer");
    const manifest = createUpdateManifest();
    manifest.asset.sizeBytes = installer.byteLength;
    manifest.asset.sha256 = createHash("sha256")
      .update(installer)
      .digest("hex");
    let markDownloadStarted!: () => void;
    const downloadStarted = new Promise<void>((resolve) => {
      markDownloadStarted = resolve;
    });
    let releaseDownload!: () => void;
    const downloadGate = new Promise<void>((resolve) => {
      releaseDownload = resolve;
    });
    const launchInstaller = vi.fn(async () => undefined);
    const requestQuit = vi.fn();
    const service = new ApplicationUpdateService({
      currentVersion: "1.0.0",
      distribution: "installed",
      platform: "win32",
      architecture: "x64",
      stateFilePath: join(root, "updates", "state.json"),
      downloadDirectory: join(
        root,
        "updates",
        "downloads"
      ),
      fetch: vi.fn<typeof fetch>(async (input) => {
        if (String(input).endsWith("latest.json")) {
          return new Response(JSON.stringify(manifest), {
            status: 200
          });
        }
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              markDownloadStarted();
              void downloadGate.then(() => {
                controller.enqueue(installer);
                controller.close();
              });
            }
          }),
          {
            status: 200,
            headers: {
              "content-length": String(
                installer.byteLength
              )
            }
          }
        );
      }),
      launchInstaller,
      openExternal: vi.fn(async () => undefined),
      requestQuit
    });

    await service.check("manual");
    const download = service.downloadAndInstall();
    await downloadStarted;
    service.dispose();
    releaseDownload();
    await download;

    expect(launchInstaller).not.toHaveBeenCalled();
    expect(requestQuit).not.toHaveBeenCalled();
    await expect(
      stat(
        join(
          root,
          "updates",
          "downloads",
          `${manifest.asset.name}.partial`
        )
      )
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not launch a cached installer after disposal during verification", async () => {
    const root = await createTemporaryDirectory();
    const installer = Buffer.from("safe installer");
    const manifest = createUpdateManifest();
    manifest.asset.sizeBytes = installer.byteLength;
    manifest.asset.sha256 = createHash("sha256")
      .update(installer)
      .digest("hex");
    const downloadDirectory = join(
      root,
      "updates",
      "downloads"
    );
    await mkdir(downloadDirectory, { recursive: true });
    await writeFile(
      join(downloadDirectory, manifest.asset.name),
      installer
    );
    const launchInstaller = vi.fn(async () => undefined);
    const requestQuit = vi.fn();
    const service = new ApplicationUpdateService({
      currentVersion: "1.0.0",
      distribution: "installed",
      platform: "win32",
      architecture: "x64",
      stateFilePath: join(root, "updates", "state.json"),
      downloadDirectory,
      fetch: vi.fn<typeof fetch>(async () =>
        new Response(JSON.stringify(manifest), {
          status: 200
        })
      ),
      launchInstaller,
      openExternal: vi.fn(async () => undefined),
      requestQuit
    });

    await service.check("manual");
    service.subscribe((state) => {
      if (state.phase === "verifying") {
        service.dispose();
      }
    });
    await service.downloadAndInstall();

    expect(launchInstaller).not.toHaveBeenCalled();
    expect(requestQuit).not.toHaveBeenCalled();
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const path = await mkdtemp(
    join(tmpdir(), "gitnest-update-test-")
  );
  temporaryDirectories.push(path);
  return path;
}

function createUpdateManifest() {
  return {
    schemaVersion: 1,
    product: "GitNest",
    version: "1.1.0",
    tag: "v1.1.0",
    releaseUrl:
      "https://github.com/junxin367/GitNest/releases/tag/v1.1.0",
    publishedAt: "2026-09-22T00:00:00.000Z",
    notes: "A stable update.",
    asset: {
      kind: "nsis",
      platform: "win32",
      architecture: "x64",
      name: "GitNest-Setup-1.1.0-x64.exe",
      downloadUrl:
        "https://github.com/junxin367/GitNest/releases/download/v1.1.0/GitNest-Setup-1.1.0-x64.exe",
      sizeBytes: 128,
      sha256: "a".repeat(64)
    }
  };
}

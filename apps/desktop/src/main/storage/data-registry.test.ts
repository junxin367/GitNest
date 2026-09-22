import { isAbsolute, relative, resolve } from "node:path";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
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

/** @vitest-environment jsdom */

import { act } from "react";
import {
  createRoot,
  type Root
} from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

import {
  GITNEST_PROJECT_URL,
  type ApplicationUpdateStateDto
} from "@gitnest/contracts";

import { VersionDialog } from "./VersionDialog";

describe("VersionDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document
      .querySelectorAll(".gn-dialog-backdrop")
      .forEach((element) => element.remove());
  });

  it("keeps project and update information visible before checking", () => {
    const onOpenProjectPage = vi.fn();
    const onOpenReleasePage = vi.fn();

    renderDialog({
      state: null,
      onOpenProjectPage,
      onOpenReleasePage
    });

    expect(
      document.querySelector(".version-dialog-url code")
        ?.textContent
    ).toBe(GITNEST_PROJECT_URL);
    expect(
      document.querySelector(".version-dialog-update-notes")
    ).toBeNull();
    expect(document.body.textContent).not.toContain(
      "GitNest Desktop 是本地优先的多仓库 Git 工作区。"
    );
    expect(document.body.textContent).not.toContain(
      "检查更新后，将在此显示最新正式版的发布时间和更新内容。"
    );
    expect(
      document.querySelector(".version-dialog-status")
    ).toBeNull();

    act(() => {
      findButton("打开项目").click();
      findButton("打开 Releases").click();
    });

    expect(onOpenProjectPage).toHaveBeenCalledOnce();
    expect(onOpenReleasePage).toHaveBeenCalledOnce();
  });

  it("shows verified release metadata and update notes", () => {
    const state = createUpdateState();
    const onDownloadAndInstall = vi.fn();

    renderDialog({
      state,
      onDownloadAndInstall
    });

    const metadata = document.querySelector(
      ".version-dialog-update-meta"
    );
    expect(metadata?.textContent).toContain("v0.0.2");
    expect(metadata?.textContent).toContain(
      new Date(state.publishedAt!).toLocaleString("zh-CN")
    );
    expect(
      document.querySelector(
        ".version-dialog-update-notes"
      )?.textContent
    ).toBe(state.releaseNotes);
    expect(findButton("查看 Release")).not.toBeNull();

    act(() => {
      findButton("下载并安装").click();
    });
    expect(onDownloadAndInstall).toHaveBeenCalledOnce();
  });

  function renderDialog({
    state,
    onDownloadAndInstall = vi.fn(),
    onOpenProjectPage = vi.fn(),
    onOpenReleasePage = vi.fn()
  }: {
    state: ApplicationUpdateStateDto | null;
    onDownloadAndInstall?: () => void;
    onOpenProjectPage?: () => void;
    onOpenReleasePage?: () => void;
  }) {
    act(() => {
      root.render(
        <VersionDialog
          fallbackVersion="0.0.1"
          onAcknowledgePrompt={vi.fn()}
          onCheck={vi.fn()}
          onClose={vi.fn()}
          onDownloadAndInstall={onDownloadAndInstall}
          onOpenProjectPage={onOpenProjectPage}
          onOpenReleasePage={onOpenReleasePage}
          state={state}
        />
      );
    });
  }
});

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(
    document.querySelectorAll<HTMLButtonElement>("button")
  ).find(
    (candidate) =>
      candidate.textContent?.trim() === label
  );
  if (!button) {
    throw new Error(`Button not found: ${label}`);
  }
  return button;
}

function createUpdateState(): ApplicationUpdateStateDto {
  return {
    currentVersion: "0.0.1",
    distribution: "installed",
    phase: "available",
    checkedAt: "2026-09-22T08:00:00.000Z",
    latestVersion: "0.0.2",
    releaseUrl:
      "https://github.com/junxin367/GitNest/releases/tag/v0.0.2",
    publishedAt: "2026-09-22T07:00:00.000Z",
    releaseNotes: "新增项目主页与完整更新信息。",
    updateAvailable: true,
    promptPending: false,
    installSupported: true,
    downloadedBytes: 0,
    totalBytes: 12_345,
    errorCode: null,
    errorMessage: null
  };
}

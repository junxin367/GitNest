/** @vitest-environment jsdom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

import type {
  GitNestBridge,
  RepositoryCommitDiffDto,
  RepositoryCommitDto,
  RepositoryMediaPreviewDto,
  RepositoryTargetDto
} from "@gitnest/contracts";

import { RepositoryCommitDetail } from "./RepositoryPage";
import { RepositoryCommitDetailBreadcrumb } from "./RepositoryHistory";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

const TARGET: RepositoryTargetDto = {
  repositoryId: "repository-a",
  worktreeId: "worktree-a"
};
const COMMIT_HASH = "a".repeat(40);
const COMMIT: RepositoryCommitDto["commit"] = {
  hash: COMMIT_HASH,
  shortHash: COMMIT_HASH.slice(0, 7),
  authorName: "June",
  authorEmail: "june@example.com",
  authoredAt: "2026-09-16T08:00:00.000Z",
  committerName: "June",
  committerEmail: "june@example.com",
  committedAt: "2026-09-16T08:00:00.000Z",
  subject: "feat: show commit files",
  body: "Expose changed files in commit details.",
  parentHashes: ["b".repeat(40)],
  refs: ["HEAD -> main"],
  files: [
    {
      path: "src/App.tsx",
      additions: 4,
      deletions: 2,
      binary: false
    },
    {
      path: "assets/logo.png",
      binary: true
    }
  ],
  additions: 4,
  deletions: 2
};

describe("RepositoryCommitDetail", () => {
  let container: HTMLDivElement;
  let root: Root;
  let createObjectUrlDescriptor:
    | PropertyDescriptor
    | undefined;
  let revokeObjectUrlDescriptor:
    | PropertyDescriptor
    | undefined;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      }
    );
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn()
    });
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollIntoView",
      {
        configurable: true,
        value: vi.fn()
      }
    );
    createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
      URL,
      "createObjectURL"
    );
    revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
      URL,
      "revokeObjectURL"
    );
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:commit-media-preview")
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn()
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    if (createObjectUrlDescriptor) {
      Object.defineProperty(
        URL,
        "createObjectURL",
        createObjectUrlDescriptor
      );
    } else {
      Reflect.deleteProperty(URL, "createObjectURL");
    }
    if (revokeObjectUrlDescriptor) {
      Object.defineProperty(
        URL,
        "revokeObjectURL",
        revokeObjectUrlDescriptor
      );
    } else {
      Reflect.deleteProperty(URL, "revokeObjectURL");
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("switches the breadcrumb between commit details and changed files", () => {
    act(() => {
      root.render(<CommitDetailBreadcrumbHarness />);
    });

    const detailsButton = findViewButton(
      container,
      "details"
    );
    const filesButton = findViewButton(container, "files");
    expect(detailsButton.getAttribute("aria-current")).toBe(
      "page"
    );
    expect(filesButton.hasAttribute("aria-current")).toBe(false);

    act(() => {
      filesButton.click();
    });

    expect(detailsButton.hasAttribute("aria-current")).toBe(
      false
    );
    expect(filesButton.getAttribute("aria-current")).toBe(
      "page"
    );
    expect(container.textContent).toContain("+4");
    expect(container.textContent).toContain("-2");
  });

  it("renders commit details and changed files as mutually exclusive views", async () => {
    const getCommitDiff = vi.fn(async () => ({
      ok: true as const,
      value: createCommitDiff(
        "src/App.tsx",
        [
          "@@ -1 +1 @@",
          "-const oldValue = true;",
          "+const newValue = true;"
        ].join("\n")
      )
    }));
    installBridge({ getCommitDiff });

    act(() => {
      root.render(
        <RepositoryCommitDetail
          commit={COMMIT}
          target={TARGET}
          view="details"
        />
      );
    });
    await act(async () => {
      await flushAsyncWork();
    });

    expect(
      container.querySelector(".history-commit-overview")
    ).not.toBeNull();
    expect(
      container.querySelector(".history-commit-files")
    ).toBeNull();
    expect(container.textContent).toContain(COMMIT.subject);
    expect(container.textContent).toContain(COMMIT.body);

    act(() => {
      root.render(
        <RepositoryCommitDetail
          commit={COMMIT}
          target={TARGET}
          view="files"
        />
      );
    });

    expect(
      container.querySelector(".history-commit-overview")
    ).toBeNull();
    expect(
      container.querySelector(".history-commit-files")
    ).not.toBeNull();
    expect(
      container.querySelector(
        "details.history-commit-files"
      )
    ).toBeNull();
    expect(container.textContent).toContain("App.tsx");
    expect(container.textContent).toContain("src");
    expect(container.textContent).toContain("logo.png");
    expect(container.textContent).toContain("二进制");
    expect(container.textContent).toContain("+4");
    expect(container.textContent).toContain("-2");

    expect(getCommitDiff).toHaveBeenCalledWith({
      queryId: expect.stringMatching(/^commit_diff_/),
      target: TARGET,
      commitHash: COMMIT_HASH,
      path: "src/App.tsx",
      contextLines: 3
    });
    expect(
      findButtonByTitle(container, "src/App.tsx").getAttribute(
        "aria-current"
      )
    ).toBe("true");
    expect(container.textContent).toContain("oldValue");
    expect(container.textContent).toContain("newValue");
  });

  it("keeps the latest selected file when diff responses arrive out of order", async () => {
    const first = deferred<RepositoryCommitDiffDto>();
    const second = deferred<RepositoryCommitDiffDto>();
    const getCommitDiff = vi.fn(
      (
        request: Parameters<
          GitNestBridge["repository"]["getCommitDiff"]
        >[0]
      ) =>
        (request.path === "src/App.tsx"
          ? first.promise
          : second.promise
        ).then((value) => ({
          ok: true as const,
          value
        }))
    );
    const cancelQuery = vi.fn(async () => ({
      ok: true as const,
      value: undefined
    }));
    installBridge({ cancelQuery, getCommitDiff });

    act(() => {
      root.render(
        <RepositoryCommitDetail
          commit={COMMIT}
          target={TARGET}
          view="files"
        />
      );
    });
    act(() => {
      findButtonByTitle(container, "assets/logo.png").click();
    });

    await act(async () => {
      second.resolve(
        createCommitDiff(
          "assets/logo.png",
          "Binary files differ",
          true
        )
      );
      await flushAsyncWork();
    });
    await act(async () => {
      first.resolve(
        createCommitDiff(
          "src/App.tsx",
          "@@ -1 +1 @@\n-old\n+stale"
        )
      );
      await flushAsyncWork();
    });

    expect(cancelQuery).toHaveBeenCalledTimes(1);
    expect(
      findButtonByTitle(
        container,
        "assets/logo.png"
      ).getAttribute("aria-current")
    ).toBe("true");
    expect(container.textContent).toContain("二进制文件");
    expect(container.textContent).not.toContain("stale");
    expect(
      container
        .querySelector(".commit-detail-body")
        ?.getAttribute("data-history-commit-view")
    ).toBe("files");
  });

  it("previews supported media from the selected commit", async () => {
    const getCommitDiff = vi.fn(
      async (
        request: Parameters<
          GitNestBridge["repository"]["getCommitDiff"]
        >[0]
      ) => ({
        ok: true as const,
        value:
          request.path === "assets/logo.png"
            ? createCommitDiff(
                request.path,
                "Binary files differ",
                true,
                {
                  status: "available",
                  kind: "image",
                  mimeType: "image/png",
                  size: 4,
                  content: Uint8Array.from([0, 1, 2, 3])
                }
              )
            : createCommitDiff(
                request.path,
                "@@ -1 +1 @@\n-old\n+new"
              )
      })
    );
    installBridge({ getCommitDiff });

    act(() => {
      root.render(
        <RepositoryCommitDetail
          commit={COMMIT}
          target={TARGET}
          view="files"
        />
      );
    });
    await act(async () => {
      await flushAsyncWork();
    });
    await act(async () => {
      findButtonByTitle(container, "assets/logo.png").click();
      await flushAsyncWork();
    });

    const preview = container.querySelector<HTMLImageElement>(
      'img[alt="assets/logo.png 图片预览"]'
    );
    expect(preview?.src).toBe("blob:commit-media-preview");
    expect(
      container.querySelector(
        '.diff-viewer-code[aria-label="文件预览"]'
      )
    ).not.toBeNull();
    expect(container.textContent).not.toContain(
      "二进制文件不在 Renderer 中加载内容"
    );
  });

  it("retries a failed context expansion without hiding the existing diff", async () => {
    const getCommitDiff = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        value: createCommitDiff(
          "src/App.tsx",
          "@@ -1 +1 @@\n-oldValue\n+newValue"
        )
      })
      .mockResolvedValueOnce({
        ok: false as const,
        error: {
          code: "COMMAND_FAILED" as const,
          message: "temporary failure",
          details: {}
        }
      })
      .mockResolvedValueOnce({
        ok: true as const,
        value: createCommitDiff(
          "src/App.tsx",
          "@@ -1 +1 @@\n-oldValue\n+expandedValue"
        )
      });
    installBridge({ getCommitDiff });

    act(() => {
      root.render(
        <RepositoryCommitDetail
          commit={COMMIT}
          target={TARGET}
          view="files"
        />
      );
    });
    await act(async () => {
      await flushAsyncWork();
    });

    await act(async () => {
      findButtonByLabel(
        container,
        "展开第 1 个变更块上下各 10 行"
      ).click();
      await flushAsyncWork();
    });

    expect(getCommitDiff).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("temporary failure");
    expect(container.textContent).toContain("newValue");

    await act(async () => {
      findButtonByText(container, "重试").click();
      await flushAsyncWork();
    });

    expect(getCommitDiff).toHaveBeenCalledTimes(3);
    expect(getCommitDiff).toHaveBeenLastCalledWith({
      queryId: expect.stringMatching(/^commit_diff_/),
      target: TARGET,
      commitHash: COMMIT_HASH,
      path: "src/App.tsx",
      contextLines: 10
    });
    expect(container.textContent).toContain("expandedValue");
  });
});

function CommitDetailBreadcrumbHarness() {
  const [view, setView] = React.useState<
    "details" | "files"
  >("details");

  return (
    <RepositoryCommitDetailBreadcrumb
      additions={4}
      deletions={2}
      fileCount={2}
      onViewChange={setView}
      view={view}
    />
  );
}

function installBridge(
  repository: Partial<GitNestBridge["repository"]>
): void {
  Object.defineProperty(window, "gitnest", {
    configurable: true,
    value: {
      repository: {
        cancelQuery: vi.fn(async () => ({
          ok: true as const,
          value: undefined
        })),
        ...repository
      }
    } as unknown as GitNestBridge
  });
}

function createCommitDiff(
  path: string,
  content: string,
  binary = false,
  media?: RepositoryMediaPreviewDto
): RepositoryCommitDiffDto {
  return {
    target: TARGET,
    commit: {
      hash: COMMIT_HASH
    },
    diff: {
      path,
      content,
      binary,
      truncated: false,
      additions: binary ? 0 : 1,
      deletions: binary ? 0 : 1,
      ...(media ? { media } : {})
    }
  };
}

function findButtonByTitle(
  rootNode: ParentNode,
  title: string
): HTMLButtonElement {
  const button = rootNode.querySelector<HTMLButtonElement>(
    `button[title="${title}"]`
  );
  if (!button) {
    throw new Error(`Button not found: ${title}`);
  }
  return button;
}

function findButtonByLabel(
  rootNode: ParentNode,
  label: string
): HTMLButtonElement {
  const button = rootNode.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`
  );
  if (!button) {
    throw new Error(`Button not found: ${label}`);
  }
  return button;
}

function findButtonByText(
  rootNode: ParentNode,
  text: string
): HTMLButtonElement {
  const button = [...rootNode.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === text
  );
  if (!button) {
    throw new Error(`Button not found: ${text}`);
  }
  return button;
}

function findViewButton(
  rootNode: ParentNode,
  view: "details" | "files"
): HTMLButtonElement {
  const button = rootNode.querySelector<HTMLButtonElement>(
    `button[data-history-commit-view="${view}"]`
  );
  if (!button) {
    throw new Error(`Commit detail view button not found: ${view}`);
  }
  return button;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

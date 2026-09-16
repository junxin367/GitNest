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

import { DiffPanel } from "./DiffPanel";
import {
  repositoryDiffWorkspaceConfiguration,
  standaloneDiffWorkspaceConfiguration
} from "./diffWorkspaceConfiguration";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

const content = [
  "diff --git a/src/App.tsx b/src/App.tsx",
  "index 1111111..2222222 100644",
  "--- a/src/App.tsx",
  "+++ b/src/App.tsx",
  "@@ -1 +1 @@",
  "-const oldValue = true;",
  "+const newValue = true;"
].join("\n");

const compactMultiHunkContent = [
  "@@ -4,7 +4,7 @@",
  " line 4",
  " line 5",
  " line 6",
  "-old line 7",
  "+new line 7",
  " line 8",
  " line 9",
  " line 10",
  "@@ -20,7 +20,7 @@",
  " line 20",
  " line 21",
  " line 22",
  "-old line 23",
  "+new line 23",
  " line 24",
  " line 25",
  " line 26"
].join("\n");

const expandedMultiHunkContent = [
  "@@ -1,29 +1,29 @@",
  " line 1",
  " line 2",
  " line 3",
  " line 4",
  " line 5",
  " line 6",
  "-old line 7",
  "+new line 7",
  " line 8",
  " line 9",
  " line 10",
  " line 11",
  " line 12",
  " line 13",
  " line 14",
  " line 15",
  " line 16",
  " line 17",
  " line 18",
  " line 19",
  " line 20",
  " line 21",
  " line 22",
  "-old line 23",
  "+new line 23",
  " line 24",
  " line 25",
  " line 26",
  " line 27",
  " line 28",
  " line 29"
].join("\n");

describe("DiffPanel configuration", () => {
  let container: HTMLDivElement;
  let root: Root;
  let createObjectUrlDescriptor:
    | PropertyDescriptor
    | undefined;
  let revokeObjectUrlDescriptor:
    | PropertyDescriptor
    | undefined;
  let createObjectUrlMock: ReturnType<typeof vi.fn>;
  let revokeObjectUrlMock: ReturnType<typeof vi.fn>;

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
    let objectUrlSequence = 0;
    createObjectUrlMock = vi.fn(
      () => `blob:media-preview-${++objectUrlSequence}`
    );
    revokeObjectUrlMock = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrlMock
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrlMock
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
  });

  it("keeps the standalone layout controls from the Diff window", () => {
    act(() => {
      root.render(
        <DiffPanel
          additions={1}
          config={standaloneDiffWorkspaceConfiguration.document}
          content={content}
          deletions={1}
          path="src/App.tsx"
          scopeKey="unstaged:src/App.tsx"
        />
      );
    });

    expect(findButton(container, "统一").dataset.selected).toBe(
      "true"
    );
    expect(findButton(container, "并排")).toBeDefined();
    expect(findButton(container, "自动换行")).toBeDefined();
  });

  it("uses one unified layout for repositories and exposes extensions as slots", () => {
    act(() => {
      root.render(
        <DiffPanel
          additions={1}
          config={repositoryDiffWorkspaceConfiguration.document}
          content={content}
          deletions={1}
          headerActions={
            <button type="button">打开独立 Diff</button>
          }
          path="src/App.tsx"
          scopeKey="unstaged:src/App.tsx"
        />
      );
    });

    expect(
      container.querySelector(".diff-viewer-toolbar")
    ).toBeNull();
    expect(
      container.querySelector(".diff-viewer-unified")
    ).not.toBeNull();
    expect(
      container.querySelector<HTMLElement>(
        '[role="region"][aria-label="文件 Diff"]'
      )?.tabIndex
    ).toBe(0);
    expect(container.textContent).not.toContain("diff --git");
    expect(container.textContent).not.toContain("index 1111111");
    expect(container.textContent).not.toContain("--- a/");
    expect(container.textContent).not.toContain("+++ b/");
    expect(findButton(container, "打开独立 Diff")).toBeDefined();
  });

  it("renders a diff-shaped skeleton while content is loading", () => {
    act(() => {
      root.render(
        <DiffPanel
          config={repositoryDiffWorkspaceConfiguration.document}
          path="src/App.tsx"
          scopeKey="unstaged:src/App.tsx"
          statsAvailable={false}
          state={{
            busy: true,
            icon: "refresh",
            message: "正在读取所选文件内容。",
            title: "读取 Diff…"
          }}
        />
      );
    });

    const region = container.querySelector<HTMLElement>(
      '[role="region"][aria-label="文件 Diff"]'
    );
    expect(region?.getAttribute("aria-busy")).toBe("true");
    expect(
      region?.querySelector(".diff-content-skeleton")
    ).not.toBeNull();
    expect(
      region?.querySelectorAll(
        ".diff-workspace-skeleton-code-row"
      )
    ).toHaveLength(10);
    expect(container.textContent).not.toContain("读取 Diff…");
  });

  it("omits the empty stats placeholder and its separator", () => {
    act(() => {
      root.render(
        <DiffPanel
          config={repositoryDiffWorkspaceConfiguration.document}
          emptyStatsLabel=""
          headerActions={
            <button type="button">打开独立 Diff</button>
          }
          path="src/App.tsx"
          scopeKey="unstaged:src/App.tsx"
          statsAvailable={false}
          state={{
            busy: true,
            icon: "refresh",
            message: "正在读取所选文件内容。",
            title: "读取 Diff…"
          }}
        />
      );
    });

    expect(
      container.querySelector(".diff-viewer-stats.muted")
    ).toBeNull();
    expect(
      container.querySelector(
        ".diff-viewer-file-header-separator"
      )
    ).toBeNull();
    expect(findButton(container, "打开独立 Diff")).toBeDefined();
  });

  it("remembers search queries for each repository scope", () => {
    const renderPanel = (
      scopeKey: string,
      searchScopeKey: string
    ) => {
      act(() => {
        root.render(
          <DiffPanel
            config={repositoryDiffWorkspaceConfiguration.document}
            content={content}
            path="src/App.tsx"
            scopeKey={scopeKey}
            searchScopeKey={searchScopeKey}
          />
        );
      });
    };

    renderPanel("unstaged:src/App.tsx", "repository-a");
    const repositoryAInput = openDiffSearch(container);
    setInputValue(repositoryAInput, "first repository");

    renderPanel("unstaged:src/App.tsx", "repository-b");
    const repositoryBInput = openDiffSearch(container);
    expect(repositoryBInput.value).toBe("");
    setInputValue(repositoryBInput, "second repository");

    renderPanel("unstaged:src/Other.tsx", "repository-a");
    expect(openDiffSearch(container).value).toBe(
      "first repository"
    );

    renderPanel("unstaged:src/App.tsx", "repository-b");
    expect(openDiffSearch(container).value).toBe(
      "second repository"
    );
  });

  it("toggles ten context lines around only the selected hunk", () => {
    const onContextRequest = vi.fn();

    act(() => {
      root.render(
        <DiffPanel
          additions={1}
          config={repositoryDiffWorkspaceConfiguration.document}
          content={compactMultiHunkContent}
          contextLines={3}
          deletions={1}
          onContextRequest={onContextRequest}
          path="src/App.tsx"
          scopeKey="unstaged:src/App.tsx"
        />
      );
    });

    act(() => {
      findHunkContextTrigger(container, 1, "expand").click();
    });
    expect(onContextRequest).toHaveBeenCalledWith({
      direction: "around",
      hunkIndex: 1,
      contextLines: 10
    });

    act(() => {
      root.render(
        <DiffPanel
          additions={1}
          config={repositoryDiffWorkspaceConfiguration.document}
          content={expandedMultiHunkContent}
          contextLines={10}
          deletions={1}
          onContextRequest={onContextRequest}
          path="src/App.tsx"
          scopeKey="unstaged:src/App.tsx"
        />
      );
    });
    expect(readHunkText(container, 0)).not.toContain("line 15");
    expect(readHunkText(container, 1)).toContain("line 15");

    act(() => {
      findHunkContextTrigger(container, 1, "collapse").click();
    });
    expect(onContextRequest).toHaveBeenCalledTimes(1);
    expect(readHunkText(container, 0)).not.toContain("line 15");
    expect(readHunkText(container, 1)).not.toContain("line 15");
    expect(container.textContent).not.toContain("展开本段");
  });

  it("does not expose context expansion for binary or truncated diffs", () => {
    act(() => {
      root.render(
        <DiffPanel
          binary
          config={repositoryDiffWorkspaceConfiguration.document}
          content={content}
          onContextRequest={vi.fn()}
          path="src/App.bin"
          scopeKey="unstaged:src/App.bin"
        />
      );
    });
    expect(
      container.querySelector(".diff-viewer-hunk-trigger")
    ).toBeNull();

    act(() => {
      root.render(
        <DiffPanel
          config={repositoryDiffWorkspaceConfiguration.document}
          content={content}
          onContextRequest={vi.fn()}
          path="src/App.tsx"
          scopeKey="unstaged:src/App.tsx"
          truncated
        />
      );
    });
    expect(
      container.querySelector(".diff-viewer-hunk-trigger")
    ).toBeNull();
  });

  it("renders SVG as an image preview and hides text-only controls", () => {
    act(() => {
      root.render(
        <DiffPanel
          additions={2}
          config={standaloneDiffWorkspaceConfiguration.document}
          content={"<svg></svg>"}
          deletions={1}
          media={{
            status: "available",
            kind: "image",
            mimeType: "image/svg+xml",
            size: 11,
            content: new TextEncoder().encode("<svg></svg>")
          }}
          path="assets/diagram.svg"
          scopeKey="unstaged:assets/diagram.svg"
        />
      );
    });

    const image = container.querySelector<HTMLImageElement>(
      ".diff-viewer-media img"
    );
    expect(image?.getAttribute("src")).toBe(
      "blob:media-preview-1"
    );
    expect(image?.alt).toBe(
      "assets/diagram.svg 图片预览"
    );
    expect(createObjectUrlMock).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector(".diff-viewer-toolbar")
    ).toBeNull();
    expect(
      container.querySelector(".diff-viewer-unified")
    ).toBeNull();
    expect(
      container.querySelector('[aria-label="文件预览"]')
    ).not.toBeNull();

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          ctrlKey: true,
          key: "f"
        })
      );
    });
    expect(
      container.querySelector(
        'input[aria-label="搜索文本"]'
      )
    ).toBeNull();
  });

  it("uses native non-autoplay video and audio controls", () => {
    act(() => {
      root.render(
        <DiffPanel
          config={standaloneDiffWorkspaceConfiguration.document}
          media={{
            status: "available",
            kind: "video",
            mimeType: "video/mp4",
            size: 4,
            content: new Uint8Array([0, 1, 2, 3])
          }}
          path="assets/demo.mp4"
          scopeKey="unstaged:assets/demo.mp4"
        />
      );
    });

    const video =
      container.querySelector<HTMLVideoElement>("video");
    expect(video?.controls).toBe(true);
    expect(video?.autoplay).toBe(false);

    act(() => {
      root.render(
        <DiffPanel
          config={standaloneDiffWorkspaceConfiguration.document}
          media={{
            status: "available",
            kind: "audio",
            mimeType: "audio/mpeg",
            size: 3,
            content: new Uint8Array([4, 5, 6])
          }}
          path="assets/demo.mp3"
          scopeKey="unstaged:assets/demo.mp3"
        />
      );
    });

    const audio =
      container.querySelector<HTMLAudioElement>("audio");
    expect(audio?.controls).toBe(true);
    expect(audio?.autoplay).toBe(false);
    expect(revokeObjectUrlMock).toHaveBeenCalledWith(
      "blob:media-preview-1"
    );
  });

  it("explains why an oversized media file is unavailable", () => {
    act(() => {
      root.render(
        <DiffPanel
          config={repositoryDiffWorkspaceConfiguration.document}
          media={{
            status: "unavailable",
            kind: "video",
            mimeType: "video/mp4",
            reason: "too-large",
            size: 50 * 1024 * 1024 + 1
          }}
          path="assets/demo.mp4"
          scopeKey="untracked:assets/demo.mp4"
        />
      );
    });

    expect(container.textContent).toContain("文件过大");
    expect(container.textContent).toContain("50 MB");
    expect(container.textContent).toContain("外部应用");
    expect(createObjectUrlMock).not.toHaveBeenCalled();
  });
});

function findButton(
  root: ParentNode,
  text: string
): HTMLButtonElement {
  const button = Array.from(
    root.querySelectorAll<HTMLButtonElement>("button")
  ).find((candidate) => candidate.textContent?.trim() === text);
  if (!button) {
    throw new Error(`Button not found: ${text}`);
  }
  return button;
}

function openDiffSearch(root: ParentNode): HTMLInputElement {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        ctrlKey: true,
        key: "f"
      })
    );
  });
  const input = root.querySelector<HTMLInputElement>(
    'input[aria-label="搜索文本"]'
  );
  if (!input) {
    throw new Error("Diff search input was not rendered.");
  }
  return input;
}

function setInputValue(
  input: HTMLInputElement,
  value: string
): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(
      new Event("input", { bubbles: true })
    );
  });
}

function findHunkContextTrigger(
  root: ParentNode,
  hunkIndex: number,
  action: "expand" | "collapse"
): HTMLButtonElement {
  const label =
    action === "expand"
      ? `展开第 ${hunkIndex + 1} 个变更块上下各 10 行`
      : `收起第 ${hunkIndex + 1} 个变更块上下文`;
  const trigger = root.querySelector<HTMLButtonElement>(
    `[aria-label="${label}"]`
  );
  if (!trigger) {
    throw new Error(
      `Hunk context trigger not found: ${action} ${hunkIndex}`
    );
  }
  return trigger;
}

function readHunkText(
  root: ParentNode,
  hunkIndex: number
): string {
  const hunk = root.querySelector<HTMLElement>(
    `[data-diff-viewer-hunk="${hunkIndex}"]`
  );
  if (!hunk) {
    throw new Error(`Hunk not found: ${hunkIndex}`);
  }

  const parts = [hunk.textContent ?? ""];
  let sibling = hunk.nextElementSibling;
  while (
    sibling &&
    !sibling.hasAttribute("data-diff-viewer-hunk")
  ) {
    parts.push(sibling.textContent ?? "");
    sibling = sibling.nextElementSibling;
  }
  return parts.join("\n");
}

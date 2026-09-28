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
  RepositoryStashFilesDto,
  RepositoryStashesDto
} from "@gitnest/contracts";

import { createRepositoryStashContextMenuState } from "./RepositoryStashActions";
import { RepositoryStashBrowser } from "./RepositoryStashBrowser";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

const TARGET = {
  repositoryId: "repository-a",
  worktreeId: "worktree-a"
};

const STASHES: RepositoryStashesDto = {
  target: TARGET,
  stashes: [
    {
      ref: "stash@{0}",
      hash: "abcdef1234567890",
      subject: "WIP on main: update settings",
      authorName: "June",
      authorEmail: "june@example.com",
      authoredAt: "2026-09-16T08:00:00.000Z",
      parentHashes: ["base1234567890"],
      baseHash: "base1234567890",
      files: 2,
      additions: 8,
      deletions: 3
    },
    {
      ref: "stash@{1}",
      hash: "fedcba0987654321",
      subject: "On main: draft navigation",
      authorName: "June",
      authorEmail: "june@example.com",
      authoredAt: "2026-09-15T08:00:00.000Z",
      parentHashes: ["base0987654321"],
      baseHash: "base0987654321",
      files: 1,
      additions: 2,
      deletions: 0
    }
  ]
};

const FILES: RepositoryStashFilesDto = {
  target: TARGET,
  stash: {
    ref: "stash@{0}",
    hash: "abcdef1234567890",
    additions: 8,
    deletions: 3,
    files: [
      {
        path: "src/settings/AppSettings.tsx",
        additions: 8,
        deletions: 3,
        binary: false
      },
      {
        path: "assets/preview.png",
        binary: true
      }
    ]
  }
};

describe("RepositoryStashBrowser", () => {
  let container: HTMLDivElement;
  let root: Root;

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
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders exactly two panes and shows files for the selected stash", () => {
    const onSelectStash = vi.fn();

    act(() => {
      root.render(
        <RepositoryStashBrowser
          error={null}
          loading={{ stashes: false, files: false }}
          selectedStashRef="stash@{0}"
          stashFiles={FILES}
          stashes={STASHES}
          onReload={vi.fn()}
          onSelectStash={onSelectStash}
        />
      );
    });

    const browser = container.querySelector(
      ".repository-stash-browser"
    );
    expect(browser?.children).toHaveLength(2);
    expect(
      Array.from(browser?.children ?? []).every(
        (element) => element.tagName === "DIV"
      )
    ).toBe(true);
    expect(
      container.querySelector(
        '[aria-label="储藏列表"]'
      )
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[aria-label="储藏内容"]'
      )
    ).not.toBeNull();
    expect(
      container.querySelectorAll(".repository-stash-item")
    ).toHaveLength(2);
    expect(
      container.querySelectorAll(".repository-stash-file")
    ).toHaveLength(2);
    expect(container.textContent).toContain(
      "AppSettings.tsx"
    );
    expect(container.textContent).toContain("二进制");
    expect(container.textContent).toContain("+8");
    expect(container.textContent).toContain("-3");

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label^="stash@{1}"]'
        )
        ?.click();
    });
    expect(onSelectStash).toHaveBeenCalledWith("stash@{1}");
  });

  it("filters the selected stash file list without changing selection", () => {
    act(() => {
      root.render(
        <RepositoryStashBrowser
          error={null}
          loading={{ stashes: false, files: false }}
          selectedStashRef="stash@{0}"
          stashFiles={FILES}
          stashes={STASHES}
          onReload={vi.fn()}
          onSelectStash={vi.fn()}
        />
      );
    });

    const filter =
      container.querySelector<HTMLInputElement>(
        '[aria-label="筛选储藏文件"]'
      );
    act(() => {
      if (!filter) {
        throw new Error("Stash file filter was not rendered.");
      }
      setInputValue(filter, "preview");
    });

    expect(
      container.querySelectorAll(".repository-stash-file")
    ).toHaveLength(1);
    expect(container.textContent).toContain("preview.png");
    expect(container.textContent).not.toContain(
      "AppSettings.tsx"
    );
    expect(
      container
        .querySelector('[aria-label^="stash@{0}"]')
        ?.getAttribute("aria-current")
    ).toBe("true");
  });

  it("renders the empty stash state in both panes", () => {
    act(() => {
      root.render(
        <RepositoryStashBrowser
          error={null}
          loading={{ stashes: false, files: false }}
          selectedStashRef={null}
          stashFiles={null}
          stashes={{ target: TARGET, stashes: [] }}
          onReload={vi.fn()}
          onSelectStash={vi.fn()}
        />
      );
    });

    expect(container.textContent).toContain(
      "没有储藏的变更"
    );
    expect(container.textContent).toContain(
      "选择一条储藏记录"
    );
  });

  it("opens the stash action menu on right-click and confirms delete with the complete stash", async () => {
    const onSelectStash = vi.fn();
    const onMutateStash = vi.fn(async () => true);

    act(() => {
      root.render(
        <RepositoryStashBrowser
          error={null}
          loading={{ stashes: false, files: false }}
          selectedStashRef="stash@{0}"
          stashFiles={FILES}
          stashes={STASHES}
          onMutateStash={onMutateStash}
          onReload={vi.fn()}
          onSelectStash={onSelectStash}
        />
      );
    });

    act(() => {
      findStashButton("stash@{1}").dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 80,
          clientY: 120
        })
      );
    });

    expect(onSelectStash).toHaveBeenCalledWith("stash@{1}");
    const menu = document.querySelector<HTMLElement>(
      '[aria-label="stash@{1} 储藏操作"]'
    );
    expect(menu).not.toBeNull();
    const items = Array.from(
      menu?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]'
      ) ?? []
    );
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      "恢复",
      "删除",
      "恢复并删除"
    ]);
    expect(document.activeElement).toBe(items[0]);

    act(() => {
      menu?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "ArrowDown"
        })
      );
    });
    expect(document.activeElement).toBe(items[1]);

    act(() => items[1]?.click());
    expect(
      document.querySelector(
        '[aria-label="stash@{1} 储藏操作"]'
      )
    ).toBeNull();
    const dialog = document.querySelector<HTMLElement>(
      '[role="alertdialog"]'
    );
    expect(dialog?.textContent).toContain(
      "删除 stash@{1}？"
    );
    expect(dialog?.textContent).toContain("永久删除");
    expect(dialog?.textContent).toContain(
      "不会恢复到当前工作区"
    );

    await act(async () => {
      findButtonByText(dialog, "永久删除").click();
      await flushAsyncWork();
    });

    expect(onMutateStash).toHaveBeenCalledWith(
      "drop",
      STASHES.stashes[1]
    );
    expect(
      document.querySelector('[role="alertdialog"]')
    ).toBeNull();
  });

  it("closes the context menu from escape and outside interaction", () => {
    act(() => {
      root.render(
        <RepositoryStashBrowser
          error={null}
          loading={{ stashes: false, files: false }}
          selectedStashRef="stash@{0}"
          stashFiles={FILES}
          stashes={STASHES}
          onMutateStash={vi.fn()}
          onReload={vi.fn()}
          onSelectStash={vi.fn()}
        />
      );
    });

    openContextMenu("stash@{0}");
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Escape"
        })
      );
    });
    expect(
      document.querySelector(
        '[aria-label="stash@{0} 储藏操作"]'
      )
    ).toBeNull();

    openContextMenu("stash@{0}");
    act(() => {
      document.body.dispatchEvent(
        new Event("pointerdown", { bubbles: true })
      );
    });
    expect(
      document.querySelector(
        '[aria-label="stash@{0} 储藏操作"]'
      )
    ).toBeNull();
  });

  it("clamps the context menu to the viewport and closes it when a containing surface scrolls", () => {
    vi.stubGlobal("innerWidth", 240);
    vi.stubGlobal("innerHeight", 180);
    expect(
      createRepositoryStashContextMenuState(
        STASHES.stashes[0]!,
        999,
        999
      )
    ).toMatchObject({
      x: 10,
      y: 40
    });

    act(() => {
      root.render(
        <RepositoryStashBrowser
          error={null}
          loading={{ stashes: false, files: false }}
          selectedStashRef="stash@{0}"
          stashFiles={FILES}
          stashes={STASHES}
          onMutateStash={vi.fn()}
          onReload={vi.fn()}
          onSelectStash={vi.fn()}
        />
      );
    });
    openContextMenu("stash@{0}");
    expect(
      document.querySelector(
        '[aria-label="stash@{0} 储藏操作"]'
      )
    ).not.toBeNull();

    act(() => {
      container.dispatchEvent(
        new Event("scroll", { bubbles: false })
      );
    });
    expect(
      document.querySelector(
        '[aria-label="stash@{0} 储藏操作"]'
      )
    ).toBeNull();
  });

  it("describes pop conflict safety and disables dialog actions while a mutation is busy", () => {
    const onMutateStash = vi.fn();
    const render = (mutationBusy: boolean) => {
      root.render(
        <RepositoryStashBrowser
          error={null}
          loading={{ stashes: false, files: false }}
          mutationBusy={mutationBusy}
          selectedStashRef="stash@{0}"
          stashFiles={FILES}
          stashes={STASHES}
          onMutateStash={onMutateStash}
          onReload={vi.fn()}
          onSelectStash={vi.fn()}
        />
      );
    };

    act(() => render(false));
    openContextMenu("stash@{0}");
    const menu = document.querySelector<HTMLElement>(
      '[aria-label="stash@{0} 储藏操作"]'
    );
    act(() => {
      findButtonByText(menu, "恢复并删除").click();
    });

    const dialog = document.querySelector<HTMLElement>(
      '[role="alertdialog"]'
    );
    expect(dialog?.textContent).toContain(
      "仅在恢复成功后才会删除储藏记录"
    );
    expect(dialog?.textContent).toContain(
      "发生冲突，Git 会保留这条储藏记录"
    );

    act(() => render(true));
    const busyDialog = document.querySelector<HTMLElement>(
      '[role="alertdialog"]'
    );
    expect(
      findButtonByText(busyDialog, "取消").disabled
    ).toBe(true);
    expect(
      findButtonByText(busyDialog, "处理中…").disabled
    ).toBe(true);
    expect(onMutateStash).not.toHaveBeenCalled();
  });
});

function findStashButton(stashRef: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(
    `[aria-label^="${stashRef}"]`
  );
  if (!button) {
    throw new Error(`Stash button ${stashRef} was not rendered.`);
  }
  return button;
}

function openContextMenu(stashRef: string): void {
  act(() => {
    findStashButton(stashRef).dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 40,
        clientY: 60
      })
    );
  });
}

function findButtonByText(
  parent: ParentNode | null,
  text: string
): HTMLButtonElement {
  const button = Array.from(
    parent?.querySelectorAll<HTMLButtonElement>("button") ?? []
  ).find((candidate) => candidate.textContent?.trim() === text);
  if (!button) {
    throw new Error(`Button "${text}" was not rendered.`);
  }
  return button;
}

function setInputValue(
  input: HTMLInputElement,
  value: string
): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(
    new Event("input", {
      bubbles: true
    })
  );
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

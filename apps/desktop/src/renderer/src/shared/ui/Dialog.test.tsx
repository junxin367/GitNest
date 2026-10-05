/** @vitest-environment jsdom */

import {
  act,
  type ReactNode
} from "react";
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

import { Button } from "./Button";
import { Dialog } from "./Dialog";

describe("Dialog", () => {
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

  it("renders the shared single-title structure and actions-only footer", () => {
    renderDialog(
      <Dialog
        ariaDescribedBy="dialog-warning"
        footer={<Button>确认</Button>}
        icon="warning"
        role="alertdialog"
        size="target"
        title="删除 Workspace"
        tone="danger"
      >
        <p id="dialog-warning">删除后无法撤销。</p>
      </Dialog>
    );

    const dialog = document.querySelector<HTMLElement>(
      '[role="alertdialog"]'
    );
    expect(dialog).not.toBeNull();
    expect(dialog?.dataset.size).toBe("target");
    expect(dialog?.dataset.tone).toBe("danger");
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    const title = dialog?.querySelector(
      ".gn-dialog__header h2"
    );
    expect(
      title?.textContent
    ).toBe("删除 Workspace");
    expect(dialog?.getAttribute("aria-labelledby")).toBe(
      title?.id
    );
    expect(
      dialog?.querySelector(".gn-dialog__header p")
    ).toBeNull();
    expect(
      dialog?.querySelector(".gn-dialog__header .eyebrow")
    ).toBeNull();
    expect(
      dialog?.querySelector(".gn-dialog__footer p")
    ).toBeNull();
    expect(
      dialog?.querySelector(".gn-dialog__actions")
        ?.textContent
    ).toBe("确认");
    expect(dialog?.getAttribute("aria-describedby")).toBe(
      "dialog-warning"
    );
  });

  it("omits empty body and footer regions", () => {
    renderDialog(
      <Dialog footer={false} icon="activity" title="提示">
        {null}
      </Dialog>
    );

    const dialog =
      document.querySelector<HTMLElement>(".gn-dialog");
    expect(dialog?.querySelector(".gn-dialog__body")).toBeNull();
    expect(
      dialog?.querySelector(".gn-dialog__footer")
    ).toBeNull();
  });

  it("supports backdrop clicks, the close control and Escape without dismissing from content clicks", () => {
    const onDismiss = vi.fn();
    renderDialog(
      <Dialog
        footer={<Button>取消</Button>}
        icon="branch"
        onDismiss={onDismiss}
        showCloseButton
        size="compact"
        title="切换分支"
      >
        分支列表
      </Dialog>
    );

    const close = document.querySelector<HTMLButtonElement>(
      ".gn-dialog__close"
    );
    expect(close?.getAttribute("aria-label")).toBe("关闭弹窗");
    expect(container.querySelector(".gn-dialog")).toBeNull();

    act(() => {
      document.querySelector<HTMLElement>(".gn-dialog")?.click();
      document.querySelector<HTMLElement>(".gn-dialog__header h2")?.click();
      document.querySelector<HTMLElement>(".gn-dialog__body")?.click();
      document.querySelector<HTMLElement>(".gn-dialog__footer button")?.click();
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      document
        .querySelector<HTMLElement>(".gn-dialog-backdrop")
        ?.click();
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape" })
      );
    });
    expect(onDismiss).toHaveBeenCalledTimes(2);

    act(() => close?.click());
    expect(onDismiss).toHaveBeenCalledTimes(3);
  });

  it.each([{ isComposing: true }, { keyCode: 229 }])(
    "does not dismiss an editing dialog when Escape belongs to the input method (%j)",
    (composition) => {
      const onDismiss = vi.fn();
      renderDialog(
        <Dialog icon="settings" title="修改名称" onDismiss={onDismiss}>
          <input data-modal-initial-focus aria-label="名称" />
        </Dialog>
      );
      const input = document.querySelector<HTMLInputElement>('input[aria-label="名称"]')!;
      act(() => input.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape", bubbles: true, cancelable: true, ...composition
      })));
      expect(onDismiss).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(input);
      act(() => input.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape", bubbles: true, cancelable: true
      })));
      expect(onDismiss).toHaveBeenCalledOnce();
    }
  );

  it.each([true, false])("keeps a dialog open when a pointer gesture crosses its boundary (starts inside: %s)", (startsInside) => {
    const onDismiss = vi.fn();
    renderDialog(
      <Dialog icon="settings" title="修改名称" onDismiss={onDismiss}>
        <input aria-label="名称" />
      </Dialog>
    );
    const input = document.querySelector<HTMLInputElement>('input[aria-label="名称"]')!;
    const backdrop = document.querySelector<HTMLElement>(".gn-dialog-backdrop")!;
    act(() => {
      (startsInside ? input : backdrop).dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      (startsInside ? backdrop : input).dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
      // Chromium targets the common ancestor when press and release differ.
      backdrop.click();
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      backdrop.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      backdrop.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
      backdrop.click();
    });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("keeps dismissal locked while the dialog is busy", () => {
    const onDismiss = vi.fn();
    renderDialog(
      <Dialog
        dismissDisabled
        footer={<Button>取消</Button>}
        icon="operations"
        onDismiss={onDismiss}
        showCloseButton
        title="执行操作"
      >
        正在处理
      </Dialog>
    );

    act(() => {
      document.querySelector<HTMLElement>(".gn-dialog-backdrop")?.click();
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape" })
      );
    });
    expect(onDismiss).not.toHaveBeenCalled();
    expect(
      document.querySelector<HTMLButtonElement>(
        ".gn-dialog__close"
      )?.disabled
    ).toBe(true);
  });

  function renderDialog(dialog: ReactNode) {
    act(() => {
      root.render(dialog);
    });
  }
});

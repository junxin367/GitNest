/** @vitest-environment jsdom */

import React, {
  act,
  useRef
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
  it
} from "vitest";

import { useModalFocusTrap } from "./useModalFocusTrap";

describe("useModalFocusTrap", () => {
  let container: HTMLDivElement;
  let root: Root;
  let trigger: HTMLButtonElement;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    trigger = document.createElement("button");
    trigger.textContent = "Open";
    document.body.append(trigger);
    trigger.focus();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    trigger.remove();
  });

  it("sets initial focus, traps both Tab directions, and restores the trigger", () => {
    act(() => {
      root.render(<Dialog />);
    });
    const cancel = button("Cancel");
    const confirm = button("Confirm");
    expect(document.activeElement).toBe(confirm);

    confirm.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "Tab"
      })
    );
    expect(document.activeElement).toBe(cancel);

    cancel.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "Tab",
        shiftKey: true
      })
    );
    expect(document.activeElement).toBe(confirm);

    act(() => {
      root.render(null);
    });
    expect(document.activeElement).toBe(trigger);
  });

  function button(label: string): HTMLButtonElement {
    const candidate = [
      ...container.querySelectorAll("button")
    ].find(
      (element) => element.textContent === label
    );
    if (!(candidate instanceof HTMLButtonElement)) {
      throw new Error(`Missing button ${label}.`);
    }
    return candidate;
  }
});

function Dialog() {
  const dialogRef = useRef<HTMLElement>(null);
  useModalFocusTrap(dialogRef);

  return (
    <section ref={dialogRef} role="dialog">
      <button type="button">Cancel</button>
      <button
        data-modal-initial-focus
        type="button"
      >
        Confirm
      </button>
    </section>
  );
}

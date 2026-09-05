import {
  type RefObject,
  useLayoutEffect
} from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

export function useModalFocusTrap(
  dialogRef: RefObject<HTMLElement | null>
): void {
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousModalOpen =
      document.documentElement.dataset.modalOpen;
    document.documentElement.dataset.modalOpen = "true";
    const inertedSiblings = inertOutsideDialog(dialog);
    const lockedScrollers = lockScrollableRegions();
    const initialFocus =
      dialog.querySelector<HTMLElement>(
        "[data-modal-initial-focus]"
      ) ??
      readFocusableElements(dialog)[0] ??
      dialog;
    if (initialFocus === dialog) {
      dialog.tabIndex = -1;
    }
    initialFocus.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") {
        return;
      }
      const focusable = readFocusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        return;
      }
      const active = document.activeElement;
      if (
        event.shiftKey &&
        (active === first || !dialog.contains(active))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (active === last || !dialog.contains(active))
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener(
        "keydown",
        handleKeyDown
      );
      for (const { element, inert } of inertedSiblings) {
        element.inert = inert;
      }
      for (const {
        element,
        overflow,
        paddingRight
      } of lockedScrollers) {
        element.style.overflow = overflow;
        element.style.paddingRight = paddingRight;
      }
      if (previousModalOpen === undefined) {
        delete document.documentElement.dataset.modalOpen;
      } else {
        document.documentElement.dataset.modalOpen =
          previousModalOpen;
      }
      if (
        previousFocus?.isConnected &&
        !previousFocus.hasAttribute("disabled")
      ) {
        previousFocus.focus();
      }
    };
  }, [dialogRef]);
}

function readFocusableElements(
  dialog: HTMLElement
): HTMLElement[] {
  return [
    ...dialog.querySelectorAll<HTMLElement>(
      FOCUSABLE_SELECTOR
    )
  ].filter(
    (element) =>
      !element.hidden &&
      !element.closest("[hidden], [aria-hidden='true']")
  );
}

function inertOutsideDialog(
  dialog: HTMLElement
): Array<{ element: HTMLElement; inert: boolean }> {
  const result: Array<{
    element: HTMLElement;
    inert: boolean;
  }> = [];
  let activeBranch: HTMLElement | null =
    dialog.closest<HTMLElement>(".command-dialog-backdrop") ??
    dialog;

  while (activeBranch && activeBranch !== document.body) {
    const parent: HTMLElement | null =
      activeBranch.parentElement;
    if (!parent) {
      break;
    }
    for (const sibling of parent.children) {
      if (
        sibling !== activeBranch &&
        sibling instanceof HTMLElement
      ) {
        result.push({
          element: sibling,
          inert: Boolean(sibling.inert)
        });
        sibling.inert = true;
      }
    }
    activeBranch = parent;
  }

  return result;
}

function lockScrollableRegions(): Array<{
  element: HTMLElement;
  overflow: string;
  paddingRight: string;
}> {
  return [
    ...document.querySelectorAll<HTMLElement>(
      ".page-scroll, .inspector, .repository-list"
    )
  ].map((element) => {
    const computed = getComputedStyle(element);
    const borderWidth =
      (Number.parseFloat(computed.borderLeftWidth) || 0) +
      (Number.parseFloat(computed.borderRightWidth) || 0);
    const scrollbarWidth = Math.max(
      0,
      element.offsetWidth -
        element.clientWidth -
        borderWidth
    );
    const previous = {
      element,
      overflow: element.style.overflow,
      paddingRight: element.style.paddingRight
    };

    element.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      element.style.paddingRight = `${
        (Number.parseFloat(computed.paddingRight) || 0) +
        scrollbarWidth
      }px`;
    }
    return previous;
  });
}

/**
 * GitNest 下拉组件：
 *   const dropdowns = GitNestDropdown.createDropdownManager();
 *   const dropdown = dropdowns.register({
 *     id: "repository-filter",
 *     trigger: button,
 *     menu: panel,
 *     placement: { side: "bottom", align: "start" }
 *   });
 *   dropdown.open();
 *
 * 原生 <details> 可使用 dropdowns.bindDetails(details) 接入同一套定位、
 * 互斥、Esc、外点关闭、方向键和焦点恢复逻辑。
 */
(function attachGitNestDropdown(global) {
  const MENU_ITEM_SELECTOR = '[role^="menuitem"]:not(:disabled)';

  function resolveElement(value, document) {
    if (!value) return null;
    return typeof value === "string" ? document.querySelector(value) : value;
  }

  function resolveMenuPlacement(anchorRect, menuRect, options = {}) {
    const {
      side = "bottom",
      align = "start",
      gap = 4,
      viewportPadding = 8
    } = options;
    const viewportWidth = global.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = global.innerHeight || document.documentElement.clientHeight;
    const sideFits = {
      right: anchorRect.right + gap + menuRect.width <= viewportWidth - viewportPadding,
      left: anchorRect.left - gap - menuRect.width >= viewportPadding,
      bottom: anchorRect.bottom + gap + menuRect.height <= viewportHeight - viewportPadding,
      top: anchorRect.top - gap - menuRect.height >= viewportPadding
    };
    const oppositeSide = {
      right: "left",
      left: "right",
      bottom: "top",
      top: "bottom"
    };
    const resolvedSide = sideFits[side] ? side : oppositeSide[side];
    const alignPosition = (start, end, size) => {
      if (align === "end") return end - size;
      if (align === "center") return start + (end - start - size) / 2;
      return start;
    };
    const rawLeft = resolvedSide === "right"
      ? anchorRect.right + gap
      : resolvedSide === "left"
        ? anchorRect.left - menuRect.width - gap
        : alignPosition(anchorRect.left, anchorRect.right, menuRect.width);
    const rawTop = resolvedSide === "bottom"
      ? anchorRect.bottom + gap
      : resolvedSide === "top"
        ? anchorRect.top - menuRect.height - gap
        : alignPosition(anchorRect.top, anchorRect.bottom, menuRect.height);
    const clamp = (value, size, viewportSize) => Math.min(
      Math.max(viewportPadding, value),
      Math.max(viewportPadding, viewportSize - size - viewportPadding)
    );

    return {
      left: clamp(rawLeft, menuRect.width, viewportWidth),
      top: clamp(rawTop, menuRect.height, viewportHeight),
      side: resolvedSide
    };
  }

  class DropdownController {
    constructor(manager, options) {
      this.manager = manager;
      this.id = options.id;
      this.trigger = options.trigger;
      this.menu = options.menu;
      this.details = options.details || null;
      this.placement = options.placement || {};
      this.restoreFocus = options.restoreFocus !== false;
      this.autoToggle = options.autoToggle === true;
      this.onOpen = options.onOpen;
      this.onClose = options.onClose;
      this._lastNativeState = false;
      this.handleMenuKeydown = this.handleMenuKeydown.bind(this);
      this.handleTriggerClick = this.handleTriggerClick.bind(this);
      this.handleNativeToggle = this.handleNativeToggle.bind(this);

      this.menu?.addEventListener("keydown", this.handleMenuKeydown);
      if (this.autoToggle) {
        this.trigger?.addEventListener("click", this.handleTriggerClick);
      }
      if (this.details) {
        this.details.addEventListener("toggle", this.handleNativeToggle);
        this.setAriaExpanded(Boolean(this.details.open));
      }
    }

    get isOpen() {
      return this.details ? Boolean(this.details.open) : Boolean(this.menu && !this.menu.hidden);
    }

    handleTriggerClick(event) {
      event.preventDefault();
      this.toggle();
    }

    handleNativeToggle() {
      const nextState = Boolean(this.details?.open);
      if (nextState === this._lastNativeState) return;
      this._lastNativeState = nextState;
      if (nextState) {
        this.manager.closeOthers(this.id, { restoreFocus: false });
        this.setAriaExpanded(true);
        this.reposition();
        this.onOpen?.(this);
      } else {
        this.setAriaExpanded(false);
        this.onClose?.(this);
      }
    }

    setAriaExpanded(expanded) {
      this.trigger?.setAttribute("aria-expanded", String(expanded));
    }

    open({ focus = true } = {}) {
      this.manager.closeOthers(this.id, { restoreFocus: false });
      if (this.details) {
        this.details.open = true;
        this._lastNativeState = true;
      } else if (this.menu) {
        this.menu.hidden = false;
      }
      this.setAriaExpanded(true);
      this.reposition();
      this.onOpen?.(this);
      if (focus) {
        global.requestAnimationFrame?.(() => this.focusFirstItem());
      }
      return this;
    }

    close({ restoreFocus = this.restoreFocus } = {}) {
      if (this.details) {
        this.details.open = false;
        this._lastNativeState = false;
      } else if (this.menu) {
        this.menu.hidden = true;
      }
      this.setAriaExpanded(false);
      this.onClose?.(this);
      if (restoreFocus && this.trigger?.isConnected) {
        this.trigger.focus({ preventScroll: true });
      }
      return this;
    }

    toggle(options = {}) {
      return this.isOpen ? this.close(options) : this.open(options);
    }

    reposition() {
      if (!this.isOpen || !this.menu || !this.trigger) return;
      this.menu.style.position = "fixed";
      const placement = resolveMenuPlacement(
        this.trigger.getBoundingClientRect(),
        this.menu.getBoundingClientRect(),
        this.placement
      );
      this.menu.style.left = `${placement.left}px`;
      this.menu.style.top = `${placement.top}px`;
      this.menu.dataset.menuSide = placement.side;
    }

    getItems() {
      if (!this.menu) return [];
      return [...this.menu.querySelectorAll(MENU_ITEM_SELECTOR)].filter(
        (item) => item.closest(".menu-surface") === this.menu
      );
    }

    focusFirstItem() {
      const items = this.getItems();
      const selected = items.find((item) =>
        item.getAttribute("aria-checked") === "true" ||
        item.getAttribute("aria-selected") === "true" ||
        item.dataset.selected === "true"
      );
      (selected || items[0])?.focus();
    }

    handleMenuKeydown(event) {
      const items = this.getItems();
      if (!items.length) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.close({ restoreFocus: true });
        return;
      }
      const currentIndex = items.indexOf(event.target);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        const nextIndex = event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : (currentIndex + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        event.preventDefault();
        event.stopPropagation();
        items[nextIndex]?.focus();
        return;
      }
      if ((event.key === "Enter" || event.key === " ") && items.includes(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        event.target.click();
      }
    }

    destroy() {
      this.menu?.removeEventListener("keydown", this.handleMenuKeydown);
      this.trigger?.removeEventListener("click", this.handleTriggerClick);
      this.details?.removeEventListener("toggle", this.handleNativeToggle);
      this.menu?.removeAttribute("data-menu-side");
    }
  }

  class DropdownManager {
    constructor({ document = global.document, window = global } = {}) {
      this.document = document;
      this.window = window;
      this.controllers = new Map();
      this.handlePointerDown = this.handlePointerDown.bind(this);
      this.handleKeydown = this.handleKeydown.bind(this);
      this.repositionAll = this.repositionAll.bind(this);
      document.addEventListener("pointerdown", this.handlePointerDown);
      document.addEventListener("keydown", this.handleKeydown);
      window.addEventListener("resize", this.repositionAll);
      window.addEventListener("scroll", this.repositionAll, true);
    }

    register(options) {
      const trigger = resolveElement(options.trigger, this.document);
      const menu = resolveElement(options.menu, this.document);
      if (!options.id || !trigger || !menu) {
        throw new Error("Dropdown requires id, trigger and menu.");
      }
      this.unregister(options.id);
      const controller = new DropdownController(this, {
        ...options,
        trigger,
        menu
      });
      this.controllers.set(options.id, controller);
      return controller;
    }

    bindDetails(details, options = {}) {
      if (!details) return null;
      const id = options.id || details.dataset.dropdownId || details;
      const existing = this.controllers.get(id);
      if (existing && existing.details === details) {
        existing.placement = options.placement || existing.placement;
        return existing;
      }
      const controller = this.register({
        ...options,
        id,
        details,
        trigger: options.trigger || details.querySelector("summary"),
        menu: options.menu || details.querySelector(".menu-surface"),
        autoToggle: false
      });
      if (details.open) controller.handleNativeToggle();
      return controller;
    }

    get(id) {
      return this.controllers.get(id) || null;
    }

    unregister(id, { close = true } = {}) {
      const controller = this.controllers.get(id);
      if (!controller) return;
      if (close) controller.close({ restoreFocus: false });
      controller.destroy();
      this.controllers.delete(id);
    }

    closeOthers(exceptId = null, options = {}) {
      this.controllers.forEach((controller, id) => {
        if (id !== exceptId && controller.isOpen) {
          controller.close(options);
        }
      });
    }

    closeAll(options = {}) {
      this.closeOthers(null, options);
    }

    repositionAll() {
      this.controllers.forEach((controller) => controller.reposition());
    }

    handlePointerDown(event) {
      const target = event.target;
      this.controllers.forEach((controller) => {
        if (!controller.isOpen) return;
        if (
          target instanceof Node &&
          (controller.trigger.contains(target) || controller.menu.contains(target))
        ) {
          return;
        }
        controller.close({ restoreFocus: false });
      });
    }

    handleKeydown(event) {
      if (event.key !== "Escape") return;
      const openController = [...this.controllers.values()].find(
        (controller) => controller.isOpen
      );
      if (!openController) return;
      event.preventDefault();
      openController.close({ restoreFocus: true });
    }

    destroy() {
      this.document.removeEventListener("pointerdown", this.handlePointerDown);
      this.document.removeEventListener("keydown", this.handleKeydown);
      this.window.removeEventListener("resize", this.repositionAll);
      this.window.removeEventListener("scroll", this.repositionAll, true);
      this.controllers.forEach((controller) => controller.destroy());
      this.controllers.clear();
    }
  }

  global.GitNestDropdown = {
    DropdownController,
    DropdownManager,
    createDropdownManager(options) {
      return new DropdownManager(options);
    }
  };
})(window);

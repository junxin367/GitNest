/**
 * GitNest Diff 搜索浮层组件。
 *
 * 组件负责：
 * - 规范化输入框、匹配计数和连续图标操作；
 * - Enter / Shift+Enter 切换匹配；
 * - Escape 关闭；
 * - 打开、计数和导航禁用态同步。
 *
 * 页面负责搜索匹配、当前匹配索引和滚动定位。
 *
 * const search = GitNestDiffSearchPopover.create({
 *   id: "diffSearchPanel",
 *   inputId: "diffSearch",
 *   open: false,
 *   icons: {
 *     search: icon("search"),
 *     previous: icon("arrowUp"),
 *     next: icon("arrowDown"),
 *     close: icon("x")
 *   },
 *   onInput: (value) => updateSearch(value),
 *   onPrevious: () => moveSearch(-1),
 *   onNext: () => moveSearch(1),
 *   onClose: () => closeSearch()
 * });
 *
 * mount.replaceChildren(search.element);
 * search.update({ open: true, countLabel: "2 / 8", hasMatches: true });
 */
(function attachGitNestDiffSearchPopover(global) {
  const controllers = new WeakMap();

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function serializeMarkup(value) {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (global.Element && value instanceof global.Element) {
      return value.outerHTML;
    }
    return "";
  }

  function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  function requirePrimitives() {
    if (!global.GitNestInput?.create || !global.GitNestButton?.create) {
      throw new Error(
        "GitNestDiffSearchPopover requires GitNestInput and GitNestButton."
      );
    }
  }

  function normalizeOptions(rawOptions = {}) {
    const icons = rawOptions.icons || {};
    return {
      ...rawOptions,
      id: rawOptions.id || "",
      inputId: rawOptions.inputId || "",
      countId: rawOptions.countId || "",
      previousButtonId: rawOptions.previousButtonId || "",
      nextButtonId: rawOptions.nextButtonId || "",
      closeButtonId: rawOptions.closeButtonId || "",
      className: rawOptions.className || "",
      ariaLabel: rawOptions.ariaLabel || "在 Diff 中搜索",
      inputAriaLabel: rawOptions.inputAriaLabel || "搜索文本",
      placeholder: rawOptions.placeholder || "在当前 Diff 中搜索",
      value: rawOptions.value ?? "",
      countLabel: rawOptions.countLabel || "0 / 0",
      open: rawOptions.open !== false,
      hasMatches: Boolean(rawOptions.hasMatches),
      icons: {
        search: serializeMarkup(icons.search),
        previous: serializeMarkup(icons.previous),
        next: serializeMarkup(icons.next),
        close: serializeMarkup(icons.close)
      }
    };
  }

  class DiffSearchPopoverController {
    constructor(element, options) {
      this.element = element;
      this.options = options;
      this.input = element.querySelector(
        '[data-diff-search-control="input"]'
      );
      this.count = element.querySelector(
        '[data-diff-search-control="count"]'
      );
      this.previousButton = element.querySelector(
        '[data-diff-search-control="previous"]'
      );
      this.nextButton = element.querySelector(
        '[data-diff-search-control="next"]'
      );
      this.closeButton = element.querySelector(
        '[data-diff-search-control="close"]'
      );

      this.handleInput = this.handleInput.bind(this);
      this.handleKeydown = this.handleKeydown.bind(this);
      this.handlePrevious = this.handlePrevious.bind(this);
      this.handleNext = this.handleNext.bind(this);
      this.handleClose = this.handleClose.bind(this);

      this.input.addEventListener("input", this.handleInput);
      this.input.addEventListener("keydown", this.handleKeydown);
      this.previousButton.addEventListener("click", this.handlePrevious);
      this.nextButton.addEventListener("click", this.handleNext);
      this.closeButton.addEventListener("click", this.handleClose);
    }

    handleInput(event) {
      this.options.onInput?.(this.input.value, event, this);
    }

    handleKeydown(event) {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) {
          if (!this.previousButton.disabled) this.handlePrevious(event);
        } else if (!this.nextButton.disabled) {
          this.handleNext(event);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.handleClose(event);
        return;
      }
      this.options.onKeyDown?.(event, this);
    }

    handlePrevious(event) {
      this.options.onPrevious?.(event, this);
    }

    handleNext(event) {
      this.options.onNext?.(event, this);
    }

    handleClose(event) {
      this.options.onClose?.(event, this);
    }

    update(nextState = {}) {
      if (hasOwn(nextState, "open")) {
        this.element.hidden = !Boolean(nextState.open);
      }
      if (hasOwn(nextState, "value")) {
        this.input.value = String(nextState.value ?? "");
      }
      if (hasOwn(nextState, "countLabel")) {
        this.count.textContent = String(nextState.countLabel ?? "0 / 0");
      }
      if (hasOwn(nextState, "hasMatches")) {
        const disabled = !Boolean(nextState.hasMatches);
        this.previousButton.disabled = disabled;
        this.nextButton.disabled = disabled;
      }
      return this;
    }

    focus({ selectAll = false, preventScroll = true } = {}) {
      this.input.focus({ preventScroll });
      if (selectAll) this.input.select();
      return this;
    }

    reset({ close = false } = {}) {
      this.update({
        open: close ? false : !this.element.hidden,
        value: "",
        countLabel: "0 / 0",
        hasMatches: false
      });
      return this;
    }

    destroy() {
      this.input.removeEventListener("input", this.handleInput);
      this.input.removeEventListener("keydown", this.handleKeydown);
      this.previousButton.removeEventListener("click", this.handlePrevious);
      this.nextButton.removeEventListener("click", this.handleNext);
      this.closeButton.removeEventListener("click", this.handleClose);
      controllers.delete(this.element);
    }
  }

  function create(rawOptions = {}, context = {}) {
    requirePrimitives();
    const options = normalizeOptions(rawOptions);
    const document = context.document || global.document;
    const element = document.createElement("div");
    element.className = [
      "gn-diff-search-popover",
      options.className
    ].filter(Boolean).join(" ");
    if (options.id) element.id = options.id;
    element.setAttribute("role", "search");
    element.setAttribute("aria-label", options.ariaLabel);
    element.hidden = !options.open;

    const inputField = global.GitNestInput.create({
      id: options.inputId,
      type: "text",
      size: "small",
      fullWidth: true,
      value: options.value,
      autocomplete: "off",
      spellcheck: false,
      placeholder: options.placeholder,
      ariaLabel: options.inputAriaLabel,
      attributes:
        'enterkeyhint="search" data-diff-search-control="input"',
      fieldClassName: "gn-diff-search-popover__field",
      inputClassName: "gn-diff-search-popover__input",
      leadingIcon: options.icons.search,
      trailing: `<span class="gn-input__count gn-diff-search-popover__count" data-diff-search-control="count" aria-live="polite">${escapeHtml(options.countLabel)}</span>`
    }, { document });
    const count = inputField.querySelector(
      '[data-diff-search-control="count"]'
    );
    if (options.countId) count.id = options.countId;

    const actions = document.createElement("div");
    actions.className = "gn-diff-search-popover__actions";

    const createAction = (name, id, label, icon) => {
      const button = global.GitNestButton.create({
        label,
        ariaLabel: label,
        title: label,
        size: "small",
        variant: "icon",
        icon,
        className: "gn-diff-search-popover__action"
      }, { document });
      if (id) button.id = id;
      button.dataset.diffSearchControl = name;
      return button;
    };

    actions.append(
      createAction(
        "previous",
        options.previousButtonId,
        "上一个匹配",
        options.icons.previous
      ),
      createAction(
        "next",
        options.nextButtonId,
        "下一个匹配",
        options.icons.next
      ),
      createAction(
        "close",
        options.closeButtonId,
        "关闭搜索",
        options.icons.close
      )
    );
    element.append(inputField, actions);

    const controller = new DiffSearchPopoverController(element, options);
    controllers.set(element, controller);
    controller.update({
      open: options.open,
      value: options.value,
      countLabel: options.countLabel,
      hasMatches: options.hasMatches
    });
    return controller;
  }

  global.GitNestDiffSearchPopover = {
    DiffSearchPopoverController,
    create,
    getController(element) {
      return controllers.get(element) || null;
    }
  };
})(window);

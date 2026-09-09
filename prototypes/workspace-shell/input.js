/**
 * GitNest 输入框组件：
 *
 * GitNestInput.render({
 *   id: "repository-filter",
 *   value: "",
 *   placeholder: "筛选仓库…",
 *   size: "small", // small | medium | large
 *   leadingIcon: '<svg class="icon">...</svg>',
 *   trailing: '<kbd>Ctrl K</kbd>',
 *   clearButton: { icon: '<svg class="icon">...</svg>', ariaLabel: "清除" },
 *   fullWidth: true,
 *   state: "default", // default | focus | error
 *   multiline: false
 * });
 *
 * 尺寸：small 32px / medium 35px / large 40px。
 *
 * GitNestInput.create(options) 会返回带有 .gn-input-field 的 HTMLElement。
 */
(function attachGitNestInput(global) {
  const SIZE_ALIASES = {
    sm: "small",
    small: "small",
    md: "medium",
    medium: "medium",
    default: "medium",
    lg: "large",
    large: "large"
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeSize(size) {
    return SIZE_ALIASES[size] || SIZE_ALIASES.medium;
  }

  function serializeMarkup(value) {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (global.Element && value instanceof global.Element) return value.outerHTML;
    return "";
  }

  function normalizeOptions(options = {}) {
    const size = normalizeSize(options.size);
    const multiline = Boolean(options.multiline || options.as === "textarea");
    const clearButton = options.clearButton
      ? {
          icon: serializeMarkup(options.clearButton.icon),
          ariaLabel: options.clearButton.ariaLabel || "清除内容",
          title: options.clearButton.title || "",
          attributes: options.clearButton.attributes || "",
          onClick: options.clearButton.onClick
        }
      : null;
    return {
      ...options,
      size,
      multiline,
      clearButton,
      actions: Array.isArray(options.actions) ? options.actions : [],
      leadingIcon: serializeMarkup(options.leadingIcon || options.icon),
      trailing: serializeMarkup(options.trailing),
      type: options.type || "text",
      value: options.value ?? "",
      label: options.label || "",
      fullWidth: Boolean(options.fullWidth),
      disabled: Boolean(options.disabled),
      readonly: Boolean(options.readonly),
      state: options.state === "error" || options.state === "focus"
        ? options.state
        : "default"
    };
  }

  function renderControl(options) {
    const attrs = [
      `class="gn-input__control"`,
      options.id ? `id="${escapeHtml(options.id)}"` : "",
      options.name ? `name="${escapeHtml(options.name)}"` : "",
      !options.multiline ? `type="${escapeHtml(options.type)}"` : "",
      options.placeholder ? `placeholder="${escapeHtml(options.placeholder)}"` : "",
      options.autocomplete ? `autocomplete="${escapeHtml(options.autocomplete)}"` : "",
      options.spellcheck !== undefined ? `spellcheck="${String(Boolean(options.spellcheck))}"` : "",
      options.ariaLabel ? `aria-label="${escapeHtml(options.ariaLabel)}"` : "",
      options.ariaInvalid ? 'aria-invalid="true"' : "",
      options.disabled ? "disabled" : "",
      options.readonly ? "readonly" : "",
      options.rows ? `rows="${escapeHtml(options.rows)}"` : "",
      options.attributes || ""
    ].filter(Boolean).join(" ");
    return options.multiline
      ? `<textarea ${attrs}>${escapeHtml(options.value)}</textarea>`
      : `<input ${attrs} value="${escapeHtml(options.value)}" />`;
  }

  function renderAction(action, className = "gn-input__action") {
    if (!action) return "";
    const config = typeof action === "string"
      ? { content: action }
      : action;
    const content = serializeMarkup(config.content || config.icon);
    const attrs = [
      `type="button"`,
      `class="${className}${config.className ? ` ${escapeHtml(config.className)}` : ""}"`,
      config.ariaLabel ? `aria-label="${escapeHtml(config.ariaLabel)}"` : "",
      config.title ? `title="${escapeHtml(config.title)}"` : "",
      config.attributes || ""
    ].filter(Boolean).join(" ");
    return `<button ${attrs}>${content}</button>`;
  }

  function render(rawOptions = {}) {
    const options = normalizeOptions(rawOptions);
    const leading = options.leadingIcon
      ? `<span class="gn-input__leading" data-input-leading="true">${options.leadingIcon}</span>`
      : "";
    const trailing = [
      options.trailing,
      ...options.actions.map((action) => renderAction(action)),
      options.clearButton
        ? renderAction(options.clearButton, "gn-input__clear")
        : ""
    ].filter(Boolean).join("");
    const fieldAttrs = [
      `class="gn-input-field${options.fieldClassName ? ` ${escapeHtml(options.fieldClassName)}` : ""}"`,
      `data-full-width="${String(options.fullWidth)}"`
    ].join(" ");
    const inputClasses = [
      "gn-input",
      options.inputClassName
    ].filter(Boolean).join(" ");
    const inputAttrs = [
      `class="${escapeHtml(inputClasses)}"`,
      `data-size="${options.size}"`,
      `data-full-width="${String(options.fullWidth)}"`,
      `data-state="${options.state}"`,
      `data-disabled="${String(options.disabled)}"`,
      `data-multiline="${String(options.multiline)}"`,
      `data-has-leading="${String(Boolean(options.leadingIcon))}"`,
      `data-has-trailing="${String(Boolean(trailing))}"`,
      options.state === "focus" ? 'data-focused="true"' : ""
    ].filter(Boolean).join(" ");
    const help = options.helpText
      ? `<small class="gn-input-field__help" data-state="${options.state}">${escapeHtml(options.helpText)}</small>`
      : "";
    return `
      <div ${fieldAttrs}>
        ${options.label && options.id ? `<label class="gn-input-field__label" for="${escapeHtml(options.id)}">${escapeHtml(options.label)}</label>` : ""}
        <div ${inputAttrs}>
          ${leading}
          ${renderControl(options)}
          ${trailing ? `<span class="gn-input__trailing">${trailing}</span>` : ""}
        </div>
        ${help}
      </div>
    `.trim();
  }

  function create(rawOptions = {}, context = {}) {
    const options = normalizeOptions(rawOptions);
    const document = context.document || global.document;
    const template = document.createElement("template");
    template.innerHTML = render(options);
    const field = template.content.firstElementChild;
    const input = field?.querySelector(".gn-input__control");
    const clear = field?.querySelector(".gn-input__clear");
    if (clear) {
      clear.addEventListener("click", (event) => {
        if (typeof options.clearButton?.onClick === "function") {
          options.clearButton.onClick(event, input, field);
          return;
        }
        if (typeof options.onClear === "function") {
          options.onClear(event, input, field);
          return;
        }
        if (!input) return;
        input.value = "";
        input.focus();
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    field?.querySelectorAll(".gn-input__action").forEach((action, index) => {
      const config = Array.isArray(options.actions) ? options.actions[index] : null;
      if (config && typeof config.onClick === "function") {
        action.addEventListener("click", (event) => config.onClick(event, input, field));
      }
    });
    return field;
  }

  global.GitNestInput = {
    sizes: Object.freeze({ small: 32, medium: 35, large: 40 }),
    normalizeSize,
    render,
    create
  };
})(window);

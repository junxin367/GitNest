/**
 * GitNest 多行输入框组件。
 *
 * GitNestTextarea.render({
 *   id: "commit-message",
 *   value: "",
 *   placeholder: "输入提交信息…",
 *   size: "small", // small | medium | large
 *   fullWidth: true,
 *   state: "default", // default | focus | error
 *   rows: 3
 * });
 */
(function attachGitNestTextarea(global) {
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

  function normalizeOptions(options = {}) {
    return {
      ...options,
      size: normalizeSize(options.size),
      value: options.value ?? "",
      label: options.label || "",
      fullWidth: Boolean(options.fullWidth),
      disabled: Boolean(options.disabled),
      readonly: Boolean(options.readonly),
      required: Boolean(options.required),
      state: options.state === "error" || options.state === "focus"
        ? options.state
        : "default"
    };
  }

  function render(rawOptions = {}) {
    const options = normalizeOptions(rawOptions);
    const fieldClasses = [
      "gn-textarea-field",
      options.fieldClassName
    ].filter(Boolean).join(" ");
    const boundaryClasses = [
      "gn-textarea",
      options.className
    ].filter(Boolean).join(" ");
    const controlClasses = [
      "gn-textarea__control",
      options.textareaClassName
    ].filter(Boolean).join(" ");
    const controlAttrs = [
      `class="${escapeHtml(controlClasses)}"`,
      options.id ? `id="${escapeHtml(options.id)}"` : "",
      options.name ? `name="${escapeHtml(options.name)}"` : "",
      options.placeholder ? `placeholder="${escapeHtml(options.placeholder)}"` : "",
      options.autocomplete ? `autocomplete="${escapeHtml(options.autocomplete)}"` : "",
      options.spellcheck !== undefined
        ? `spellcheck="${String(Boolean(options.spellcheck))}"`
        : "",
      options.ariaLabel ? `aria-label="${escapeHtml(options.ariaLabel)}"` : "",
      options.ariaInvalid || options.state === "error"
        ? 'aria-invalid="true"'
        : "",
      options.disabled ? "disabled" : "",
      options.readonly ? "readonly" : "",
      options.required ? "required" : "",
      options.rows ? `rows="${escapeHtml(options.rows)}"` : "",
      options.maxLength
        ? `maxlength="${escapeHtml(options.maxLength)}"`
        : "",
      options.attributes || ""
    ].filter(Boolean).join(" ");
    const help = options.helpText
      ? `<small class="gn-textarea-field__help" data-state="${options.state}">${escapeHtml(options.helpText)}</small>`
      : "";

    return `
      <div class="${escapeHtml(fieldClasses)}" data-full-width="${String(options.fullWidth)}">
        ${options.label && options.id ? `<label class="gn-textarea-field__label" for="${escapeHtml(options.id)}">${escapeHtml(options.label)}</label>` : ""}
        <div
          class="${escapeHtml(boundaryClasses)}"
          data-disabled="${String(options.disabled)}"
          data-full-width="${String(options.fullWidth)}"
          data-size="${options.size}"
          data-state="${options.state}"
          ${options.state === "focus" ? 'data-focused="true"' : ""}
        >
          <textarea ${controlAttrs}>${escapeHtml(options.value)}</textarea>
        </div>
        ${help}
      </div>
    `.trim();
  }

  function create(rawOptions = {}, context = {}) {
    const document = context.document || global.document;
    const template = document.createElement("template");
    template.innerHTML = render(rawOptions);
    return template.content.firstElementChild;
  }

  global.GitNestTextarea = {
    sizes: Object.freeze({ small: 64, medium: 96, large: 132 }),
    normalizeSize,
    render,
    create
  };
})(window);

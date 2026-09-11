/**
 * GitNest 按钮组件：
 *
 * GitNestButton.render({
 *   label: "打开目录",
 *   size: "small", // small | medium | large
 *   variant: "quick", // default | primary | danger | toolbar | quick | icon
 *   icon: '<svg class="icon">...</svg>',
 *   fullWidth: false,
 *   iconOnly: false,
 *   loading: false,
 *   disabled: false
 *
 * 尺寸：small 32px / medium 35px / large 40px。
 * });
 *
 * GitNestButton.create(options) 会返回可直接插入 DOM 的 HTMLButtonElement。
 */
(function attachGitNestButton(global) {
  const SIZE_ALIASES = {
    sm: "small",
    small: "small",
    md: "medium",
    medium: "medium",
    default: "small",
    lg: "large",
    large: "large"
  };
  const VARIANT_ALIASES = {
    default: "default",
    primary: "primary",
    danger: "danger",
    toolbar: "toolbar",
    quick: "quick",
    icon: "icon"
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
    return SIZE_ALIASES[size] || SIZE_ALIASES.small;
  }

  function normalizeVariant(variant) {
    return VARIANT_ALIASES[variant] || VARIANT_ALIASES.default;
  }

  function serializeIcon(icon) {
    if (!icon) return "";
    if (typeof icon === "string") return icon;
    if (global.Element && icon instanceof global.Element) return icon.outerHTML;
    return "";
  }

  function normalizeOptions(options = {}) {
    const size = normalizeSize(options.size);
    const variant = normalizeVariant(options.variant);
    const label = options.label ?? options.text ?? "";
    const icon = serializeIcon(options.icon ?? options.iconHtml);
    const iconOnly = Boolean(options.iconOnly || variant === "icon");
    return {
      ...options,
      size,
      variant,
      label,
      icon,
      iconOnly,
      fullWidth: Boolean(options.fullWidth),
      loading: Boolean(options.loading),
      disabled: Boolean(options.disabled),
      iconPosition: options.iconPosition === "after" ? "after" : "before",
      type: options.type || "button"
    };
  }

  function className(options) {
    return [
      "gn-button",
      options.className,
      options.loading ? "is-loading" : ""
    ].filter(Boolean).join(" ");
  }

  function buttonContent(options) {
    const icon = options.icon
      ? `<span class="gn-button__icon" data-button-icon="true">${options.icon}</span>`
      : "";
    const label = options.iconOnly || !options.label
      ? ""
      : `<span class="gn-button__label">${escapeHtml(options.label)}</span>`;
    return options.iconPosition === "after"
      ? `${label}${icon}`
      : `${icon}${label}`;
  }

  function render(rawOptions = {}) {
    const options = normalizeOptions(rawOptions);
    const ariaLabel = options.ariaLabel || (options.iconOnly ? options.label : "");
    const attrs = [
      `type="${escapeHtml(options.type)}"`,
      `class="${escapeHtml(className(options))}"`,
      `data-size="${options.size}"`,
      `data-variant="${options.variant}"`,
      `data-full-width="${String(options.fullWidth)}"`,
      `data-icon-only="${String(options.iconOnly)}"`,
      options.emphasis ? `data-emphasis="${escapeHtml(options.emphasis)}"` : "",
      options.selected ? 'data-selected="true"' : "",
      options.loading ? 'aria-busy="true"' : "",
      options.disabled ? "disabled" : "",
      ariaLabel ? `aria-label="${escapeHtml(ariaLabel)}"` : "",
      options.title ? `title="${escapeHtml(options.title)}"` : "",
      options.attributes || ""
    ].filter(Boolean).join(" ");
    return `<button ${attrs}>${buttonContent(options)}</button>`;
  }

  function create(rawOptions = {}, context = {}) {
    const options = normalizeOptions(rawOptions);
    const document = context.document || global.document;
    const template = document.createElement("template");
    template.innerHTML = render(options).trim();
    const button = template.content.firstElementChild;
    if (typeof options.onClick === "function") {
      button.addEventListener("click", options.onClick);
    }
    return button;
  }

  global.GitNestButton = {
    sizes: Object.freeze({ small: 32, medium: 35, large: 40 }),
    variants: Object.freeze(Object.keys(VARIANT_ALIASES)),
    normalizeSize,
    normalizeVariant,
    render,
    create
  };
})(window);

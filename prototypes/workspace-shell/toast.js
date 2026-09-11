/**
 * GitNest 提示信息组件：
 *
 * GitNestToast.show({
 *   title: "设置已保存",
 *   message: "AI 提交信息设置已写入配置文件。",
 *   tone: "success", // success | info | error
 *   duration: 3100
 * });
 *
 * show() 默认将提示放入顶部居中的共享 viewport，支持堆叠、关闭和自动消失。
 * create() 只创建单个提示元素，可用于静态规范展示。
 */
(function attachGitNestToast(global) {
  const TONES = new Set(["success", "info", "error"]);

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function defaultIcon(tone) {
    if (tone === "success") {
      return '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>';
    }
    if (tone === "error") {
      return '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 4 3 20h18L12 4Z"/><path d="M12 9v5M12 17h.01"/></svg>';
    }
    return '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8h.01"/></svg>';
  }

  function closeIcon() {
    return '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>';
  }

  function normalizeOptions(options = {}) {
    const tone = TONES.has(options.tone)
      ? options.tone
      : "info";
    return {
      ...options,
      tone,
      title: options.title || "提示",
      message: options.message || "",
      icon: options.icon || defaultIcon(tone),
      closable:
        options.closable !== undefined
          ? Boolean(options.closable)
          : typeof options.onClose === "function",
      closeLabel: options.closeLabel || "关闭提示"
    };
  }

  function render(rawOptions = {}) {
    const options = normalizeOptions(rawOptions);
    const role = options.tone === "error" ? "alert" : "status";
    const live = options.tone === "error" ? "assertive" : "polite";
    const close = options.closable
      ? `
        <button
          aria-label="${escapeHtml(options.closeLabel)}"
          class="toast-close"
          title="${escapeHtml(options.closeLabel)}"
          type="button"
        >${closeIcon()}</button>
      `
      : "";
    return `
      <div
        aria-atomic="true"
        aria-live="${live}"
        class="toast toast-${options.tone}"
        role="${role}"
      >
        <span class="toast-icon">${options.icon}</span>
        <div class="toast-copy">
          <strong>${escapeHtml(options.title)}</strong>
          <span>${escapeHtml(options.message)}</span>
        </div>
        ${close}
      </div>
    `.trim();
  }

  function create(rawOptions = {}, context = {}) {
    const options = normalizeOptions(rawOptions);
    const document = context.document || global.document;
    const template = document.createElement("template");
    template.innerHTML = render(options);
    const toast = template.content.firstElementChild;
    const close = toast?.querySelector(".toast-close");
    if (close) {
      close.addEventListener("click", () => {
        if (typeof options.onClose === "function") {
          options.onClose(toast);
          return;
        }
        toast.remove();
      });
    }
    return toast;
  }

  function ensureViewport(context = {}) {
    const document = context.document || global.document;
    let viewport = document.querySelector(
      '.toast-viewport[data-toast-viewport="true"]'
    );
    if (viewport) return viewport;
    viewport = document.createElement("div");
    viewport.className = "toast-viewport";
    viewport.dataset.toastViewport = "true";
    viewport.setAttribute("aria-label", "消息提示");
    document.body.append(viewport);
    return viewport;
  }

  function show(rawOptions = {}, context = {}) {
    const document = context.document || global.document;
    const viewport = ensureViewport({ document });
    let timer = null;
    let toast = null;
    const dismiss = () => {
      if (timer !== null) {
        global.clearTimeout(timer);
        timer = null;
      }
      toast?.remove();
      if (!viewport.childElementCount) {
        viewport.remove();
      }
      if (typeof rawOptions.onClose === "function") {
        rawOptions.onClose();
      }
    };
    toast = create(
      {
        ...rawOptions,
        closable:
          rawOptions.closable !== undefined
            ? rawOptions.closable
            : true,
        onClose: dismiss
      },
      { document }
    );
    viewport.append(toast);
    const duration = Number.isFinite(rawOptions.duration)
      ? Math.max(0, rawOptions.duration)
      : 3100;
    if (duration > 0) {
      timer = global.setTimeout(dismiss, duration);
    }
    return {
      element: toast,
      dismiss
    };
  }

  global.GitNestToast = {
    tones: Object.freeze(["success", "info", "error"]),
    render,
    create,
    show
  };
})(window);

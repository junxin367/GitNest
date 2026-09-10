/**
 * GitNest 完整 Diff Workspace 原型组件。
 *
 * 组件封装：
 * - 左侧文件变更筛选、分组、列表/树视图、选择与暂存切换；
 * - 仓库模式的视图菜单和提交信息区域；
 * - 右侧 DiffPanel；
 * - 底部语言、编码和快捷键状态栏。
 */
(function attachGitNestDiffWorkspace(global) {
  let workspaceSequence = 0;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function iconMarkup(name) {
    return `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  }

  function buttonMarkup(options) {
    return global.GitNestButton.render({
      size: "small",
      type: "button",
      ...options
    });
  }

  function fileMode(file) {
    if (file.staged) return "staged";
    return file.status === "untracked" ? "untracked" : "unstaged";
  }

  function modeLabel(mode) {
    if (mode === "staged") return "已暂存";
    if (mode === "untracked") return "未跟踪";
    return "未暂存";
  }

  function fileName(path) {
    return String(path).split(/[\\/]/).pop() || path;
  }

  function normalizedFiles(files) {
    return (Array.isArray(files) ? files : []).map((file, index) => ({
      key: file.key || `${file.path}:${index}`,
      path: file.path || `file-${index + 1}`,
      status: file.status || "modified",
      staged: Boolean(file.staged),
      language: file.language || "Text",
      additions: Number.isFinite(file.additions) ? file.additions : null,
      deletions: Number.isFinite(file.deletions) ? file.deletions : null,
      rows: Array.isArray(file.rows) ? file.rows : []
    }));
  }

  function fileStats(file) {
    if (
      Number.isFinite(file.additions) &&
      Number.isFinite(file.deletions)
    ) {
      return {
        additions: file.additions,
        deletions: file.deletions
      };
    }

    return file.rows.reduce(
      (stats, row) => {
        if (row.kind === "pair") {
          stats.additions += 1;
          stats.deletions += 1;
        } else if (row.kind === "add") {
          stats.additions += 1;
        } else if (row.kind === "delete") {
          stats.deletions += 1;
        }
        return stats;
      },
      { additions: 0, deletions: 0 }
    );
  }

  function buildTree(files) {
    const root = { name: "", path: "", directories: new Map(), files: [] };
    files.forEach((file) => {
      const parts = file.path.split(/[\\/]/).filter(Boolean);
      const name = parts.pop() || file.path;
      let cursor = root;
      parts.forEach((part) => {
        if (!cursor.directories.has(part)) {
          const path = [cursor.path, part].filter(Boolean).join("/");
          cursor.directories.set(part, {
            name: part,
            path,
            directories: new Map(),
            files: []
          });
        }
        cursor = cursor.directories.get(part);
      });
      cursor.files.push({ ...file, displayName: name });
    });
    return root;
  }

  function compactDirectory(directory) {
    const names = [directory.name];
    let terminal = directory;

    while (
      terminal.files.length === 0 &&
      terminal.directories.size === 1
    ) {
      terminal = [...terminal.directories.values()][0];
      names.push(terminal.name);
    }

    return {
      directory: terminal,
      label: names.join(" \\ ")
    };
  }

  class DiffWorkspaceController {
    constructor(element, rawOptions = {}) {
      const rawFeatures = rawOptions.features || {};
      const features = {
        allowTreeView:
          rawFeatures.allowTreeView !== undefined
            ? Boolean(rawFeatures.allowTreeView)
            : true,
        allowRefresh: Boolean(rawFeatures.allowRefresh),
        openStandaloneDiff:
          rawFeatures.openStandaloneDiff !== undefined
            ? Boolean(rawFeatures.openStandaloneDiff)
            : Boolean(rawOptions.showOpenStandalone),
        commitRegion:
          rawFeatures.commitRegion !== undefined
            ? Boolean(rawFeatures.commitRegion)
            : Boolean(rawOptions.commit),
        pushRegion:
          rawFeatures.pushRegion !== undefined
            ? Boolean(rawFeatures.pushRegion)
            : true,
        statusbar:
          rawFeatures.statusbar !== undefined
            ? Boolean(rawFeatures.statusbar)
            : true
      };
      const rawCommit = rawOptions.commit || {};
      this.element = element;
      this.instanceId = `diff-workspace-${++workspaceSequence}`;
      this.options = {
        files: normalizedFiles(rawOptions.files),
        features,
        commit: features.commitRegion
          ? {
              message: rawCommit.message || "",
              push: Boolean(rawCommit.push),
              aiEnabled: Boolean(rawCommit.aiEnabled),
              conflicts: Number.isFinite(rawCommit.conflicts)
                ? rawCommit.conflicts
                : 0
            }
          : null,
        config: rawOptions.config || {
          layouts: ["unified"],
          defaultLayout: "unified",
          showToolbar: false,
          allowWrap: false,
          showHunkNavigation: false
        }
      };
      this.state = {
        selectedKey:
          rawOptions.selectedKey ||
          this.options.files[0]?.key ||
          "",
        filter: "",
        viewMode: "list",
        viewMenuOpen: false,
        collapsedSections: new Set(),
        collapsedDirectories: new Set(),
        commitMessage: this.options.commit?.message || "",
        commitPush: Boolean(this.options.commit?.push)
      };
      this.handleClick = this.handleClick.bind(this);
      this.handleDocumentClick = this.handleDocumentClick.bind(this);
      this.handleInput = this.handleInput.bind(this);
      this.element.addEventListener("click", this.handleClick);
      this.element.addEventListener("input", this.handleInput);
      this.element.ownerDocument.addEventListener(
        "click",
        this.handleDocumentClick
      );
      this.renderShell();
      this.renderSidebar();
      this.mountPanel();
      this.renderStatusbar();
    }

    selectedFile() {
      return (
        this.options.files.find(
          (file) => file.key === this.state.selectedKey
        ) ||
        this.filteredFiles()[0] ||
        this.options.files[0]
      );
    }

    filteredFiles() {
      const query = this.state.filter.trim().toLocaleLowerCase();
      if (!query) return this.options.files;
      return this.options.files.filter((file) =>
        [
          file.path,
          file.status,
          modeLabel(fileMode(file)),
          file.language
        ].some((value) =>
          String(value).toLocaleLowerCase().includes(query)
        )
      );
    }

    fileSections() {
      const files = this.filteredFiles();
      return ["staged", "unstaged", "untracked"]
        .map((mode) => ({
          mode,
          title: modeLabel(mode),
          files: files.filter((file) => fileMode(file) === mode)
        }))
        .filter((section) => section.files.length > 0);
    }

    renderShell() {
      this.element.classList.toggle(
        "without-statusbar",
        !this.options.features.statusbar
      );
      this.element.innerHTML = `
        <div class="gn-diff-workspace__body">
          <aside class="gn-diff-workspace__sidebar" aria-label="文件变更">
            <header class="gn-diff-workspace__sidebar-header">
              <strong>文件变更</strong>
              <div class="gn-diff-workspace__sidebar-tools">
                <div class="gn-diff-workspace__filter-mount" data-diff-workspace-filter></div>
                <span data-diff-workspace-view-toggle></span>
              </div>
            </header>
            <div class="gn-diff-workspace__file-list" data-diff-workspace-files></div>
            <div class="gn-diff-workspace__commit-mount" data-diff-workspace-commit></div>
          </aside>
          <div class="gn-diff-workspace__content" data-diff-workspace-panel></div>
        </div>
        ${this.options.features.statusbar
          ? '<footer class="gn-diff-workspace__statusbar" data-diff-workspace-status></footer>'
          : ""}
      `;
      this.filterMount = this.element.querySelector(
        "[data-diff-workspace-filter]"
      );
      this.viewToggleMount = this.element.querySelector(
        "[data-diff-workspace-view-toggle]"
      );
      this.fileList = this.element.querySelector(
        "[data-diff-workspace-files]"
      );
      this.panelMount = this.element.querySelector(
        "[data-diff-workspace-panel]"
      );
      this.commitMount = this.element.querySelector(
        "[data-diff-workspace-commit]"
      );
      this.statusbar = this.element.querySelector(
        "[data-diff-workspace-status]"
      );
    }

    renderFileRow(file, depth = 0, displayName = fileName(file.path)) {
      const selected = file.key === this.state.selectedKey;
      const mode = fileMode(file);
      const stats = fileStats(file);
      const statusCode = file.status === "untracked" ? "?" : "M";
      const primaryLabel =
        this.state.viewMode === "tree" ? displayName : file.path;
      return `
        <div class="gn-diff-workspace__file-row${selected ? " is-selected" : ""}">
          <button
            type="button"
            class="gn-diff-workspace__file-select"
            data-diff-workspace-action="select-file"
            data-file-key="${escapeHtml(file.key)}"
            aria-current="${selected}"
            ${depth > 0 ? `style="padding-left: calc(${depth} * var(--space-4))"` : ""}
          >
            <strong class="gn-diff-workspace__file-name" title="${escapeHtml(file.path)}">${escapeHtml(primaryLabel)}</strong>
            <span class="gn-diff-workspace__file-meta">
              <span class="gn-diff-workspace__status-code ${file.status === "untracked" ? "untracked" : ""}">${statusCode}</span>
              <span class="gn-diff-workspace__file-secondary">${escapeHtml(modeLabel(mode))}</span>
              <span class="gn-diff-workspace__file-stats" aria-label="新增 ${stats.additions} 行，删除 ${stats.deletions} 行">
                <span class="additions">+${stats.additions}</span>
                <span class="deletions">-${stats.deletions}</span>
              </span>
            </span>
          </button>
          ${buttonMarkup({
            label: mode === "staged" ? "取消暂存" : "暂存",
            ariaLabel: `${mode === "staged" ? "取消暂存" : "暂存"} ${file.path}`,
            title: mode === "staged" ? "取消暂存" : "暂存",
            icon: iconMarkup(mode === "staged" ? "minus" : "plus"),
            variant: "icon",
            className: "gn-diff-workspace__stage-button",
            attributes: `data-diff-workspace-action="toggle-stage" data-file-key="${escapeHtml(file.key)}"`
          })}
        </div>
      `;
    }

    renderTreeNode(node, section, depth = 0) {
      const directoryMarkup = [...node.directories.values()]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((rawDirectory) => {
          const compacted = compactDirectory(rawDirectory);
          const directory = compacted.directory;
          const key = `${section.mode}:${directory.path}`;
          const collapsed = this.state.collapsedDirectories.has(key);
          return `
            <button
              type="button"
              class="gn-diff-workspace__tree-directory${collapsed ? " is-collapsed" : ""}"
              data-diff-workspace-action="toggle-directory"
              data-directory-key="${escapeHtml(key)}"
              aria-expanded="${!collapsed}"
              style="padding-left: calc(var(--space-2) + ${depth} * var(--space-4))"
            >
              <span class="gn-diff-workspace__tree-chevron">${iconMarkup("chevron-right")}</span>
              <span class="folder">${iconMarkup("folder")}</span>
              <span title="${escapeHtml(directory.path)}">${escapeHtml(compacted.label)}</span>
            </button>
            ${collapsed ? "" : this.renderTreeNode(directory, section, depth + 1)}
          `;
        })
        .join("");
      const fileMarkup = node.files
        .sort((left, right) => left.displayName.localeCompare(right.displayName))
        .map((file) =>
          this.renderFileRow(file, depth, file.displayName)
        )
        .join("");
      return `${directoryMarkup}${fileMarkup}`;
    }

    treeDirectoryKeys() {
      const keys = [];
      const collect = (node, mode) => {
        [...node.directories.values()].forEach((rawDirectory) => {
          const directory = compactDirectory(rawDirectory).directory;
          keys.push(`${mode}:${directory.path}`);
          collect(directory, mode);
        });
      };
      this.fileSections().forEach((section) => {
        collect(buildTree(section.files), section.mode);
      });
      return [...new Set(keys)];
    }

    renderSection(section) {
      const collapsed = this.state.collapsedSections.has(section.mode);
      const rows = this.state.viewMode === "tree"
        ? this.renderTreeNode(buildTree(section.files), section)
        : section.files.map((file) => this.renderFileRow(file)).join("");
      return `
        <section class="gn-diff-workspace__file-section${collapsed ? " is-collapsed" : ""}">
          <button
            type="button"
            class="gn-diff-workspace__section-title"
            data-diff-workspace-action="toggle-section"
            data-section-mode="${section.mode}"
            aria-expanded="${!collapsed}"
          >
            <span class="gn-diff-workspace__section-chevron">${iconMarkup("chevron-right")}</span>
            <span>${section.title}</span>
            <span class="gn-diff-workspace__section-count">${section.files.length}</span>
          </button>
          ${collapsed ? "" : `<div>${rows}</div>`}
        </section>
      `;
    }

    renderViewMenu() {
      const directoryKeys = this.treeDirectoryKeys();
      const canToggleDirectories =
        this.options.features.allowTreeView &&
        this.state.viewMode === "tree" &&
        directoryKeys.length > 0;
      const willCollapseDirectories =
        canToggleDirectories &&
        directoryKeys.some(
          (key) => !this.state.collapsedDirectories.has(key)
        );
      const directoryLabel = willCollapseDirectories
        ? "收起目录"
        : "展开目录";
      const directoryTitle =
        this.state.viewMode !== "tree"
          ? "切换到树形式查看后可用"
          : directoryKeys.length === 0
            ? "当前变更中没有目录"
            : willCollapseDirectories
              ? "收起全部目录"
              : "展开全部目录";

      this.viewToggleMount.innerHTML = `
        <div class="gn-diff-workspace__view-menu">
          ${buttonMarkup({
            label: "打开变更文件视图菜单",
            ariaLabel: "打开变更文件视图菜单",
            title: "变更文件视图",
            icon: iconMarkup("more"),
            variant: "icon",
            attributes: `data-diff-workspace-action="toggle-view-menu" aria-haspopup="menu" aria-expanded="${this.state.viewMenuOpen}"`
          })}
          ${this.state.viewMenuOpen ? `
            <div class="gn-diff-workspace__view-popover toolbar-menu-popover" role="menu">
              ${this.options.features.allowTreeView ? `
                <button type="button" role="menuitem" data-diff-workspace-action="toggle-view">
                  ${iconMarkup(this.state.viewMode === "tree" ? "file" : "folder")}
                  <span>${this.state.viewMode === "tree" ? "以列表形式查看" : "以树形式查看"}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-diff-workspace-action="toggle-all-directories"
                  title="${escapeHtml(directoryTitle)}"
                  ${canToggleDirectories ? "" : "disabled"}
                >
                  ${iconMarkup(willCollapseDirectories ? "chevron-right" : "arrow-down")}
                  <span>${directoryLabel}</span>
                </button>
              ` : ""}
              ${this.options.features.allowRefresh ? `
                <button type="button" role="menuitem" data-diff-workspace-action="refresh">
                  ${iconMarkup("refresh")}
                  <span>刷新变更</span>
                </button>
              ` : ""}
            </div>
          ` : ""}
        </div>
      `;
    }

    stagedCount() {
      return this.options.files.filter(
        (file) => fileMode(file) === "staged"
      ).length;
    }

    canCommit() {
      return (
        this.options.files.length > 0 &&
        (this.options.commit?.conflicts || 0) === 0 &&
        Boolean(this.state.commitMessage.trim())
      );
    }

    renderCommitComposer() {
      if (!this.options.commit) {
        this.commitMount.replaceChildren();
        return;
      }

      const staged = this.stagedCount();
      const conflicts = this.options.commit.conflicts;
      const canCommit = this.canCommit();
      const pushId = `${this.instanceId}-commit-push`;
      const messageId = `${this.instanceId}-commit-message`;
      const statusText = conflicts > 0
        ? `${conflicts} 个冲突`
        : `${staged} 个已暂存`;

      this.commitMount.innerHTML = `
        <article class="gn-diff-workspace__commit-composer">
          <header class="gn-diff-workspace__commit-header">
            ${this.options.features.pushRegion ? `
              <label class="gn-diff-workspace__commit-push" for="${pushId}">
                <input
                  id="${pushId}"
                  name="commit-push"
                  type="checkbox"
                  data-diff-workspace-control="commit-push"
                  ${this.state.commitPush ? "checked" : ""}
                />
                <span>推送到远程</span>
              </label>
            ` : "<span></span>"}
            <span class="gn-diff-workspace__commit-status ${
              conflicts > 0
                ? "is-conflicted"
                : staged > 0
                  ? "is-ready"
                  : ""
            }">${statusText}</span>
          </header>
          <form class="gn-diff-workspace__commit-form" onsubmit="event.preventDefault()">
            ${this.options.commit.aiEnabled ? `
              <div class="gn-diff-workspace__commit-form-head">
                ${buttonMarkup({
                  label: "AI 生成",
                  icon: iconMarkup("sparkle"),
                  attributes: 'data-diff-workspace-action="generate-commit-message"'
                })}
              </div>
            ` : ""}
            ${global.GitNestTextarea.render({
              id: messageId,
              value: this.state.commitMessage,
              size: "small",
              fullWidth: true,
              ariaLabel: "提交信息",
              autocomplete: "off",
              maxLength: 100000,
              name: "commit-message",
              placeholder: "输入提交信息…",
              rows: 3,
              textareaClassName: "gn-diff-workspace__commit-message",
              attributes: 'data-diff-workspace-control="commit-message"'
            })}
            ${buttonMarkup({
              label: staged > 0
                ? "提交已暂存变更"
                : "提交全部变更",
              icon: iconMarkup("check"),
              variant: "primary",
              fullWidth: true,
              disabled: !canCommit,
              attributes: 'data-diff-workspace-action="commit"'
            })}
          </form>
        </article>
      `;
    }

    renderSidebar({ focusFilter = false } = {}) {
      const sections = this.fileSections();
      const filterField = global.GitNestInput.create({
        id: `${this.instanceId}-file-filter`,
        value: this.state.filter,
        size: "small",
        fullWidth: true,
        ariaLabel: "筛选变更文件",
        placeholder: "筛选变更…",
        leadingIcon: iconMarkup("search"),
        clearButton: this.state.filter
          ? {
              icon: iconMarkup("x"),
              ariaLabel: "清除变更筛选",
              onClick: () => {
                this.state.filter = "";
                this.renderSidebar({ focusFilter: true });
              }
            }
          : null,
        attributes: 'data-diff-workspace-control="filter"'
      });
      this.filterMount.replaceChildren(filterField);
      this.renderViewMenu();
      this.fileList.innerHTML = sections.length
        ? sections.map((section) => this.renderSection(section)).join("")
        : `
            <div class="gn-diff-workspace__empty">
              ${iconMarkup("search")}
              <strong>没有匹配的变更</strong>
              <span>清除筛选后恢复全部文件。</span>
            </div>
          `;
      this.renderCommitComposer();
      if (focusFilter) {
        filterField.querySelector("input")?.focus({ preventScroll: true });
      }
    }

    mountPanel() {
      const selected = this.selectedFile();
      this.panel = global.GitNestDiffPanel.create({
        ariaLabel: "所选文件 Diff",
        path: selected?.path || "",
        rows: selected?.rows || [],
        headerActions: this.options.features.openStandaloneDiff
          ? buttonMarkup({
              label: "在独立窗口中打开 Diff",
              ariaLabel: "在独立窗口中打开 Diff",
              title: "在独立窗口中打开完整 Diff 查看器",
              icon: iconMarkup("external"),
              variant: "icon",
              className: "gn-diff-workspace__open-standalone",
              attributes: 'data-diff-workspace-action="open-standalone"'
            })
          : "",
        config: this.options.config
      });
      this.panelMount.replaceChildren(this.panel.element);
    }

    updatePanel() {
      const selected = this.selectedFile();
      this.panel.update({
        path: selected?.path || "",
        rows: selected?.rows || []
      });
      this.renderStatusbar();
    }

    renderStatusbar() {
      if (!this.statusbar) return;
      const selected = this.selectedFile();
      this.statusbar.innerHTML = `
        <span>${escapeHtml(selected?.language || "—")}</span>
        <span>UTF-8</span>
        <span>LF</span>
        <span class="gn-diff-workspace__status-spacer"></span>
        <span><kbd>Ctrl F</kbd> 搜索</span>
        <span class="secondary-hint"><kbd>Enter</kbd> 下一匹配</span>
        <span class="secondary-hint"><kbd>Esc</kbd> 关闭搜索</span>
      `;
    }

    handleInput(event) {
      if (
        event.target.matches(
          '[data-diff-workspace-control="filter"]'
        )
      ) {
        this.state.filter = event.target.value;
        this.renderSidebar({ focusFilter: true });
      } else if (
        event.target.matches(
          '[data-diff-workspace-control="commit-message"]'
        )
      ) {
        this.state.commitMessage = event.target.value;
        const commitButton = this.commitMount.querySelector(
          '[data-diff-workspace-action="commit"]'
        );
        commitButton.disabled = !this.canCommit();
      } else if (
        event.target.matches(
          '[data-diff-workspace-control="commit-push"]'
        )
      ) {
        this.state.commitPush = event.target.checked;
      }
    }

    handleDocumentClick(event) {
      if (
        this.state.viewMenuOpen &&
        !event.composedPath().includes(this.viewToggleMount)
      ) {
        this.state.viewMenuOpen = false;
        this.renderViewMenu();
      }
    }

    handleClick(event) {
      const action = event.target.closest("[data-diff-workspace-action]");
      if (!action || !this.element.contains(action)) return;
      const actionName = action.dataset.diffWorkspaceAction;
      if (actionName === "select-file") {
        this.state.selectedKey = action.dataset.fileKey;
        this.renderSidebar();
        this.updatePanel();
      } else if (actionName === "toggle-stage") {
        const file = this.options.files.find(
          (candidate) => candidate.key === action.dataset.fileKey
        );
        if (!file) return;
        file.staged = !file.staged;
        this.renderSidebar();
        this.updatePanel();
      } else if (actionName === "toggle-section") {
        const mode = action.dataset.sectionMode;
        if (this.state.collapsedSections.has(mode)) {
          this.state.collapsedSections.delete(mode);
        } else {
          this.state.collapsedSections.add(mode);
        }
        this.renderSidebar();
      } else if (actionName === "toggle-directory") {
        const key = action.dataset.directoryKey;
        if (this.state.collapsedDirectories.has(key)) {
          this.state.collapsedDirectories.delete(key);
        } else {
          this.state.collapsedDirectories.add(key);
        }
        this.renderSidebar();
      } else if (actionName === "toggle-view-menu") {
        this.state.viewMenuOpen = !this.state.viewMenuOpen;
        this.renderViewMenu();
      } else if (actionName === "toggle-view") {
        if (!this.options.features.allowTreeView) return;
        this.state.viewMode =
          this.state.viewMode === "tree" ? "list" : "tree";
        this.state.viewMenuOpen = false;
        this.renderSidebar();
      } else if (actionName === "toggle-all-directories") {
        if (!this.options.features.allowTreeView) return;
        const directoryKeys = this.treeDirectoryKeys();
        const willCollapse = directoryKeys.some(
          (key) => !this.state.collapsedDirectories.has(key)
        );
        this.state.collapsedDirectories = willCollapse
          ? new Set(directoryKeys)
          : new Set();
        this.state.viewMenuOpen = false;
        this.renderSidebar();
      } else if (
        actionName === "refresh" &&
        this.options.features.allowRefresh
      ) {
        this.state.viewMenuOpen = false;
        this.renderViewMenu();
        global.showToast?.(
          "变更已刷新",
          "原型保留当前文件，并重新载入工作区变更。",
          "refresh"
        );
      } else if (actionName === "open-standalone") {
        global.showToast?.(
          "独立 Diff 查看器",
          "正式应用会在独立窗口中打开当前文件。",
          "external"
        );
      } else if (
        actionName === "generate-commit-message" &&
        this.options.commit?.aiEnabled
      ) {
        global.showToast?.(
          "AI 生成",
          "实际程序会使用当前 AI 设置生成提交信息。",
          "sparkle"
        );
      } else if (actionName === "commit" && this.canCommit()) {
        const scope = this.stagedCount() > 0
          ? "当前只会提交已暂存变更。"
          : "当前会提交全部未暂存和未跟踪变更。";
        global.showToast?.(
          "提交信息已就绪",
          `${scope} 这是设计预览，不会执行本地 Git 命令。`,
          "commit"
        );
      }
    }

    destroy() {
      this.panel?.destroy();
      this.element.removeEventListener("click", this.handleClick);
      this.element.removeEventListener("input", this.handleInput);
      this.element.ownerDocument.removeEventListener(
        "click",
        this.handleDocumentClick
      );
    }
  }

  function create(options = {}, context = {}) {
    const document = context.document || global.document;
    const element = document.createElement("section");
    element.className = [
      "gn-diff-workspace",
      options.className || ""
    ].filter(Boolean).join(" ");
    element.setAttribute(
      "aria-label",
      options.ariaLabel || "Diff 工作区组件"
    );
    return new DiffWorkspaceController(element, options);
  }

  global.GitNestDiffWorkspace = {
    DiffWorkspaceController,
    create
  };
})(window);

/**
 * GitNest 完整 Diff Workspace 原型组件。
 *
 * 组件封装：
 * - 左侧文件变更筛选、分组、列表/树视图、选择与暂存切换；
 * - 仓库模式的视图菜单、储藏入口和提交信息区域；
 * - 右侧 DiffPanel 或储藏列表 + 储藏文件双栏；
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
      rows: Array.isArray(file.rows) ? file.rows : [],
      fullRows: Array.isArray(file.fullRows) ? file.fullRows : null,
      binary: Boolean(file.binary),
      truncated: Boolean(file.truncated)
    }));
  }

  function normalizedStashes(value) {
    const source = Array.isArray(value) ? { items: value } : value || {};
    const status = ["loading", "error"].includes(source.status)
      ? source.status
      : "ready";
    return {
      status,
      error: source.error || "",
      items: (Array.isArray(source.items) ? source.items : []).map(
        (stash, index) => ({
          hash: stash.hash || `prototype-stash-${index + 1}`,
          ref: stash.ref || `stash@{${index}}`,
          title: stash.title || "未命名储藏",
          branch: stash.branch || "",
          author: stash.author || "原型用户",
          relativeTime: stash.relativeTime || "",
          files: normalizedFiles(stash.files).map((file) => ({
            ...file,
            staged: false
          }))
        })
      )
    };
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
        stashBrowser:
          rawFeatures.stashBrowser !== undefined
            ? Boolean(rawFeatures.stashBrowser)
            : rawOptions.stashes !== undefined,
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
        stashes: normalizedStashes(rawOptions.stashes),
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
          showHunkNavigation: false,
          allowContextExpansion: true
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
        commitPush: Boolean(this.options.commit?.push),
        auxiliaryView: "diff",
        stashFilter: "",
        selectedStashHash:
          rawOptions.selectedStashHash ||
          this.options.stashes.items[0]?.hash ||
          ""
      };
      this.handleClick = this.handleClick.bind(this);
      this.handleDocumentClick = this.handleDocumentClick.bind(this);
      this.handleInput = this.handleInput.bind(this);
      this.handleContextMenu = this.handleContextMenu.bind(this);
      this.handleDocumentKeyDown = this.handleDocumentKeyDown.bind(this);
      this.handleScroll = this.handleScroll.bind(this);
      this.element.addEventListener("click", this.handleClick);
      this.element.addEventListener("input", this.handleInput);
      this.element.addEventListener("contextmenu", this.handleContextMenu);
      this.element.ownerDocument.addEventListener(
        "click",
        this.handleDocumentClick
      );
      this.element.ownerDocument.addEventListener(
        "keydown",
        this.handleDocumentKeyDown
      );
      this.element.ownerDocument.defaultView?.addEventListener(
        "scroll",
        this.handleScroll,
        true
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
          <div class="gn-diff-workspace__content" data-diff-workspace-panel>
            <div class="gn-diff-workspace__diff-view" data-diff-workspace-diff></div>
            <div
              class="gn-diff-workspace__stash-view"
              id="${this.instanceId}-stash-browser"
              data-diff-workspace-stashes
              hidden
            ></div>
          </div>
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
      this.diffMount = this.element.querySelector(
        "[data-diff-workspace-diff]"
      );
      this.stashMount = this.element.querySelector(
        "[data-diff-workspace-stashes]"
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
              <span class="gn-diff-workspace__file-stats" aria-label="新增 ${stats.additions} 行，删除 ${stats.deletions} 行">
                <span class="additions">+${stats.additions}</span>
                <span class="deletions">-${stats.deletions}</span>
              </span>
            </span>
          </button>
          <div class="gn-diff-workspace__file-actions">
            ${buttonMarkup({
              label: mode === "staged" ? "取消暂存" : "暂存",
              ariaLabel: `${mode === "staged" ? "取消暂存" : "暂存"} ${file.path}`,
              title: mode === "staged" ? "取消暂存" : "暂存",
              icon: iconMarkup(mode === "staged" ? "minus" : "plus"),
              variant: "icon",
              className: "gn-diff-workspace__stage-button",
              attributes: `data-diff-workspace-action="toggle-stage" data-file-key="${escapeHtml(file.key)}"`
            })}
            ${mode !== "staged" ? buttonMarkup({
              label: `放弃更改 ${file.path}`,
              ariaLabel: `放弃更改 ${file.path}`,
              title: "放弃更改",
              icon: iconMarkup("undo"),
              variant: "icon",
              className: "gn-diff-workspace__discard-button",
              attributes: `data-diff-workspace-action="discard-file" data-file-key="${escapeHtml(file.key)}"`
            }) : ""}
          </div>
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
          <div class="gn-diff-workspace__section-header has-actions">
            <button
              type="button"
              class="gn-diff-workspace__section-title"
              data-diff-workspace-action="toggle-section"
              data-section-mode="${section.mode}"
              aria-expanded="${!collapsed}"
            >
              <span class="gn-diff-workspace__section-chevron">${iconMarkup("chevron-right")}</span>
              <span>${section.title}</span>
            </button>
            <span class="gn-diff-workspace__section-tail">
              <span class="gn-diff-workspace__section-count">${section.files.length}</span>
              <span class="gn-diff-workspace__section-actions">
                ${section.mode === "staged" ? "" : buttonMarkup({
                  label: `放弃${section.title}分组的更改`,
                  ariaLabel: `放弃${section.title}分组的更改`,
                  title: `放弃更改（${section.files.length} 个文件）`,
                  icon: iconMarkup("undo"),
                  variant: "icon",
                  className: "gn-diff-workspace__discard-button",
                  attributes: `data-diff-workspace-action="discard-section" data-section-mode="${section.mode}"`
                })}
                ${buttonMarkup({
                  label: `${section.mode === "staged" ? "取消暂存" : "暂存"}${section.title}分组的文件`,
                  ariaLabel: `${section.mode === "staged" ? "取消暂存" : "暂存"}${section.title}分组的文件`,
                  title: `${section.mode === "staged" ? "取消暂存" : "暂存"}（${section.files.length} 个文件）`,
                  icon: iconMarkup(section.mode === "staged" ? "minus" : "plus"),
                  variant: "icon",
                  className: "gn-diff-workspace__stage-button",
                  attributes: `data-diff-workspace-action="toggle-section-stage" data-section-mode="${section.mode}"`
                })}
              </span>
            </span>
          </div>
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

    renderStashEntry() {
      if (!this.options.features.stashBrowser) return "";
      const active = this.state.auxiliaryView === "stash";
      const count = this.options.stashes.items.length;
      return `
        <button
          type="button"
          class="gn-diff-workspace__stash-entry${active ? " is-active" : ""}"
          data-diff-workspace-action="toggle-stashes"
          aria-pressed="${active}"
          aria-expanded="${active}"
          aria-controls="${this.instanceId}-stash-browser"
        >
          <span>${iconMarkup("layers")}储藏的变更</span>
          <span class="gn-diff-workspace__stash-count">${count}</span>
        </button>
      `;
    }

    renderCommitComposer() {
      if (!this.options.commit) {
        return "";
      }

      const staged = this.stagedCount();
      const conflicts = this.options.commit.conflicts;
      const canCommit = this.canCommit();
      const pushId = `${this.instanceId}-commit-push`;
      const messageId = `${this.instanceId}-commit-message`;
      const statusText = conflicts > 0
        ? `${conflicts} 个冲突`
        : `${staged} 个已暂存`;

      return `
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

    renderCommitRegion() {
      const stashEntry = this.renderStashEntry();
      const composer = this.renderCommitComposer();
      this.commitMount.innerHTML =
        stashEntry || composer
          ? `${stashEntry}${composer}`
          : "";
    }

    selectedStash() {
      return (
        this.options.stashes.items.find(
          (stash) => stash.hash === this.state.selectedStashHash
        ) ||
        this.options.stashes.items[0] ||
        null
      );
    }

    renderStashBrowser() {
      if (!this.options.features.stashBrowser) return;
      const { status, error, items } = this.options.stashes;
      const selected = this.selectedStash();
      const normalizedFilter =
        this.state.stashFilter.trim().toLocaleLowerCase();
      const selectedFiles = selected?.files || [];
      const visibleFiles = normalizedFilter
        ? selectedFiles.filter((file) =>
            file.path.toLocaleLowerCase().includes(normalizedFilter)
          )
        : selectedFiles;
      const stateMarkup =
        status === "loading"
          ? `<div class="gn-diff-workspace__stash-state" role="status">${iconMarkup("refresh")}<strong>正在载入储藏…</strong><span>正在读取当前仓库的储藏列表。</span></div>`
          : status === "error"
            ? `<div class="gn-diff-workspace__stash-state" role="alert">${iconMarkup("alert")}<strong>无法载入储藏</strong><span>${escapeHtml(error || "请稍后重试。")}</span></div>`
            : items.length === 0
              ? `<div class="gn-diff-workspace__stash-state">${iconMarkup("layers")}<strong>还没有储藏</strong><span>当前仓库没有可浏览的储藏变更。</span></div>`
              : items
                  .map((stash) => {
                    const isSelected = stash.hash === selected?.hash;
                    return `
                      <button
                        type="button"
                        class="gn-diff-workspace__stash-item${isSelected ? " is-selected" : ""}"
                        aria-current="${isSelected}"
                        data-diff-workspace-action="select-stash"
                        data-stash-hash="${escapeHtml(stash.hash)}"
                        aria-haspopup="menu"
                      >
                        <span class="gn-diff-workspace__stash-item-head"><strong>${escapeHtml(stash.ref)}</strong><span>${escapeHtml(stash.relativeTime)}</span></span>
                        <span class="gn-diff-workspace__stash-title">${escapeHtml(stash.title)}</span>
                        <span class="gn-diff-workspace__stash-branch">${escapeHtml(stash.branch || "当前分支")}</span>
                      </button>
                    `;
                  })
                  .join("");
      const filesMarkup = visibleFiles.length
        ? visibleFiles
            .map((file) => {
              const stats = fileStats(file);
              return `
                <div class="gn-diff-workspace__stash-file">
                  <span>${iconMarkup("file")}<strong title="${escapeHtml(file.path)}">${escapeHtml(file.path)}</strong></span>
                  ${file.binary
                    ? '<span class="gn-diff-workspace__stash-binary">二进制</span>'
                    : `<span class="gn-diff-workspace__stash-file-stats"><em>+${stats.additions}</em><i>-${stats.deletions}</i></span>`}
                </div>
              `;
            })
            .join("")
        : `<div class="gn-diff-workspace__stash-state">${iconMarkup(normalizedFilter ? "search" : "file")}<strong>${normalizedFilter ? "没有匹配的文件" : selected ? "这个储藏没有文件" : "选择一个储藏"}</strong><span>${normalizedFilter ? "尝试输入文件名或目录。" : selected ? "没有可展示的文件记录。" : "从左侧列表选择后查看文件。"}</span></div>`;
      this.stashMount.innerHTML = `
        <section class="gn-diff-workspace__stash-pane" aria-label="储藏列表">
          <header><strong>储藏列表</strong><span>${items.length}</span></header>
          <div class="gn-diff-workspace__stash-list" role="list" aria-label="仓库储藏">${stateMarkup}</div>
        </section>
        <section class="gn-diff-workspace__stash-pane" aria-label="储藏文件">
          <header class="gn-diff-workspace__stash-detail-header">
            <div>
              <span><strong>${escapeHtml(selected?.ref || "文件")}</strong>${selected ? `<code>${escapeHtml(selected.hash.slice(0, 8))}</code>` : ""}</span>
              <b>${escapeHtml(selected?.title || "选择一个储藏")}</b>
              ${selected ? `<small>${escapeHtml(selected.author)} · ${escapeHtml(selected.relativeTime || "时间未知")}</small>` : ""}
            </div>
            <span>${selectedFiles.length}</span>
          </header>
          <div class="gn-diff-workspace__stash-file-toolbar">
            <strong>文件</strong>
            <label>
              ${iconMarkup("search")}
              <input
                type="text"
                value="${escapeHtml(this.state.stashFilter)}"
                placeholder="筛选文件"
                aria-label="筛选储藏文件"
                data-diff-workspace-control="stash-filter"
              />
            </label>
          </div>
          <div class="gn-diff-workspace__stash-files">${filesMarkup}</div>
        </section>
      `;
    }

    renderContentVisibility() {
      const stashActive =
        this.options.features.stashBrowser &&
        this.state.auxiliaryView === "stash";
      this.diffMount.hidden = stashActive;
      this.stashMount.hidden = !stashActive;
      if (stashActive) this.renderStashBrowser();
      this.renderStatusbar();
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
      this.renderCommitRegion();
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
        fullRows: selected?.fullRows || null,
        binary: selected?.binary,
        truncated: selected?.truncated,
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
      this.diffMount.replaceChildren(this.panel.element);
      this.renderContentVisibility();
    }

    updatePanel() {
      const selected = this.selectedFile();
      this.panel.update({
        path: selected?.path || "",
        rows: selected?.rows || [],
        fullRows: selected?.fullRows || null,
        binary: selected?.binary,
        truncated: selected?.truncated
      });
      this.renderStatusbar();
    }

    renderStatusbar() {
      if (!this.statusbar) return;
      if (this.state.auxiliaryView === "stash") {
        const stash = this.selectedStash();
        this.statusbar.innerHTML = `
          <span>储藏浏览</span>
          <span>${escapeHtml(stash?.ref || "—")}</span>
          <span class="gn-diff-workspace__status-spacer"></span>
          <span>${stash?.files.length || 0} 个文件</span>
        `;
        return;
      }
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
      } else if (
        event.target.matches(
          '[data-diff-workspace-control="stash-filter"]'
        )
      ) {
        this.state.stashFilter = event.target.value;
        const cursorPosition = event.target.selectionStart;
        this.renderStashBrowser();
        const input = this.stashMount.querySelector(
          '[data-diff-workspace-control="stash-filter"]'
        );
        input?.focus({ preventScroll: true });
        if (
          typeof cursorPosition === "number" &&
          typeof input?.setSelectionRange === "function"
        ) {
          input.setSelectionRange(cursorPosition, cursorPosition);
        }
      }
    }

    handleDocumentClick(event) {
      if (
        this.stashContextMenuElement &&
        !event.composedPath().includes(this.stashContextMenuElement)
      ) {
        this.closeStashContextMenu();
      }
      if (
        this.state.viewMenuOpen &&
        !event.composedPath().includes(this.viewToggleMount)
      ) {
        this.state.viewMenuOpen = false;
        this.renderViewMenu();
      }
    }

    handleContextMenu(event) {
      const item = event.target.closest(
        ".gn-diff-workspace__stash-item[data-stash-hash]"
      );
      if (!item || !this.element.contains(item)) return;
      event.preventDefault();
      event.stopPropagation();
      const hash = item.dataset.stashHash;
      if (!this.options.stashes.items.some((stash) => stash.hash === hash)) {
        return;
      }
      this.state.selectedStashHash = hash;
      this.state.stashFilter = "";
      this.renderStashBrowser();
      this.renderStatusbar();
      this.openStashContextMenu(hash, event.clientX, event.clientY);
    }

    openStashContextMenu(hash, clientX, clientY) {
      this.closeStashContextMenu({ restoreFocus: false });
      const document = this.element.ownerDocument;
      const stash = this.options.stashes.items.find(
        (candidate) => candidate.hash === hash
      );
      if (!stash) return;
      const menu = document.createElement("div");
      menu.className = "gn-diff-workspace__stash-context-menu";
      menu.setAttribute("role", "menu");
      menu.setAttribute(
        "aria-label",
        `${stash.ref} 储藏操作`
      );
      menu.innerHTML = `
        <button type="button" role="menuitem" data-stash-menu-action="restore">${iconMarkup("refresh")}<span>恢复</span></button>
        <button type="button" role="menuitem" class="is-danger" data-stash-menu-action="delete">${iconMarkup("alert")}<span>删除</span></button>
        <button type="button" role="menuitem" class="is-danger" data-stash-menu-action="pop">${iconMarkup("layers")}<span>恢复并删除</span></button>
      `;
      menu.style.left = "0";
      menu.style.top = "0";
      document.body.append(menu);
      const rect = menu.getBoundingClientRect();
      const view = document.defaultView;
      const padding = 8;
      const maximumX = Math.max(
        padding,
        (view?.innerWidth || 0) - rect.width - padding
      );
      const maximumY = Math.max(
        padding,
        (view?.innerHeight || 0) - rect.height - padding
      );
      menu.style.left = `${Math.max(padding, Math.min(clientX, maximumX))}px`;
      menu.style.top = `${Math.max(padding, Math.min(clientY, maximumY))}px`;
      menu.addEventListener("click", (menuEvent) => {
        const action = menuEvent.target.closest("[data-stash-menu-action]");
        if (!action) return;
        this.confirmStashAction(action.dataset.stashMenuAction, hash);
      });
      this.stashContextMenuElement = menu;
      this.stashContextMenuHash = hash;
      view?.setTimeout(() => {
        menu.querySelector('[role="menuitem"]')?.focus();
      }, 0);
    }

    closeStashContextMenu({ restoreFocus = true } = {}) {
      const hash = this.stashContextMenuHash;
      this.stashContextMenuElement?.remove();
      this.stashContextMenuElement = null;
      this.stashContextMenuHash = "";
      if (!restoreFocus || !hash) return;
      [
        ...this.stashMount.querySelectorAll(
          ".gn-diff-workspace__stash-item[data-stash-hash]"
        )
      ]
        .find((item) => item.dataset.stashHash === hash)
        ?.focus();
    }

    handleDocumentKeyDown(event) {
      const menu = this.stashContextMenuElement;
      if (!menu) return;
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeStashContextMenu();
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        return;
      }
      const items = [...menu.querySelectorAll('[role="menuitem"]')];
      if (!items.length) return;
      event.preventDefault();
      const currentIndex = items.indexOf(this.element.ownerDocument.activeElement);
      const nextIndex =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : currentIndex < 0
              ? event.key === "ArrowUp"
                ? items.length - 1
                : 0
            : event.key === "ArrowUp"
              ? (currentIndex - 1 + items.length) % items.length
              : (currentIndex + 1) % items.length;
      items[nextIndex].focus();
    }

    handleScroll() {
      if (this.stashContextMenuElement) {
        this.closeStashContextMenu({ restoreFocus: false });
      }
    }

    confirmStashAction(action, hash) {
      const stash = this.options.stashes.items.find(
        (candidate) => candidate.hash === hash
      );
      if (!stash) return;
      this.closeStashContextMenu({ restoreFocus: false });
      const definitions = {
        restore: {
          title: `恢复 ${stash.ref}？`,
          description:
            "会把这个储藏的内容应用到当前工作区，并保留原储藏记录；如有冲突，需要在工作区中继续处理。",
          label: "确认恢复",
          warning: "原型不会执行 Git，只展示恢复后的交互结果。"
        },
        delete: {
          title: `删除 ${stash.ref}？`,
          description:
            "这个储藏记录及其变更将被永久删除，删除后无法恢复。",
          label: "确认删除",
          warning: "正式操作不可撤销，请确认不再需要其中的变更。"
        },
        pop: {
          title: `恢复并删除 ${stash.ref}？`,
          description:
            "会先把内容应用到当前工作区；只有恢复成功才移除储藏，发生冲突时会保留储藏记录。",
          label: "恢复并删除",
          warning: "原型按成功恢复演示刷新，不会执行真实 Git 命令。"
        }
      };
      const definition = definitions[action];
      if (!definition) return;
      this.openStashConfirmation({
        ...definition,
        destructive: action !== "restore",
        target: `${stash.ref} · ${stash.title}`,
        onConfirm: () => {
          if (action === "restore") {
            global.showToast?.(
              "恢复预览完成",
              `${stash.ref} 的内容将应用到工作区，并保留该储藏；原型未执行 Git。`,
              "refresh"
            );
            return;
          }
          this.removeStashPreview(hash);
          global.showToast?.(
            action === "delete"
              ? "删除预览完成"
              : "恢复并删除预览完成",
            action === "delete"
              ? `${stash.ref} 已从本地 mock 列表移除；原型未执行 Git，正式删除不可恢复。`
              : `${stash.ref} 按恢复成功预览从 mock 列表移除；若真实操作发生冲突，储藏会保留。`,
            action === "delete" ? "alert" : "layers"
          );
        }
      });
    }

    openStashConfirmation({
      title,
      description,
      label,
      warning,
      target,
      destructive,
      onConfirm
    }) {
      this.stashDialogCleanup?.({ restoreFocus: false });
      const document = this.element.ownerDocument;
      const previousFocus = document.activeElement;
      const overlay = document.createElement("div");
      overlay.className = "gn-diff-discard-overlay";
      overlay.innerHTML = `
        <section class="gn-diff-discard-dialog gn-diff-stash-dialog${destructive ? "" : " is-restore"}" role="alertdialog" aria-modal="true">
          <header class="gn-diff-discard-dialog__header">
            <span class="gn-diff-discard-dialog__icon">${iconMarkup(destructive ? "alert" : "refresh")}</span>
            <div>
              <span class="gn-diff-discard-dialog__eyebrow">储藏操作</span>
              <h2>${escapeHtml(title)}</h2>
              <p>${escapeHtml(description)}</p>
            </div>
          </header>
          <div class="gn-diff-discard-dialog__body">
            <div class="gn-diff-discard-dialog__warning">${iconMarkup(destructive ? "alert" : "refresh")}<span>${escapeHtml(warning)}</span></div>
            <div class="gn-diff-discard-dialog__target"><span>目标储藏</span><code>${escapeHtml(target)}</code></div>
          </div>
          <footer class="gn-diff-discard-dialog__footer">
            <p>当前为交互原型，不执行 Git 命令。</p>
            <div>
              ${buttonMarkup({ label: "取消", attributes: 'data-stash-dialog-action="cancel"' })}
              ${buttonMarkup({
                label,
                icon: iconMarkup(destructive ? "alert" : "refresh"),
                variant: destructive ? "danger" : "primary",
                emphasis: "strong",
                attributes: 'data-stash-dialog-action="confirm"'
              })}
            </div>
          </footer>
        </section>
      `;
      const close = ({ restoreFocus = true } = {}) => {
        document.removeEventListener("keydown", handleKeyDown);
        overlay.remove();
        if (this.stashDialogCleanup === close) {
          this.stashDialogCleanup = null;
        }
        if (restoreFocus && previousFocus?.isConnected) previousFocus.focus();
      };
      const handleKeyDown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
          return;
        }
        if (event.key !== "Tab") return;
        const buttons = [...overlay.querySelectorAll("button:not([disabled])")];
        const first = buttons[0];
        const last = buttons.at(-1);
        if (!first || !last) return;
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            !overlay.contains(document.activeElement))
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !overlay.contains(document.activeElement))
        ) {
          event.preventDefault();
          first.focus();
        }
      };
      overlay.addEventListener("pointerup", (event) => {
        if (event.target === overlay) close();
      });
      overlay
        .querySelector('[data-stash-dialog-action="cancel"]')
        ?.addEventListener("click", () => close());
      overlay
        .querySelector('[data-stash-dialog-action="confirm"]')
        ?.addEventListener("click", () => {
          close({ restoreFocus: false });
          onConfirm();
        });
      document.addEventListener("keydown", handleKeyDown);
      document.body.append(overlay);
      this.stashDialogCleanup = close;
      overlay
        .querySelector('[data-stash-dialog-action="cancel"]')
        ?.focus();
    }

    removeStashPreview(hash) {
      const index = this.options.stashes.items.findIndex(
        (stash) => stash.hash === hash
      );
      if (index < 0) return;
      this.options.stashes.items.splice(index, 1);
      const next =
        this.options.stashes.items[index] ||
        this.options.stashes.items[index - 1] ||
        null;
      this.state.selectedStashHash = next?.hash || "";
      this.state.stashFilter = "";
      this.renderCommitRegion();
      this.renderStashBrowser();
      this.renderStatusbar();
    }

    openDiscardConfirmation(files, onConfirm, scope = "file") {
      this.discardDialogCleanup?.({ restoreFocus: false });
      const document = this.element.ownerDocument;
      const previousFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      const untrackedCount = files.filter(
        (file) => fileMode(file) === "untracked"
      ).length;
      const singleFile = scope === "file" ? files[0] : null;
      const title = singleFile
        ? untrackedCount > 0
          ? "永久删除未跟踪文件？"
          : `放弃对“${singleFile.path}”的更改？`
        : `放弃 ${files.length} 个文件的更改？`;
      const targetSummary = singleFile
        ? singleFile.path
        : `${files.length} 个文件${
            untrackedCount > 0
              ? ` · ${untrackedCount} 个未跟踪文件`
              : ""
          }`;
      const warning = untrackedCount > 0
        ? `正式应用中，其中 ${untrackedCount} 个未跟踪文件将从磁盘永久删除，不会移入回收站，且无法撤销。`
        : "正式应用中，工作区中的修改将被还原，此操作无法撤销。";
      const titleId = `${this.instanceId}-discard-title`;
      const descriptionId = `${this.instanceId}-discard-description`;
      const overlay = document.createElement("div");
      overlay.className = "gn-diff-discard-overlay";
      overlay.innerHTML = `
        <section
          class="gn-diff-discard-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="${titleId}"
          aria-describedby="${descriptionId}"
        >
          <header class="gn-diff-discard-dialog__header">
            <span class="gn-diff-discard-dialog__icon">
              ${iconMarkup("alert")}
            </span>
            <div>
              <span class="gn-diff-discard-dialog__eyebrow">危险操作</span>
              <h2 id="${titleId}">${escapeHtml(title)}</h2>
              <p id="${descriptionId}">确认后将立即处理当前工作区内容。</p>
            </div>
          </header>
          <div class="gn-diff-discard-dialog__body">
            <div class="gn-diff-discard-dialog__warning">
              ${iconMarkup("alert")}
              <span>${escapeHtml(warning)}</span>
            </div>
            <div class="gn-diff-discard-dialog__target">
              <span>${singleFile ? "目标文件" : "影响范围"}</span>
              <code title="${escapeHtml(targetSummary)}">${escapeHtml(targetSummary)}</code>
            </div>
          </div>
          <footer class="gn-diff-discard-dialog__footer">
            <p>当前为原型预览，不执行 Git 命令。</p>
            <div>
              ${buttonMarkup({
                label: "取消",
                attributes: 'data-diff-discard-action="cancel"'
              })}
              ${buttonMarkup({
                label:
                  untrackedCount > 0
                    ? "永久删除并放弃"
                    : "确认放弃",
                icon: iconMarkup("alert"),
                variant: "danger",
                emphasis: "strong",
                attributes: 'data-diff-discard-action="confirm"'
              })}
            </div>
          </footer>
        </section>
      `;

      const close = ({ restoreFocus = true } = {}) => {
        document.removeEventListener("keydown", handleKeyDown);
        overlay.remove();
        if (this.discardDialogCleanup === close) {
          this.discardDialogCleanup = null;
        }
        if (restoreFocus && previousFocus?.isConnected) {
          previousFocus.focus();
        }
      };
      const handleKeyDown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
          return;
        }
        if (event.key !== "Tab") return;
        const focusable = [
          ...overlay.querySelectorAll("button:not([disabled])")
        ];
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) return;
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            !overlay.contains(document.activeElement))
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !overlay.contains(document.activeElement))
        ) {
          event.preventDefault();
          first.focus();
        }
      };

      overlay.addEventListener("pointerup", (event) => {
        if (event.target === overlay) {
          close();
        }
      });
      overlay
        .querySelector('[data-diff-discard-action="cancel"]')
        ?.addEventListener("click", () => close());
      overlay
        .querySelector('[data-diff-discard-action="confirm"]')
        ?.addEventListener("click", () => {
          close({ restoreFocus: false });
          onConfirm();
        });
      document.addEventListener("keydown", handleKeyDown);
      document.body.append(overlay);
      this.discardDialogCleanup = close;
      overlay
        .querySelector('[data-diff-discard-action="cancel"]')
        ?.focus();
    }

    discardFiles(files) {
      const discarded = new Set(files.map((file) => file.key));
      this.options.files = this.options.files.filter(
        (file) => !discarded.has(file.key)
      );
      if (discarded.has(this.state.selectedKey)) {
        this.state.selectedKey = this.options.files[0]?.key || "";
      }
      this.renderSidebar();
      this.updatePanel();
      global.showToast?.(
        "放弃更改",
        files.length === 1
          ? `${files[0].path}（原型预览，不执行 Git 命令）`
          : `${discarded.size} 个文件（原型预览，不执行 Git 命令）`
      );
    }

    handleClick(event) {
      const action = event.target.closest("[data-diff-workspace-action]");
      if (!action || !this.element.contains(action)) return;
      const actionName = action.dataset.diffWorkspaceAction;
      if (actionName === "select-file") {
        this.state.selectedKey = action.dataset.fileKey;
        this.state.auxiliaryView = "diff";
        this.renderSidebar();
        this.updatePanel();
        this.renderContentVisibility();
      } else if (actionName === "toggle-stashes") {
        this.state.auxiliaryView =
          this.state.auxiliaryView === "stash" ? "diff" : "stash";
        const active = this.state.auxiliaryView === "stash";
        action.classList.toggle("is-active", active);
        action.setAttribute("aria-pressed", String(active));
        action.setAttribute("aria-expanded", String(active));
        this.renderContentVisibility();
      } else if (actionName === "select-stash") {
        this.state.selectedStashHash = action.dataset.stashHash;
        this.state.stashFilter = "";
        this.renderStashBrowser();
        this.renderStatusbar();
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
      } else if (actionName === "toggle-section-stage") {
        const mode = action.dataset.sectionMode;
        const section = this.fileSections().find(
          (candidate) => candidate.mode === mode
        );
        if (!section || section.files.length === 0) return;
        const nextStaged = mode !== "staged";
        section.files.forEach((file) => {
          file.staged = nextStaged;
        });
        this.renderSidebar();
        this.updatePanel();
        global.showToast?.(
          nextStaged ? "暂存" : "取消暂存",
          `${section.files.length} 个文件（原型预览，不执行 Git 命令）`
        );
      } else if (actionName === "discard-section") {
        const mode = action.dataset.sectionMode;
        const section = this.fileSections().find(
          (candidate) => candidate.mode === mode
        );
        if (!section || section.files.length === 0) return;
        const files = [...section.files];
        this.openDiscardConfirmation(
          files,
          () => this.discardFiles(files),
          "group"
        );
      } else if (actionName === "discard-file") {
        const key = action.dataset.fileKey;
        const file = this.options.files.find(
          (candidate) => candidate.key === key
        );
        if (!file) return;
        this.openDiscardConfirmation(
          [file],
          () => this.discardFiles([file]),
          "file"
        );
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
      this.discardDialogCleanup?.({ restoreFocus: false });
      this.stashDialogCleanup?.({ restoreFocus: false });
      this.closeStashContextMenu({ restoreFocus: false });
      this.panel?.destroy();
      this.element.removeEventListener("click", this.handleClick);
      this.element.removeEventListener("input", this.handleInput);
      this.element.removeEventListener("contextmenu", this.handleContextMenu);
      this.element.ownerDocument.removeEventListener(
        "click",
        this.handleDocumentClick
      );
      this.element.ownerDocument.removeEventListener(
        "keydown",
        this.handleDocumentKeyDown
      );
      this.element.ownerDocument.defaultView?.removeEventListener(
        "scroll",
        this.handleScroll,
        true
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

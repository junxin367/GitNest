/**
 * GitNest Diff 面板原型组件。
 *
 * 用于规范 HTML 中呈现与正式 React DiffPanel 相同的交互边界：
 * - unified / split 布局；
 * - 自动换行；
 * - hunk 导航；
 * - 路径复制；
 * - 面板内 Ctrl+F 搜索。
 */
(function attachGitNestDiffPanel(global) {
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
    if (!global.GitNestButton?.render) {
      throw new Error("GitNestDiffPanel requires GitNestButton.");
    }
    return global.GitNestButton.render({
      size: "small",
      type: "button",
      ...options
    });
  }

  function normalizeConfig(config = {}) {
    const layouts = Array.isArray(config.layouts) && config.layouts.length
      ? config.layouts.filter((layout) => layout === "split" || layout === "unified")
      : ["unified"];
    const normalizedLayouts = layouts.length ? layouts : ["unified"];
    return {
      layouts: normalizedLayouts,
      defaultLayout: normalizedLayouts.includes(config.defaultLayout)
        ? config.defaultLayout
        : normalizedLayouts[0],
      showToolbar: config.showToolbar !== false,
      allowWrap: Boolean(config.allowWrap),
      showHunkNavigation: Boolean(config.showHunkNavigation)
    };
  }

  function statsForRows(rows) {
    return rows.reduce(
      (stats, row) => {
        if (row.kind === "pair") {
          stats.additions += 1;
          stats.deletions += 1;
        } else if (row.kind === "add") {
          stats.additions += 1;
        } else if (row.kind === "delete") {
          stats.deletions += 1;
        } else if (row.kind === "hunk") {
          stats.hunks += 1;
        }
        return stats;
      },
      { additions: 0, deletions: 0, hunks: 0 }
    );
  }

  function searchEntries(rows) {
    const entries = [];
    rows.forEach((row, rowIndex) => {
      if (row.kind === "hunk") {
        entries.push({ key: `${rowIndex}:hunk`, text: row.text || "" });
      } else if (row.kind === "pair") {
        entries.push({ key: `${rowIndex}:old`, text: row.oldText || "" });
        entries.push({ key: `${rowIndex}:new`, text: row.newText || "" });
      } else {
        entries.push({
          key: `${rowIndex}:${row.kind}`,
          text: row.text || ""
        });
      }
    });
    return entries;
  }

  function collectSearchHits(rows, query) {
    const keyword = String(query || "").trim().toLocaleLowerCase();
    if (!keyword) return [];

    let id = 0;
    return searchEntries(rows).flatMap((entry) => {
      const normalized = entry.text.toLocaleLowerCase();
      const matches = [];
      let start = normalized.indexOf(keyword);
      while (start >= 0) {
        matches.push({
          id: id++,
          key: entry.key,
          start,
          end: start + keyword.length
        });
        start = normalized.indexOf(keyword, start + keyword.length);
      }
      return matches;
    });
  }

  function highlightedText(value, key, hits, activeHit) {
    const text = String(value || "");
    const lineHits = hits.filter((hit) => hit.key === key);
    if (!lineHits.length) return escapeHtml(text || " ");

    let cursor = 0;
    return `${lineHits.map((hit) => {
      const before = escapeHtml(text.slice(cursor, hit.start));
      const highlighted = escapeHtml(text.slice(hit.start, hit.end));
      cursor = hit.end;
      return `${before}<mark class="gn-diff-panel__search-hit${hit.id === activeHit ? " is-current" : ""}" data-diff-search-hit="${hit.id}">${highlighted}</mark>`;
    }).join("")}${escapeHtml(text.slice(cursor))}`;
  }

  function lineCell(kind, lineNumber, text, key, hits, activeHit) {
    const marker = kind === "removed" ? "−" : kind === "added" ? "+" : "";
    return `
      <span class="gn-diff-panel__line-number ${kind}">${lineNumber ?? ""}</span>
      <span class="gn-diff-panel__change-marker ${kind}">${marker}</span>
      <span class="gn-diff-panel__code-cell ${kind}"><code>${highlightedText(text, key, hits, activeHit)}</code></span>
    `;
  }

  function emptyCell() {
    return `
      <span class="gn-diff-panel__line-number empty"></span>
      <span class="gn-diff-panel__change-marker empty"></span>
      <span class="gn-diff-panel__code-cell empty"><code> </code></span>
    `;
  }

  class DiffPanelController {
    constructor(element, rawOptions = {}) {
      this.element = element;
      this.options = {
        path: rawOptions.path || "",
        rows: Array.isArray(rawOptions.rows) ? rawOptions.rows : [],
        headerActions:
          typeof rawOptions.headerActions === "string"
            ? rawOptions.headerActions
            : "",
        config: normalizeConfig(rawOptions.config)
      };
      this.state = {
        layout: this.options.config.defaultLayout,
        wrap: false,
        activeHunk: 0,
        searchOpen: false,
        searchQuery: "",
        activeSearchHit: 0,
        pathCopied: false
      };
      this.copyResetTimer = 0;
      this.splitScrollCleanup = null;
      this.handleClick = this.handleClick.bind(this);
      this.handleKeydown = this.handleKeydown.bind(this);
      this.element.addEventListener("click", this.handleClick);
      this.element.addEventListener("keydown", this.handleKeydown);
      this.render();
    }

    normalizedActiveSearchHit(hits) {
      if (!hits.length) {
        this.state.activeSearchHit = 0;
        return -1;
      }
      this.state.activeSearchHit =
        ((this.state.activeSearchHit % hits.length) + hits.length) %
        hits.length;
      return this.state.activeSearchHit;
    }

    normalizedActiveHunk(stats) {
      if (!stats.hunks) {
        this.state.activeHunk = 0;
        return -1;
      }
      this.state.activeHunk =
        ((this.state.activeHunk % stats.hunks) + stats.hunks) %
        stats.hunks;
      return this.state.activeHunk;
    }

    renderHunk(row, rowIndex, hits, activeSearchHit, activeHunk) {
      const hunkIndex = this.options.rows
        .slice(0, rowIndex + 1)
        .filter((item) => item.kind === "hunk").length - 1;
      return `
        <div
          class="gn-diff-panel__wide-row${hunkIndex === activeHunk ? " is-current" : ""}"
          data-diff-hunk="${hunkIndex}"
        >
          ${iconMarkup("diff")}
          <code>${highlightedText(row.text, `${rowIndex}:hunk`, hits, activeSearchHit)}</code>
        </div>
      `;
    }

    renderUnifiedRow(row, rowIndex, hits, activeSearchHit, activeHunk) {
      if (row.kind === "hunk") {
        return this.renderHunk(
          row,
          rowIndex,
          hits,
          activeSearchHit,
          activeHunk
        );
      }

      const unifiedLine = (kind, oldNo, newNo, text, key) => `
        <div class="gn-diff-panel__row">
          <span class="gn-diff-panel__line-number ${kind}">${oldNo ?? ""}</span>
          <span class="gn-diff-panel__line-number ${kind}">${newNo ?? ""}</span>
          <span class="gn-diff-panel__change-marker ${kind}">${kind === "removed" ? "−" : kind === "added" ? "+" : ""}</span>
          <span class="gn-diff-panel__code-cell ${kind}"><code>${highlightedText(text, key, hits, activeSearchHit)}</code></span>
        </div>
      `;

      if (row.kind === "context") {
        return unifiedLine(
          "context",
          row.oldNo,
          row.newNo,
          row.text,
          `${rowIndex}:context`
        );
      }
      if (row.kind === "pair") {
        return `
          ${unifiedLine("removed", row.oldNo, null, row.oldText, `${rowIndex}:old`)}
          ${unifiedLine("added", null, row.newNo, row.newText, `${rowIndex}:new`)}
        `;
      }
      if (row.kind === "delete") {
        return unifiedLine(
          "removed",
          row.oldNo,
          null,
          row.text,
          `${rowIndex}:delete`
        );
      }
      return unifiedLine(
        "added",
        null,
        row.newNo,
        row.text,
        `${rowIndex}:add`
      );
    }

    renderSplitRow(row, rowIndex, hits, activeSearchHit, activeHunk) {
      if (row.kind === "hunk") {
        return this.renderHunk(
          row,
          rowIndex,
          hits,
          activeSearchHit,
          activeHunk
        );
      }

      let oldCell = emptyCell();
      let newCell = emptyCell();
      if (row.kind === "context") {
        oldCell = lineCell(
          "context",
          row.oldNo,
          row.text,
          `${rowIndex}:context`,
          hits,
          activeSearchHit
        );
        newCell = lineCell(
          "context",
          row.newNo,
          row.text,
          `${rowIndex}:context`,
          hits,
          activeSearchHit
        );
      } else if (row.kind === "pair") {
        oldCell = lineCell(
          "removed",
          row.oldNo,
          row.oldText,
          `${rowIndex}:old`,
          hits,
          activeSearchHit
        );
        newCell = lineCell(
          "added",
          row.newNo,
          row.newText,
          `${rowIndex}:new`,
          hits,
          activeSearchHit
        );
      } else if (row.kind === "delete") {
        oldCell = lineCell(
          "removed",
          row.oldNo,
          row.text,
          `${rowIndex}:delete`,
          hits,
          activeSearchHit
        );
      } else {
        newCell = lineCell(
          "added",
          row.newNo,
          row.text,
          `${rowIndex}:add`,
          hits,
          activeSearchHit
        );
      }

      return `
        <div class="gn-diff-panel__row split">
          ${oldCell}
          ${newCell}
        </div>
      `;
    }

    renderSplitPaneRow(
      row,
      rowIndex,
      side,
      hits,
      activeSearchHit,
      activeHunk
    ) {
      if (row.kind === "hunk") {
        return this.renderHunk(
          row,
          rowIndex,
          hits,
          activeSearchHit,
          activeHunk
        );
      }

      let cell = emptyCell();
      if (row.kind === "context") {
        cell = lineCell(
          "context",
          side === "old" ? row.oldNo : row.newNo,
          row.text,
          `${rowIndex}:context`,
          hits,
          activeSearchHit
        );
      } else if (row.kind === "pair") {
        cell = lineCell(
          side === "old" ? "removed" : "added",
          side === "old" ? row.oldNo : row.newNo,
          side === "old" ? row.oldText : row.newText,
          `${rowIndex}:${side}`,
          hits,
          activeSearchHit
        );
      } else if (row.kind === "delete" && side === "old") {
        cell = lineCell(
          "removed",
          row.oldNo,
          row.text,
          `${rowIndex}:delete`,
          hits,
          activeSearchHit
        );
      } else if (row.kind === "add" && side === "new") {
        cell = lineCell(
          "added",
          row.newNo,
          row.text,
          `${rowIndex}:add`,
          hits,
          activeSearchHit
        );
      }

      return `
        <div class="gn-diff-panel__split-pane-row">
          ${cell}
        </div>
      `;
    }

    renderSplitNoWrap(
      rows,
      hits,
      activeSearchHit,
      activeHunk
    ) {
      const paneMarkup = (side) => rows.map((row, rowIndex) =>
        this.renderSplitPaneRow(
          row,
          rowIndex,
          side,
          hits,
          activeSearchHit,
          activeHunk
        )
      ).join("");

      return `
        <div class="gn-diff-panel__split-shell" data-diff-split-shell>
          <div class="gn-diff-panel__split-scroll-region">
            <div class="gn-diff-panel__split-metadata"></div>
            <div class="gn-diff-panel__split-panes">
              <div
                class="gn-diff-panel__split-pane old"
                data-diff-split-pane
                aria-label="原文件"
              >
                <div
                  class="gn-diff-panel__split-pane-content"
                  data-diff-split-content
                >
                  ${paneMarkup("old")}
                </div>
              </div>
              <div
                class="gn-diff-panel__split-pane new"
                data-diff-split-pane
                aria-label="新文件"
              >
                <div
                  class="gn-diff-panel__split-pane-content"
                  data-diff-split-content
                >
                  ${paneMarkup("new")}
                </div>
              </div>
            </div>
          </div>
          <div
            class="gn-diff-panel__split-scrollbar"
            data-diff-split-scrollbar
            role="region"
            aria-label="并排 Diff 水平滚动"
            tabindex="0"
          >
            <div
              class="gn-diff-panel__split-scrollbar-track"
              data-diff-split-scrollbar-track
            ></div>
          </div>
        </div>
      `;
    }

    teardownSplitScrolling() {
      this.splitScrollCleanup?.();
      this.splitScrollCleanup = null;
    }

    setupSplitScrolling() {
      const panes = [
        ...this.element.querySelectorAll("[data-diff-split-pane]")
      ];
      const contents = [
        ...this.element.querySelectorAll("[data-diff-split-content]")
      ];
      const shell = this.element.querySelector(
        "[data-diff-split-shell]"
      );
      const scrollbar = this.element.querySelector(
        "[data-diff-split-scrollbar]"
      );
      const scrollbarTrack = this.element.querySelector(
        "[data-diff-split-scrollbar-track]"
      );

      if (
        panes.length !== 2 ||
        contents.length !== 2 ||
        !shell ||
        !scrollbar ||
        !scrollbarTrack
      ) {
        return;
      }

      const scrollTargets = [...panes, scrollbar];
      const syncScroll = (source) => {
        scrollTargets.forEach((target) => {
          if (
            target !== source &&
            target.scrollLeft !== source.scrollLeft
          ) {
            target.scrollLeft = source.scrollLeft;
          }
        });
      };
      const scrollHandlers = scrollTargets.map((target) => {
        const handler = () => syncScroll(target);
        target.addEventListener("scroll", handler);
        return [target, handler];
      });
      const updateMetrics = () => {
        contents.forEach((content) => {
          content.style.removeProperty("min-width");
        });
        const paneWidth = Math.min(
          panes[0].clientWidth,
          panes[1].clientWidth
        );
        const contentWidth = Math.max(
          paneWidth,
          panes[0].scrollWidth,
          panes[1].scrollWidth
        );
        contents.forEach((content) => {
          content.style.minWidth = `${contentWidth}px`;
        });
        scrollbarTrack.style.width = `${
          contentWidth +
          Math.max(0, scrollbar.clientWidth - paneWidth)
        }px`;
        const maximumScrollLeft = Math.max(
          0,
          contentWidth - paneWidth
        );
        scrollbar.scrollLeft = Math.min(
          scrollbar.scrollLeft,
          maximumScrollLeft
        );
        syncScroll(scrollbar);
      };
      const frame = global.requestAnimationFrame(updateMetrics);
      const observer =
        typeof global.ResizeObserver === "undefined"
          ? null
          : new global.ResizeObserver(updateMetrics);
      observer?.observe(shell);
      global.addEventListener("resize", updateMetrics);
      this.splitScrollCleanup = () => {
        global.cancelAnimationFrame(frame);
        observer?.disconnect();
        global.removeEventListener("resize", updateMetrics);
        scrollHandlers.forEach(([target, handler]) => {
          target.removeEventListener("scroll", handler);
        });
      };
    }

    renderToolbar(stats, activeHunk) {
      const config = this.options.config;
      const hasToolbar =
        config.showToolbar &&
        (
          config.layouts.length > 1 ||
          config.allowWrap ||
          config.showHunkNavigation
        );
      if (!hasToolbar) return "";

      return `
        <div class="gn-diff-panel__toolbar" role="toolbar" aria-label="Diff 查看工具">
          <span class="gn-diff-panel__toolbar-spacer"></span>
          ${config.layouts.length > 1 ? `
            <div class="gn-diff-panel__segmented" role="group" aria-label="Diff 布局">
              ${config.layouts.includes("split") ? buttonMarkup({
                label: "并排",
                variant: "toolbar",
                selected: this.state.layout === "split",
                attributes: `data-diff-action="layout" data-diff-layout="split" aria-pressed="${this.state.layout === "split"}"`
              }) : ""}
              ${config.layouts.includes("unified") ? buttonMarkup({
                label: "统一",
                variant: "toolbar",
                selected: this.state.layout === "unified",
                attributes: `data-diff-action="layout" data-diff-layout="unified" aria-pressed="${this.state.layout === "unified"}"`
              }) : ""}
            </div>
          ` : ""}
          ${config.allowWrap ? buttonMarkup({
            label: "自动换行",
            ariaLabel: "自动换行",
            icon: iconMarkup("wrap"),
            variant: "toolbar",
            selected: this.state.wrap,
            attributes: `data-diff-action="wrap" aria-pressed="${this.state.wrap}"`
          }) : ""}
          ${config.showHunkNavigation ? `
            <span class="gn-diff-panel__toolbar-separator" aria-hidden="true"></span>
            <div class="gn-diff-panel__hunk-navigation" role="group" aria-label="变更导航">
              ${buttonMarkup({
                label: "上一处变更",
                ariaLabel: "上一处变更",
                title: "上一处变更",
                icon: iconMarkup("arrow-up"),
                variant: "icon",
                disabled: stats.hunks === 0,
                attributes: 'data-diff-action="previous-hunk"'
              })}
              <span class="gn-diff-panel__hunk-count">${activeHunk >= 0 ? activeHunk + 1 : 0} / ${stats.hunks}</span>
              ${buttonMarkup({
                label: "下一处变更",
                ariaLabel: "下一处变更",
                title: "下一处变更",
                icon: iconMarkup("arrow-down"),
                variant: "icon",
                disabled: stats.hunks === 0,
                attributes: 'data-diff-action="next-hunk"'
              })}
            </div>
          ` : ""}
        </div>
      `;
    }

    render({ focusSearch = false, scrollToSearchHit = false, scrollToHunk = false } = {}) {
      this.teardownSplitScrolling();
      const rows = this.options.rows;
      const stats = statsForRows(rows);
      const hits = collectSearchHits(rows, this.state.searchQuery);
      const activeSearchHit = this.normalizedActiveSearchHit(hits);
      const activeHunk = this.normalizedActiveHunk(stats);
      const hasToolbar =
        this.options.config.showToolbar &&
        (
          this.options.config.layouts.length > 1 ||
          this.options.config.allowWrap ||
          this.options.config.showHunkNavigation
        );
      const splitNoWrap =
        rows.length > 0 &&
        this.state.layout === "split" &&
        !this.state.wrap;
      const tableRows = rows.map((row, rowIndex) =>
        this.state.layout === "split"
          ? this.renderSplitRow(
              row,
              rowIndex,
              hits,
              activeSearchHit,
              activeHunk
            )
          : this.renderUnifiedRow(
              row,
              rowIndex,
              hits,
              activeSearchHit,
              activeHunk
            )
      ).join("");

      this.element.dataset.toolbar = String(hasToolbar);
      this.element.dataset.layout = this.state.layout;
      this.element.dataset.wrap = String(this.state.wrap);
      this.element.innerHTML = `
        ${this.renderToolbar(stats, activeHunk)}
        <main class="gn-diff-panel__main">
          <header class="gn-diff-panel__file-header">
            <div class="gn-diff-panel__file-heading">
              ${buttonMarkup({
                label: this.state.pathCopied ? "文件路径已复制" : "复制文件路径",
                ariaLabel: this.state.pathCopied ? "文件路径已复制" : "复制文件路径",
                title: this.state.pathCopied ? "文件路径已复制" : "复制完整文件路径",
                icon: iconMarkup(this.state.pathCopied ? "check" : "file"),
                variant: "icon",
                className: `gn-diff-panel__path-button${this.state.pathCopied ? " is-copied" : ""}`,
                disabled: !this.options.path,
                attributes: 'data-diff-action="copy-path"'
              })}
              <span class="gn-diff-panel__file-path" title="${escapeHtml(this.options.path)}">${escapeHtml(this.options.path || "选择一个文件")}</span>
            </div>
            <div class="gn-diff-panel__header-actions">
              <span class="gn-diff-panel__stats" aria-label="新增 ${stats.additions} 行，删除 ${stats.deletions} 行">
                <strong>+${stats.additions}</strong>
                <em>-${stats.deletions}</em>
              </span>
              ${this.options.headerActions ? `
                <span class="gn-diff-panel__file-header-separator" aria-hidden="true"></span>
                <span class="gn-diff-panel__header-action-slot">
                  ${this.options.headerActions}
                </span>
              ` : ""}
            </div>
          </header>
          <div class="gn-diff-panel__search" data-diff-search-mount></div>
          <div class="gn-diff-panel__viewport${splitNoWrap ? " split-nowrap" : ""}" role="region" aria-label="文件 Diff" tabindex="0">
            ${rows.length ? `
              ${splitNoWrap
                ? this.renderSplitNoWrap(
                    rows,
                    hits,
                    activeSearchHit,
                    activeHunk
                  )
                : `
                    <div class="gn-diff-panel__table ${this.state.layout}">
                      ${tableRows}
                    </div>
                  `}
            ` : `
              <div class="gn-diff-panel__empty">
                ${iconMarkup("file")}
                <strong>没有文本内容差异</strong>
                <span>选择文件后显示 Diff。</span>
              </div>
            `}
          </div>
        </main>
      `;

      if (splitNoWrap) {
        this.setupSplitScrolling();
      }

      const searchMount = this.element.querySelector("[data-diff-search-mount]");
      this.searchPopover = global.GitNestDiffSearchPopover.create({
        open: this.state.searchOpen,
        value: this.state.searchQuery,
        countLabel: this.state.searchQuery.trim()
          ? `${activeSearchHit >= 0 ? activeSearchHit + 1 : 0} / ${hits.length}`
          : "0 / 0",
        hasMatches: hits.length > 0,
        inputAriaLabel: "在 Diff 中搜索",
        icons: {
          search: iconMarkup("search"),
          previous: iconMarkup("arrow-up"),
          next: iconMarkup("arrow-down"),
          close: iconMarkup("x")
        },
        onInput: (value) => {
          this.state.searchQuery = value;
          this.state.activeSearchHit = 0;
          this.render({ focusSearch: true, scrollToSearchHit: true });
        },
        onPrevious: () => this.moveSearch(-1),
        onNext: () => this.moveSearch(1),
        onClose: () => this.closeSearch()
      });
      searchMount.replaceChildren(this.searchPopover.element);

      if (focusSearch) {
        this.searchPopover.focus({ preventScroll: true });
      }
      if (scrollToSearchHit && activeSearchHit >= 0) {
        this.element
          .querySelector(`[data-diff-search-hit="${activeSearchHit}"]`)
          ?.scrollIntoView({ block: "center", inline: "nearest" });
      }
      if (scrollToHunk && activeHunk >= 0) {
        this.element
          .querySelector(`[data-diff-hunk="${activeHunk}"]`)
          ?.scrollIntoView({ block: "center", inline: "nearest" });
      }
    }

    openSearch() {
      this.state.searchOpen = true;
      this.render({ focusSearch: true, scrollToSearchHit: true });
    }

    closeSearch() {
      this.state.searchOpen = false;
      this.state.searchQuery = "";
      this.state.activeSearchHit = 0;
      this.render();
      this.element.querySelector(".gn-diff-panel__viewport")?.focus({
        preventScroll: true
      });
    }

    moveSearch(direction) {
      const hits = collectSearchHits(
        this.options.rows,
        this.state.searchQuery
      );
      if (!hits.length) return;
      this.state.activeSearchHit += direction;
      this.render({ focusSearch: true, scrollToSearchHit: true });
    }

    moveHunk(direction) {
      const stats = statsForRows(this.options.rows);
      if (!stats.hunks) return;
      this.state.activeHunk += direction;
      this.render({ scrollToHunk: true });
    }

    async copyPath() {
      if (!this.options.path) return;
      try {
        await global.navigator.clipboard.writeText(this.options.path);
      } catch {
        const textarea = global.document.createElement("textarea");
        textarea.value = this.options.path;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        global.document.body.appendChild(textarea);
        textarea.select();
        global.document.execCommand("copy");
        textarea.remove();
      }
      this.state.pathCopied = true;
      this.render();
      global.clearTimeout(this.copyResetTimer);
      this.copyResetTimer = global.setTimeout(() => {
        this.state.pathCopied = false;
        this.render();
      }, 1800);
    }

    handleClick(event) {
      const action = event.target.closest("[data-diff-action]");
      if (!action || !this.element.contains(action)) return;
      const actionName = action.dataset.diffAction;
      if (actionName === "layout") {
        this.state.layout = action.dataset.diffLayout;
        this.render();
      } else if (actionName === "wrap") {
        this.state.wrap = !this.state.wrap;
        this.render();
      } else if (actionName === "previous-hunk") {
        this.moveHunk(-1);
      } else if (actionName === "next-hunk") {
        this.moveHunk(1);
      } else if (actionName === "copy-path") {
        void this.copyPath();
      }
    }

    handleKeydown(event) {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLocaleLowerCase() === "f"
      ) {
        event.preventDefault();
        this.openSearch();
      }
    }

    update(nextOptions = {}) {
      if (Object.prototype.hasOwnProperty.call(nextOptions, "path")) {
        this.options.path = nextOptions.path || "";
      }
      if (Array.isArray(nextOptions.rows)) {
        this.options.rows = nextOptions.rows;
      }
      if (typeof nextOptions.headerActions === "string") {
        this.options.headerActions = nextOptions.headerActions;
      }
      if (nextOptions.config) {
        this.options.config = normalizeConfig(nextOptions.config);
        if (!this.options.config.layouts.includes(this.state.layout)) {
          this.state.layout = this.options.config.defaultLayout;
        }
      }
      this.render();
      return this;
    }

    destroy() {
      global.clearTimeout(this.copyResetTimer);
      this.teardownSplitScrolling();
      this.searchPopover?.destroy();
      this.element.removeEventListener("click", this.handleClick);
      this.element.removeEventListener("keydown", this.handleKeydown);
    }
  }

  function create(options = {}, context = {}) {
    const document = context.document || global.document;
    const element = document.createElement("section");
    element.className = [
      "gn-diff-panel",
      options.className || ""
    ].filter(Boolean).join(" ");
    element.setAttribute("aria-label", options.ariaLabel || "Diff 组件");
    const controller = new DiffPanelController(element, options);
    return controller;
  }

  global.GitNestDiffPanel = {
    DiffPanelController,
    create
  };
})(window);

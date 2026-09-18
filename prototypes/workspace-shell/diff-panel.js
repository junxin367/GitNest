/**
 * GitNest Diff 面板原型组件。
 *
 * 用于规范 HTML 中呈现与正式 React DiffPanel 相同的交互边界：
 * - unified / split 布局；
 * - 自动换行；
 * - hunk 导航；
 * - 按变更块独立展开上下文；
 * - 路径复制；
 * - 面板内 Ctrl+F 搜索。
 */
(function attachGitNestDiffPanel(global) {
  const DEFAULT_CONTEXT_LINES = 3;
  const CONTEXT_STEP = 10;

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
      showHunkNavigation: Boolean(config.showHunkNavigation),
      allowContextExpansion: Boolean(config.allowContextExpansion)
    };
  }

  function normalizeFocusLine(value) {
    const line = Number(value);
    return Number.isFinite(line) && line > 0
      ? Math.trunc(line)
      : null;
  }

  const SOURCE_TOKEN_KINDS = new Set([
    "annotation",
    "comment",
    "function",
    "keyword",
    "literal",
    "number",
    "operator",
    "property",
    "string",
    "tag",
    "type"
  ]);
  const SOURCE_JAVASCRIPT_KEYWORDS = new Set([
    "abstract", "as", "asserts", "async", "await", "break",
    "case", "catch", "class", "const", "continue", "debugger",
    "declare", "default", "delete", "do", "else", "enum",
    "export", "extends", "finally", "for", "from", "function",
    "get", "if", "implements", "import", "in", "infer",
    "instanceof", "interface", "is", "keyof", "let", "module",
    "namespace", "new", "of", "package", "private", "protected",
    "public", "readonly", "require", "return", "satisfies", "set",
    "static", "super", "switch", "this", "throw", "try", "typeof",
    "var", "while", "with", "yield"
  ]);
  const SOURCE_JAVA_KEYWORDS = new Set([
    "abstract", "assert", "break", "case", "catch", "class",
    "continue", "default", "do", "else", "enum", "exports",
    "extends", "final", "finally", "for", "if", "implements",
    "import", "instanceof", "interface", "module", "native", "new",
    "open", "opens", "package", "permits", "private", "protected",
    "provides", "public", "record", "requires", "return", "sealed",
    "static", "strictfp", "super", "switch", "synchronized", "this",
    "throw", "throws", "to", "transient", "transitive", "try", "uses",
    "volatile", "while", "with", "yield"
  ]);
  const SOURCE_JAVASCRIPT_TYPES = new Set([
    "any", "Array", "bigint", "BigInt", "boolean", "Boolean", "Date",
    "Error", "Map", "never", "Number", "number", "object", "Object",
    "Promise", "Record", "Set", "String", "string", "symbol", "Symbol",
    "unknown", "void"
  ]);
  const SOURCE_JAVA_TYPES = new Set([
    "boolean", "byte", "char", "double", "float", "int", "long",
    "short", "void"
  ]);
  const SOURCE_LITERALS = new Set([
    "false", "Infinity", "NaN", "null", "true", "undefined"
  ]);
  const SOURCE_NUMBER_PATTERN =
    /^(?:0[xX][\dA-Fa-f_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d[\d_]*)?[fFdDlLn]?)/;
  const SOURCE_OPERATOR_PATTERN =
    /^(?:===|!==|>>>|>>=|<<=|=>|\?\?=|&&=|\|\|=|\*\*=|==|!=|<=|>=|\+\+|--|&&|\|\||\?\?|\?\.|<<|>>|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|\*\*|::|->|[=+\-*/%<>!&|^~?:])/;
  const MAX_SOURCE_TOKENS = 20000;

  function normalizeSourceLanguage(value) {
    const language = String(value || "").toLocaleLowerCase();
    if (language === "java") return "java";
    if (language === "vue") return "vue";
    if (language === "javascript") return "javascript";
    return "typescript";
  }

  function tokenizeSourceLines(lines, rawLanguage, path = "") {
    const language = normalizeSourceLanguage(rawLanguage);
    const markupEnabled =
      language === "vue" || /\.[jt]sx$/i.test(path);
    const state = {
      blockCommentEnd: null,
      multilineString: null,
      vueTag: false
    };
    let tokenCount = 0;
    return (Array.isArray(lines) ? lines : []).map((rawLine) => {
      if (tokenCount >= MAX_SOURCE_TOKENS) return [];
      const tokens = tokenizeSourceLine(
        String(rawLine || ""),
        language,
        markupEnabled,
        state,
        MAX_SOURCE_TOKENS - tokenCount
      );
      tokenCount += tokens.length;
      return tokens;
    });
  }

  function tokenizeSourceLine(
    line,
    language,
    markupEnabled,
    state,
    tokenBudget
  ) {
    const tokens = [];
    const pushToken = (start, end, kind) => {
      if (
        end <= start ||
        tokens.length >= tokenBudget ||
        !SOURCE_TOKEN_KINDS.has(kind)
      ) {
        return false;
      }
      tokens.push({ start, end, kind });
      return true;
    };
    let index = 0;

    while (index < line.length && tokens.length < tokenBudget) {
      if (state.blockCommentEnd) {
        const endMarker = state.blockCommentEnd;
        const endIndex = line.indexOf(endMarker, index);
        const tokenEnd =
          endIndex < 0 ? line.length : endIndex + endMarker.length;
        pushToken(index, tokenEnd, "comment");
        index = tokenEnd;
        if (endIndex < 0) break;
        state.blockCommentEnd = null;
        continue;
      }

      if (state.multilineString) {
        const delimiter = state.multilineString;
        const tokenEnd = findSourceStringEnd(
          line,
          index,
          delimiter,
          true
        );
        pushToken(
          index,
          tokenEnd < 0 ? line.length : tokenEnd,
          "string"
        );
        if (tokenEnd < 0) break;
        index = tokenEnd;
        state.multilineString = null;
        continue;
      }

      if (markupEnabled && state.vueTag) {
        if (line.startsWith("/>", index)) {
          pushToken(index, index + 2, "operator");
          index += 2;
          state.vueTag = false;
          continue;
        }
        if (line[index] === ">") {
          pushToken(index, index + 1, "operator");
          index += 1;
          state.vueTag = false;
          continue;
        }
        const character = line[index] || "";
        if (character === '"' || character === "'") {
          const tokenEnd = findSourceStringEnd(
            line,
            index,
            character,
            false
          );
          pushToken(
            index,
            tokenEnd < 0 ? line.length : tokenEnd,
            "string"
          );
          index = tokenEnd < 0 ? line.length : tokenEnd;
          continue;
        }
        const attribute = line
          .slice(index)
          .match(/^[:@#]?[A-Za-z_][\w:.-]*/)?.[0];
        if (attribute) {
          pushToken(index, index + attribute.length, "property");
          index += attribute.length;
          continue;
        }
        if (character === "=") {
          pushToken(index, index + 1, "operator");
        }
        index += 1;
        continue;
      }

      if (markupEnabled && line.startsWith("<!--", index)) {
        const endIndex = line.indexOf("-->", index + 4);
        const tokenEnd =
          endIndex < 0 ? line.length : endIndex + 3;
        pushToken(index, tokenEnd, "comment");
        index = tokenEnd;
        if (endIndex < 0) {
          state.blockCommentEnd = "-->";
          break;
        }
        continue;
      }

      if (markupEnabled && line[index] === "<") {
        const tagMatch = line
          .slice(index)
          .match(/^<(\/?)([A-Za-z][\w.-]*)/);
        if (tagMatch) {
          const prefixLength = 1 + (tagMatch[1] || "").length;
          const tagName = tagMatch[2] || "";
          pushToken(index, index + prefixLength, "operator");
          pushToken(
            index + prefixLength,
            index + prefixLength + tagName.length,
            "tag"
          );
          index += tagMatch[0].length;
          state.vueTag = true;
          continue;
        }
      }

      if (line.startsWith("//", index)) {
        pushToken(index, line.length, "comment");
        break;
      }
      if (line.startsWith("/*", index)) {
        const endIndex = line.indexOf("*/", index + 2);
        const tokenEnd =
          endIndex < 0 ? line.length : endIndex + 2;
        pushToken(index, tokenEnd, "comment");
        index = tokenEnd;
        if (endIndex < 0) {
          state.blockCommentEnd = "*/";
          break;
        }
        continue;
      }

      if (language === "java" && line.startsWith('"""', index)) {
        const tokenEnd = findSourceStringEnd(
          line,
          index,
          '"""',
          false
        );
        pushToken(
          index,
          tokenEnd < 0 ? line.length : tokenEnd,
          "string"
        );
        if (tokenEnd < 0) {
          state.multilineString = '"""';
          break;
        }
        index = tokenEnd;
        continue;
      }

      const character = line[index] || "";
      if (
        character === '"' ||
        character === "'" ||
        character === "`"
      ) {
        const tokenEnd = findSourceStringEnd(
          line,
          index,
          character,
          false
        );
        pushToken(
          index,
          tokenEnd < 0 ? line.length : tokenEnd,
          "string"
        );
        if (tokenEnd < 0 && character === "`") {
          state.multilineString = "`";
          break;
        }
        index = tokenEnd < 0 ? line.length : tokenEnd;
        continue;
      }

      if (character === "@") {
        const annotation = line
          .slice(index)
          .match(/^@[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/)?.[0];
        if (annotation) {
          pushToken(index, index + annotation.length, "annotation");
          index += annotation.length;
          continue;
        }
      }

      const number = line
        .slice(index)
        .match(SOURCE_NUMBER_PATTERN)?.[0];
      if (number) {
        pushToken(index, index + number.length, "number");
        index += number.length;
        continue;
      }

      const identifier = line
        .slice(index)
        .match(/^[A-Za-z_$][\w$]*/)?.[0];
      if (identifier) {
        const kind = sourceIdentifierKind(
          line,
          index,
          identifier,
          language
        );
        if (kind) {
          pushToken(index, index + identifier.length, kind);
        }
        index += identifier.length;
        continue;
      }

      const operator = line
        .slice(index)
        .match(SOURCE_OPERATOR_PATTERN)?.[0];
      if (operator) {
        pushToken(index, index + operator.length, "operator");
        index += operator.length;
        continue;
      }
      index += 1;
    }

    return tokens;
  }

  function sourceIdentifierKind(
    line,
    start,
    identifier,
    language
  ) {
    const keywords =
      language === "java"
        ? SOURCE_JAVA_KEYWORDS
        : SOURCE_JAVASCRIPT_KEYWORDS;
    const types =
      language === "java"
        ? SOURCE_JAVA_TYPES
        : SOURCE_JAVASCRIPT_TYPES;
    if (keywords.has(identifier)) return "keyword";
    if (SOURCE_LITERALS.has(identifier)) return "literal";
    if (
      types.has(identifier) ||
      /^[A-Z][A-Za-z0-9_$]*$/.test(identifier)
    ) {
      return "type";
    }

    const end = start + identifier.length;
    if (nextSourceCharacter(line, end) === "(") {
      return "function";
    }
    if (
      previousSourceCharacter(line, start) === "." ||
      nextSourceCharacter(line, end) === "="
    ) {
      return "property";
    }
    return null;
  }

  function nextSourceCharacter(line, start) {
    for (let index = start; index < line.length; index += 1) {
      const character = line[index] || "";
      if (!/\s/.test(character)) return character;
    }
    return "";
  }

  function previousSourceCharacter(line, start) {
    for (let index = start - 1; index >= 0; index -= 1) {
      const character = line[index] || "";
      if (!/\s/.test(character)) return character;
    }
    return "";
  }

  function findSourceStringEnd(
    line,
    start,
    delimiter,
    continued
  ) {
    if (delimiter === '"""') {
      const searchStart = continued ? start : start + 3;
      const end = line.indexOf(delimiter, searchStart);
      return end < 0 ? -1 : end + delimiter.length;
    }
    let escaped = false;
    for (
      let index = continued ? start : start + 1;
      index < line.length;
      index += 1
    ) {
      const character = line[index] || "";
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === delimiter) return index + 1;
    }
    return -1;
  }

  function rowsForContext(
    rows,
    hunkContexts = {}
  ) {
    if (!rows.length) return rows;

    const prefix = [];
    const hunks = [];
    let currentHunk = null;
    rows.forEach((row) => {
      if (row.kind === "hunk") {
        currentHunk = {
          header: row,
          body: []
        };
        hunks.push(currentHunk);
      } else if (currentHunk) {
        currentHunk.body.push(row);
      } else {
        prefix.push(row);
      }
    });

    return [
      ...prefix,
      ...hunks.flatMap((hunk, hunkIndex) => {
        const context = hunkContexts[hunkIndex] || {
          beforeLines: DEFAULT_CONTEXT_LINES,
          afterLines: DEFAULT_CONTEXT_LINES,
          full: false
        };
        const changedIndexes = hunk.body
          .map((row, index) => row.kind === "context" ? -1 : index)
          .filter((index) => index >= 0);
        if (!changedIndexes.length || context.full) {
          return [hunk.header, ...hunk.body];
        }
        const firstChanged = changedIndexes[0];
        const lastChanged = changedIndexes[changedIndexes.length - 1];
        const start = Math.max(
          0,
          firstChanged - context.beforeLines
        );
        const end = Math.min(
          hunk.body.length,
          lastChanged + context.afterLines + 1
        );
        return [
          hunk.header,
          ...hunk.body.slice(start, end)
        ];
      })
    ];
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

  function normalizedSyntaxTokens(tokens, textLength) {
    if (!Array.isArray(tokens)) return [];
    let previousEnd = 0;
    return tokens
      .map((token) => ({
        start: Math.max(0, Math.trunc(Number(token?.start))),
        end: Math.min(
          textLength,
          Math.trunc(Number(token?.end))
        ),
        kind: String(token?.kind || "")
      }))
      .sort((left, right) => left.start - right.start)
      .filter((token) => {
        const valid =
          SOURCE_TOKEN_KINDS.has(token.kind) &&
          token.start >= previousEnd &&
          token.end > token.start;
        if (valid) previousEnd = token.end;
        return valid;
      });
  }

  function syntaxMarkup(text, start, end, tokens) {
    const parts = [];
    let cursor = start;
    tokens.forEach((token) => {
      if (token.end <= start || token.start >= end) return;
      const tokenStart = Math.max(start, token.start);
      const tokenEnd = Math.min(end, token.end);
      if (tokenStart > cursor) {
        parts.push(escapeHtml(text.slice(cursor, tokenStart)));
      }
      if (tokenEnd > tokenStart) {
        parts.push(
          `<span class="gn-diff-panel__syntax-token is-${token.kind}">${escapeHtml(text.slice(tokenStart, tokenEnd))}</span>`
        );
        cursor = tokenEnd;
      }
    });
    if (cursor < end) {
      parts.push(escapeHtml(text.slice(cursor, end)));
    }
    return parts.join("");
  }

  function highlightedText(
    value,
    key,
    hits,
    activeHit,
    syntaxTokens = []
  ) {
    const text = String(value || "");
    if (!text) return " ";
    const lineHits = hits.filter((hit) => hit.key === key);
    const tokens = normalizedSyntaxTokens(
      syntaxTokens,
      text.length
    );
    if (!lineHits.length) {
      return syntaxMarkup(text, 0, text.length, tokens);
    }

    let cursor = 0;
    return `${lineHits.map((hit) => {
      const before = syntaxMarkup(
        text,
        cursor,
        hit.start,
        tokens
      );
      const highlighted = syntaxMarkup(
        text,
        hit.start,
        hit.end,
        tokens
      );
      cursor = hit.end;
      return `${before}<mark class="gn-diff-panel__search-hit${hit.id === activeHit ? " is-current" : ""}" data-diff-search-hit="${hit.id}">${highlighted}</mark>`;
    }).join("")}${syntaxMarkup(text, cursor, text.length, tokens)}`;
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
        fullRows: Array.isArray(rawOptions.fullRows)
          ? rawOptions.fullRows
          : null,
        focusLine: normalizeFocusLine(rawOptions.focusLine),
        binary: Boolean(rawOptions.binary),
        truncated: Boolean(rawOptions.truncated),
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
        pathCopied: false,
        hunkContexts: {}
      };
      this.copyResetTimer = 0;
      this.focusPulseTimer = 0;
      this.splitScrollCleanup = null;
      this.handleClick = this.handleClick.bind(this);
      this.handleKeydown = this.handleKeydown.bind(this);
      this.element.addEventListener("click", this.handleClick);
      this.element.addEventListener("keydown", this.handleKeydown);
      this.render();
    }

    visibleRows() {
      if (!this.options.fullRows) return this.options.rows;
      return rowsForContext(
        this.options.fullRows,
        this.state.hunkContexts
      );
    }

    focusRowMetadata(oldNo, newNo) {
      const focusLine = this.options.focusLine;
      if (!focusLine) {
        return {
          className: "",
          attributes: ""
        };
      }
      const oldMatches = Number(oldNo) === focusLine;
      const newMatches = Number(newNo) === focusLine;
      if (!oldMatches && !newMatches) {
        return {
          className: "",
          attributes: ""
        };
      }
      return {
        className: " is-focus-target",
        attributes: ` data-diff-focus-line="${focusLine}" data-diff-focus-side="${newMatches ? "new" : "old"}" aria-current="location"`
      };
    }

    canExpandContext() {
      return (
        this.options.config.allowContextExpansion &&
        !this.options.binary &&
        !this.options.truncated &&
        this.options.fullRows &&
        this.options.fullRows.length > this.options.rows.length
      );
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

    renderHunk(
      row,
      rowIndex,
      hits,
      activeSearchHit,
      activeHunk,
      showContextControls = true
    ) {
      const hunkIndex = this.visibleRows()
        .slice(0, rowIndex + 1)
        .filter((item) => item.kind === "hunk").length - 1;
      const hunkText = highlightedText(
        row.text,
        `${rowIndex}:hunk`,
        hits,
        activeSearchHit
      );
      const context = this.state.hunkContexts[hunkIndex] || {
        beforeLines: DEFAULT_CONTEXT_LINES,
        afterLines: DEFAULT_CONTEXT_LINES,
        full: false
      };
      const expanded =
        context.full ||
        context.beforeLines > DEFAULT_CONTEXT_LINES ||
        context.afterLines > DEFAULT_CONTEXT_LINES;
      const contextTrigger =
        showContextControls && this.canExpandContext()
          ? `
              <button
                class="gn-diff-panel__hunk-trigger"
                type="button"
                data-diff-action="context-${expanded ? "reset" : "around"}"
                data-diff-hunk-index="${hunkIndex}"
                aria-label="${expanded ? `收起第 ${hunkIndex + 1} 个变更块上下文` : `展开第 ${hunkIndex + 1} 个变更块上下各 ${CONTEXT_STEP} 行`}"
                aria-expanded="${expanded}"
                title="${expanded ? "点击收起当前变更块，恢复默认 3 行上下文" : `点击查看当前变更块上方和下方各 ${CONTEXT_STEP} 行代码`}"
              >
                <code>${hunkText}</code>
              </button>
            `
          : `<code>${hunkText}</code>`;
      return `
        <div
          class="gn-diff-panel__wide-row${hunkIndex === activeHunk ? " is-current" : ""}"
          data-diff-hunk="${hunkIndex}"
        >
          ${iconMarkup("diff")}
          ${contextTrigger}
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

      const unifiedLine = (kind, oldNo, newNo, text, key) => {
        const focus = this.focusRowMetadata(oldNo, newNo);
        return `
        <div class="gn-diff-panel__row${focus.className}"${focus.attributes}>
          <span class="gn-diff-panel__line-number ${kind}">${oldNo ?? ""}</span>
          <span class="gn-diff-panel__line-number ${kind}">${newNo ?? ""}</span>
          <span class="gn-diff-panel__change-marker ${kind}">${kind === "removed" ? "−" : kind === "added" ? "+" : ""}</span>
          <span class="gn-diff-panel__code-cell ${kind}"><code>${highlightedText(text, key, hits, activeSearchHit, row.syntaxTokens)}</code></span>
        </div>
      `;
      };

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

      const focus = this.focusRowMetadata(row.oldNo, row.newNo);
      return `
        <div class="gn-diff-panel__row split${focus.className}"${focus.attributes}>
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
      activeHunk,
      showContextControls
    ) {
      if (row.kind === "hunk") {
        return this.renderHunk(
          row,
          rowIndex,
          hits,
          activeSearchHit,
          activeHunk,
          showContextControls
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

      const focus = this.focusRowMetadata(
        side === "old" ? row.oldNo : null,
        side === "new" ? row.newNo : null
      );
      return `
        <div class="gn-diff-panel__split-pane-row${focus.className}"${focus.attributes}>
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
          activeHunk,
          true
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
      const rows = this.visibleRows();
      const stats = statsForRows(
        this.options.fullRows || this.options.rows
      );
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
                <div class="gn-diff-panel__header-action-slot">
                  ${this.options.headerActions}
                </div>
              ` : ""}
            </div>
          </header>
          <div class="gn-diff-panel__search" data-diff-search-mount></div>
          <div class="gn-diff-panel__viewport${splitNoWrap ? " split-nowrap" : ""}" role="region" aria-label="${escapeHtml(this.options.viewportAriaLabel || "文件 Diff")}" tabindex="0">
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
        ariaLabel: this.options.searchAriaLabel || "在 Diff 中搜索",
        inputAriaLabel: this.options.searchInputAriaLabel || "在 Diff 中搜索",
        placeholder: this.options.searchPlaceholder || "在当前 Diff 中搜索",
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

    revealFocusLine() {
      const focusLine = this.options.focusLine;
      if (!focusLine) return false;
      const targets = [
        ...this.element.querySelectorAll(
          `[data-diff-focus-line="${focusLine}"]`
        )
      ];
      const target = targets.find(
        (candidate) => candidate.dataset.diffFocusSide === "new"
      ) || targets[0];
      const viewport = this.element.querySelector(
        ".gn-diff-panel__viewport"
      );
      if (!target || !viewport) return false;

      const viewportRect = viewport.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const centeredTop =
        viewport.scrollTop +
        targetRect.top -
        viewportRect.top -
        Math.max(0, (viewport.clientHeight - targetRect.height) / 2);
      viewport.scrollTop = Math.max(0, centeredTop);

      target.classList.remove("is-focus-pulse");
      void target.offsetWidth;
      target.classList.add("is-focus-pulse");
      global.clearTimeout(this.focusPulseTimer);
      this.focusPulseTimer = global.setTimeout(() => {
        target.classList.remove("is-focus-pulse");
      }, 1400);
      return true;
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
        this.visibleRows(),
        this.state.searchQuery
      );
      if (!hits.length) return;
      this.state.activeSearchHit += direction;
      this.render({ focusSearch: true, scrollToSearchHit: true });
    }

    moveHunk(direction) {
      const stats = statsForRows(this.visibleRows());
      if (!stats.hunks) return;
      this.state.activeHunk += direction;
      this.render({ scrollToHunk: true });
    }

    expandContext(direction, hunkIndex) {
      if (!this.canExpandContext()) return;
      const current = this.state.hunkContexts[hunkIndex] || {
        beforeLines: DEFAULT_CONTEXT_LINES,
        afterLines: DEFAULT_CONTEXT_LINES,
        full: false
      };
      if (direction === "reset") {
        delete this.state.hunkContexts[hunkIndex];
      } else if (direction === "around") {
        this.state.hunkContexts[hunkIndex] = {
          beforeLines: CONTEXT_STEP,
          afterLines: CONTEXT_STEP,
          full: false
        };
      } else if (direction === "all") {
        this.state.hunkContexts[hunkIndex] = {
          beforeLines: Number.MAX_SAFE_INTEGER,
          afterLines: Number.MAX_SAFE_INTEGER,
          full: true
        };
      } else if (direction === "up") {
        this.state.hunkContexts[hunkIndex] = {
          ...current,
          beforeLines: current.beforeLines + CONTEXT_STEP,
          full: false
        };
      } else if (direction === "down") {
        this.state.hunkContexts[hunkIndex] = {
          ...current,
          afterLines: current.afterLines + CONTEXT_STEP,
          full: false
        };
      }
      this.state.activeHunk = Number.isFinite(hunkIndex)
        ? hunkIndex
        : this.state.activeHunk;
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
      } else if (actionName.startsWith("context-")) {
        this.expandContext(
          actionName.slice("context-".length),
          Number(action.dataset.diffHunkIndex)
        );
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
        const pathChanged =
          this.options.path !== (nextOptions.path || "");
        this.options.path = nextOptions.path || "";
        if (pathChanged) {
          this.state.hunkContexts = {};
        }
      }
      if (Array.isArray(nextOptions.rows)) {
        this.options.rows = nextOptions.rows;
      }
      if (Object.prototype.hasOwnProperty.call(nextOptions, "fullRows")) {
        this.options.fullRows = Array.isArray(nextOptions.fullRows)
          ? nextOptions.fullRows
          : null;
      }
      if (Object.prototype.hasOwnProperty.call(nextOptions, "focusLine")) {
        this.options.focusLine = normalizeFocusLine(
          nextOptions.focusLine
        );
      }
      if (Object.prototype.hasOwnProperty.call(nextOptions, "binary")) {
        this.options.binary = Boolean(nextOptions.binary);
      }
      if (Object.prototype.hasOwnProperty.call(nextOptions, "truncated")) {
        this.options.truncated = Boolean(nextOptions.truncated);
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
      global.clearTimeout(this.focusPulseTimer);
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
    create,
    tokenizeSourceLines
  };
})(window);

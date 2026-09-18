import type {
  CodeAnalysisLanguageDto
} from "@gitnest/contracts";

export type SourceSyntaxTokenKind =
  | "annotation"
  | "comment"
  | "function"
  | "keyword"
  | "literal"
  | "number"
  | "operator"
  | "property"
  | "string"
  | "tag"
  | "type";

export interface SourceSyntaxToken {
  start: number;
  end: number;
  kind: SourceSyntaxTokenKind;
}

const MAX_SYNTAX_TOKENS = 20_000;

const JAVASCRIPT_KEYWORDS = new Set([
  "abstract",
  "as",
  "asserts",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "declare",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "finally",
  "for",
  "from",
  "function",
  "get",
  "if",
  "implements",
  "import",
  "in",
  "infer",
  "instanceof",
  "interface",
  "is",
  "keyof",
  "let",
  "module",
  "namespace",
  "new",
  "of",
  "package",
  "private",
  "protected",
  "public",
  "readonly",
  "require",
  "return",
  "satisfies",
  "set",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "try",
  "typeof",
  "var",
  "while",
  "with",
  "yield"
]);

const JAVA_KEYWORDS = new Set([
  "abstract",
  "assert",
  "break",
  "case",
  "catch",
  "class",
  "continue",
  "default",
  "do",
  "else",
  "enum",
  "exports",
  "extends",
  "final",
  "finally",
  "for",
  "if",
  "implements",
  "import",
  "instanceof",
  "interface",
  "module",
  "native",
  "new",
  "non-sealed",
  "open",
  "opens",
  "package",
  "permits",
  "private",
  "protected",
  "provides",
  "public",
  "record",
  "requires",
  "return",
  "sealed",
  "static",
  "strictfp",
  "super",
  "switch",
  "synchronized",
  "this",
  "throw",
  "throws",
  "to",
  "transient",
  "transitive",
  "try",
  "uses",
  "volatile",
  "while",
  "with",
  "yield"
]);

const JAVASCRIPT_TYPES = new Set([
  "any",
  "Array",
  "bigint",
  "BigInt",
  "boolean",
  "Boolean",
  "Date",
  "Error",
  "Map",
  "never",
  "Number",
  "number",
  "object",
  "Object",
  "Promise",
  "Record",
  "Set",
  "String",
  "string",
  "symbol",
  "Symbol",
  "unknown",
  "void"
]);

const JAVA_TYPES = new Set([
  "boolean",
  "byte",
  "char",
  "double",
  "float",
  "int",
  "long",
  "short",
  "void"
]);

const LITERALS = new Set([
  "false",
  "Infinity",
  "NaN",
  "null",
  "true",
  "undefined"
]);

const NUMBER_PATTERN =
  /^(?:0[xX][\dA-Fa-f_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d[\d_]*)?[fFdDlLn]?)/;
const OPERATOR_PATTERN =
  /^(?:===|!==|>>>|>>=|<<=|=>|\?\?=|&&=|\|\|=|\*\*=|==|!=|<=|>=|\+\+|--|&&|\|\||\?\?|\?\.|<<|>>|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|\*\*|::|->|[=+\-*/%<>!&|^~?:])/;

interface TokenizerState {
  blockCommentEnd: "*/" | "-->" | null;
  multilineString: "`" | '"""' | null;
  vueTag: boolean;
}

export function tokenizeSourceLines(
  lines: readonly string[],
  language: CodeAnalysisLanguageDto,
  path = ""
): readonly SourceSyntaxToken[][] {
  const state: TokenizerState = {
    blockCommentEnd: null,
    multilineString: null,
    vueTag: false
  };
  const markupEnabled =
    language === "vue" || /\.[jt]sx$/i.test(path);
  const result: SourceSyntaxToken[][] = [];
  let tokenCount = 0;

  for (const line of lines) {
    if (tokenCount >= MAX_SYNTAX_TOKENS) {
      result.push([]);
      continue;
    }
    const tokens = tokenizeSourceLine(
      line,
      language,
      markupEnabled,
      state,
      MAX_SYNTAX_TOKENS - tokenCount
    );
    tokenCount += tokens.length;
    result.push(tokens);
  }

  return result;
}

function tokenizeSourceLine(
  line: string,
  language: CodeAnalysisLanguageDto,
  markupEnabled: boolean,
  state: TokenizerState,
  tokenBudget: number
): SourceSyntaxToken[] {
  const tokens: SourceSyntaxToken[] = [];
  const pushToken = (
    start: number,
    end: number,
    kind: SourceSyntaxTokenKind
  ): boolean => {
    if (end <= start || tokens.length >= tokenBudget) {
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
        endIndex < 0
          ? line.length
          : endIndex + endMarker.length;
      pushToken(index, tokenEnd, "comment");
      index = tokenEnd;
      if (endIndex < 0) {
        break;
      }
      state.blockCommentEnd = null;
      continue;
    }

    if (state.multilineString) {
      const delimiter = state.multilineString;
      const tokenEnd = findStringEnd(
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
      if (tokenEnd < 0) {
        break;
      }
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
      const character = line[index] ?? "";
      if (character === '"' || character === "'") {
        const tokenEnd = findStringEnd(
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
        pushToken(
          index,
          index + attribute.length,
          "property"
        );
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
        const prefixLength = 1 + (tagMatch[1] ?? "").length;
        const tagName = tagMatch[2] ?? "";
        pushToken(
          index,
          index + prefixLength,
          "operator"
        );
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

    if (
      language === "java" &&
      line.startsWith('"""', index)
    ) {
      const tokenEnd = findStringEnd(
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

    const character = line[index] ?? "";
    if (
      character === '"' ||
      character === "'" ||
      character === "`"
    ) {
      const tokenEnd = findStringEnd(
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
        .match(/^@[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/)
        ?.[0];
      if (annotation) {
        pushToken(
          index,
          index + annotation.length,
          "annotation"
        );
        index += annotation.length;
        continue;
      }
    }

    const number = line
      .slice(index)
      .match(NUMBER_PATTERN)?.[0];
    if (number) {
      pushToken(index, index + number.length, "number");
      index += number.length;
      continue;
    }

    const identifier = line
      .slice(index)
      .match(/^[A-Za-z_$][\w$]*/)?.[0];
    if (identifier) {
      const kind = identifierKind(
        line,
        index,
        identifier,
        language
      );
      if (kind) {
        pushToken(
          index,
          index + identifier.length,
          kind
        );
      }
      index += identifier.length;
      continue;
    }

    const operator = line
      .slice(index)
      .match(OPERATOR_PATTERN)?.[0];
    if (operator) {
      pushToken(
        index,
        index + operator.length,
        "operator"
      );
      index += operator.length;
      continue;
    }

    index += 1;
  }

  return tokens;
}

function identifierKind(
  line: string,
  start: number,
  identifier: string,
  language: CodeAnalysisLanguageDto
): SourceSyntaxTokenKind | null {
  const keywords =
    language === "java" ? JAVA_KEYWORDS : JAVASCRIPT_KEYWORDS;
  const types =
    language === "java" ? JAVA_TYPES : JAVASCRIPT_TYPES;

  if (keywords.has(identifier)) {
    return "keyword";
  }
  if (LITERALS.has(identifier)) {
    return "literal";
  }
  if (
    types.has(identifier) ||
    /^[A-Z][A-Za-z0-9_$]*$/.test(identifier)
  ) {
    return "type";
  }

  const end = start + identifier.length;
  const nextCharacter = nextNonWhitespace(line, end);
  if (nextCharacter === "(") {
    return "function";
  }

  const previousCharacter = previousNonWhitespace(line, start);
  if (
    previousCharacter === "." ||
    nextCharacter === "="
  ) {
    return "property";
  }

  return null;
}

function nextNonWhitespace(
  line: string,
  start: number
): string {
  for (let index = start; index < line.length; index += 1) {
    const character = line[index] ?? "";
    if (!/\s/.test(character)) {
      return character;
    }
  }
  return "";
}

function previousNonWhitespace(
  line: string,
  start: number
): string {
  for (let index = start - 1; index >= 0; index -= 1) {
    const character = line[index] ?? "";
    if (!/\s/.test(character)) {
      return character;
    }
  }
  return "";
}

function findStringEnd(
  line: string,
  start: number,
  delimiter: string,
  continued: boolean
): number {
  if (delimiter === '"""') {
    const searchStart = continued ? start : start + 3;
    const end = line.indexOf(delimiter, searchStart);
    return end < 0 ? -1 : end + delimiter.length;
  }

  const quote = delimiter;
  let escaped = false;
  for (
    let index = continued ? start : start + 1;
    index < line.length;
    index += 1
  ) {
    const character = line[index] ?? "";
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === quote) {
      return index + 1;
    }
  }
  return -1;
}

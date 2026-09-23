import { MAX_CODE_DOCUMENTATION_CHARACTERS } from "./model";
import type {
  AnalysisSourceFile,
  ParsedCall,
  ParsedClientRequest,
  ParsedReference,
  ParsedRemoteBoundary,
  ParsedServerEndpoint,
  ParsedSourceFile,
  ParsedSymbol
} from "./model";
import { collectJavaMethodProfileBoundaries } from "./profiles/registry";

const CALL_KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "throw",
  "new",
  "typeof",
  "delete",
  "await",
  "super",
  "this",
  "synchronized"
]);

export function parseSourceFile(
  file: AnalysisSourceFile,
  content: string
): ParsedSourceFile {
  if (file.language === "java") {
    return parseJava(file, content);
  }
  if (
    file.language === "typescript" ||
    file.language === "javascript" ||
    file.language === "vue"
  ) {
    return parseJavaScriptLike(file, content);
  }
  return {
    file,
    symbols: [],
    clientRequests: [],
    serverEndpoints: [],
    remoteBoundaries: []
  };
}

function parseJavaScriptLike(
  file: AnalysisSourceFile,
  content: string
): ParsedSourceFile {
  const lineStarts = createLineStarts(content);
  const codeOffsets = createSourceCodeOffsets(
    content,
    file.language === "vue"
  );
  const symbols: ParsedSymbol[] = [];
  const occupied = new Set<string>();
  const classBlocks: Array<{
    name: string;
    qualifiedName: string;
    bodyStart: number;
    bodyEnd: number;
  }> = [];

  const classPattern =
    /\b(?:export\s+default\s+|export\s+)?class\s+([A-Za-z_$][\w$]*)[^{]*\{/g;
  for (const match of content.matchAll(classPattern)) {
    const name = match[1];
    const start = match.index;
    if (
      !name ||
      start === undefined ||
      !codeOffsets.isCode(capturedGroupOffset(match, 1))
    ) {
      continue;
    }
    const braceIndex = start + match[0].lastIndexOf("{");
    const end = findMatchingBrace(content, braceIndex);
    const line = lineForOffset(lineStarts, start);
    const endLine = lineForOffset(lineStarts, end);
    symbols.push({
      name,
      qualifiedName: name,
      kind: "class",
      line,
      endLine,
      ...documentationField(content, start),
      calls: [],
      source: "builtin"
    });
    classBlocks.push({
      name,
      qualifiedName: name,
      bodyStart: braceIndex + 1,
      bodyEnd: end
    });
  }

  for (const classBlock of classBlocks) {
    const body = content.slice(
      classBlock.bodyStart,
      classBlock.bodyEnd
    );
    const methodPattern =
      /(?:^|[\r\n])\s*(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+|async\s+|get\s+|set\s+)*([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*(?::\s*[^={]+)?\s*\{/g;
    for (const match of body.matchAll(methodPattern)) {
      const name = match[1];
      const localStart = match.index;
      if (
        !name ||
        localStart === undefined ||
        CALL_KEYWORDS.has(name) ||
        !codeOffsets.isCode(
          classBlock.bodyStart +
            capturedGroupOffset(match, 1)
        )
      ) {
        continue;
      }
      const start = classBlock.bodyStart + localStart;
      const braceIndex =
        classBlock.bodyStart +
        localStart +
        match[0].lastIndexOf("{");
      const end = findMatchingBrace(content, braceIndex);
      const qualifiedName = `${classBlock.qualifiedName}.${name}`;
      const key = `${qualifiedName}:${start}`;
      if (occupied.has(key)) {
        continue;
      }
      occupied.add(key);
      symbols.push({
        name,
        qualifiedName,
        kind: "method",
        line: lineForOffset(lineStarts, start),
        endLine: lineForOffset(lineStarts, end),
        parentQualifiedName: classBlock.qualifiedName,
        ...documentationField(content, start),
        calls: extractCalls(
          content.slice(braceIndex + 1, end),
          lineForOffset(lineStarts, braceIndex + 1)
        ),
        source: "builtin"
      });
    }
  }

  const functionPatterns = [
    /\b(?:export\s+default\s+|export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^;{]+?)?\s*\{/g,
    /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::\s*[^;={]+?)?\s*=>\s*\{/g,
    /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:(?:React\s*\.\s*)?(?:useCallback|useMemo))\s*\(\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::\s*[^;={]+?)?\s*=>\s*\{/g
  ];
  for (const pattern of functionPatterns) {
    for (const match of content.matchAll(pattern)) {
      const name = match[1];
      const start = match.index;
      if (
        !name ||
        start === undefined ||
        !codeOffsets.isCode(capturedGroupOffset(match, 1))
      ) {
        continue;
      }
      const braceIndex = start + match[0].lastIndexOf("{");
      if (isInsideAnyClass(braceIndex, classBlocks)) {
        continue;
      }
      const end = findMatchingBrace(content, braceIndex);
      const key = `${name}:${start}`;
      if (occupied.has(key)) {
        continue;
      }
      occupied.add(key);
      symbols.push({
        name,
        qualifiedName: name,
        kind: "function",
        line: lineForOffset(lineStarts, start),
        endLine: lineForOffset(lineStarts, end),
        ...documentationField(content, start),
        calls: extractCalls(
          content.slice(braceIndex + 1, end),
          lineForOffset(lineStarts, braceIndex + 1)
        ),
        source: "builtin"
      });
    }
  }

  const expressionArrowPatterns = [
    /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::\s*[^=\r\n]+)?=>\s*(?!\{)/g,
    /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:(?:React\s*\.\s*)?(?:useCallback|useMemo))\s*\(\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::\s*[^=\r\n]+)?=>\s*(?!\{)/g
  ];
  for (const pattern of expressionArrowPatterns) {
    for (const match of content.matchAll(pattern)) {
      const name = match[1];
      const start = match.index;
      if (
        !name ||
        start === undefined ||
        !codeOffsets.isCode(capturedGroupOffset(match, 1))
      ) {
        continue;
      }
      const expressionStart = start + match[0].length;
      if (isInsideAnyClass(expressionStart, classBlocks)) {
        continue;
      }
      const end = findExpressionEnd(content, expressionStart);
      const key = `${name}:${start}`;
      if (occupied.has(key)) {
        continue;
      }
      occupied.add(key);
      symbols.push({
        name,
        qualifiedName: name,
        kind: "function",
        line: lineForOffset(lineStarts, start),
        endLine: lineForOffset(lineStarts, end),
        ...documentationField(content, start),
        calls: extractCalls(
          content.slice(expressionStart, end),
          lineForOffset(lineStarts, expressionStart)
        ),
        source: "builtin"
      });
    }
  }

  const clientRequests = extractClientRequests(
    content,
    lineStarts,
    symbols,
    codeOffsets
  );

  return {
    file,
    symbols,
    clientRequests,
    serverEndpoints: [],
    remoteBoundaries: []
  };
}

interface JavaTypeBlock {
  name: string;
  qualifiedName: string;
  kind: "class" | "interface" | "enum";
  declarationStart: number;
  bodyStart: number;
  bodyEnd: number;
  annotations: string;
  parentQualifiedName?: string;
}

function parseJava(
  file: AnalysisSourceFile,
  content: string
): ParsedSourceFile {
  const lineStarts = createLineStarts(content);
  const codeOffsets = createSourceCodeOffsets(content);
  const symbols: ParsedSymbol[] = [];
  const serverEndpoints: ParsedServerEndpoint[] = [];
  const remoteBoundaries: ParsedRemoteBoundary[] = [];
  const packageName =
    firstCodeMatch(
      content,
      /\bpackage\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*;/g,
      codeOffsets,
      1
    )?.[1] ?? "";
  if (packageName) {
    const packageMatch = firstCodeMatch(
      content,
      /\bpackage\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*;/g,
      codeOffsets,
      1
    );
    symbols.push({
      name: packageName.split(".").at(-1) ?? packageName,
      qualifiedName: packageName,
      kind: "package",
      line: lineForOffset(
        lineStarts,
        packageMatch?.index ?? 0
      ),
      endLine: lineForOffset(
        lineStarts,
        (packageMatch?.index ?? 0) +
          (packageMatch?.[0].length ?? 0)
      ),
      calls: [],
      source: "builtin"
    });
  }
  const moduleMatch = firstCodeMatch(
    content,
    /\bmodule\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\{/g,
    codeOffsets,
    1
  );
  if (moduleMatch?.[1]) {
    const start = moduleMatch.index ?? 0;
    const braceIndex =
      start + moduleMatch[0].lastIndexOf("{");
    const end = findMatchingBrace(content, braceIndex);
    symbols.push({
      name: moduleMatch[1],
      qualifiedName: moduleMatch[1],
      kind: "module",
      line: lineForOffset(lineStarts, start),
      endLine: lineForOffset(lineStarts, end),
      calls: [],
      source: "builtin"
    });
  }
  const imports = extractJavaImports(content, codeOffsets);
  const receiverTypes = extractJavaVariableTypes(content);
  const annotationSpans = extractJavaAnnotationSpans(
    content,
    codeOffsets
  );
  const typeBlocks = extractJavaTypeBlocks(
    content,
    codeOffsets
  );
  for (const typeBlock of typeBlocks) {
    symbols.push({
      name: typeBlock.name,
      qualifiedName: typeBlock.qualifiedName,
      kind: typeBlock.kind,
      line: lineForOffset(
        lineStarts,
        typeBlock.declarationStart
      ),
      endLine: lineForOffset(
        lineStarts,
        typeBlock.bodyEnd
      ),
      ...(typeBlock.parentQualifiedName
        ? {
            parentQualifiedName:
              typeBlock.parentQualifiedName
          }
        : {}),
      ...documentationField(
        content,
        typeBlock.declarationStart
      ),
      calls: [],
      source: "builtin"
    });
  }

  const fieldPattern =
    /^[ \t]*(?:(?:public|protected|private|static|final|transient|volatile)\s+)*(?:[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*(?:\s*<[^;{}()]+>)?(?:\s*\[\s*\])*)\s+([A-Za-z_$][\w$]*)\s*(?:=[^;]*)?;/gm;
  for (const match of content.matchAll(fieldPattern)) {
    const name = match[1];
    const start = match.index;
    if (
      !name ||
      start === undefined ||
      !codeOffsets.isCode(capturedGroupOffset(match, 1))
    ) {
      continue;
    }
    const owner = javaTypeOwnerAtOffset(
      content,
      typeBlocks,
      start
    );
    if (!owner) {
      continue;
    }
    symbols.push({
      name,
      qualifiedName: `${owner.qualifiedName}.${name}`,
      kind: "property",
      line: lineForOffset(lineStarts, start),
      endLine: lineForOffset(
        lineStarts,
        start + match[0].length
      ),
      parentQualifiedName: owner.qualifiedName,
      ...documentationField(content, start),
      calls: [],
      source: "builtin"
    });
  }

  const methodPattern =
    /^[ \t]*(?:(?:public|protected|private|static|final|abstract|synchronized|native|default)\s+)*(?:<[^>{}]+>\s+)?[A-Za-z_$][\w$<>\[\], ?.@]*(?:\s*\[\s*\])?\s+([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*(?:throws\s+[^{}]+)?\{/gm;
  const methodMatches = [...content.matchAll(methodPattern)];
  const factoryReturnTypes = new Map<
    string,
    Map<string, string>
  >();
  for (const match of methodMatches) {
    const name = match[1];
    const start = match.index;
    if (
      !name ||
      start === undefined ||
      !codeOffsets.isCode(capturedGroupOffset(match, 1))
    ) {
      continue;
    }
    const owner = javaTypeOwnerAtOffset(
      content,
      typeBlocks,
      start
    );
    if (!owner || name === owner.name) {
      continue;
    }
    const returnType = javaNoArgReturnType(
      match[0],
      name
    );
    if (!returnType) {
      continue;
    }
    const ownerFactories =
      factoryReturnTypes.get(owner.qualifiedName) ??
      new Map<string, string>();
    ownerFactories.set(name, returnType);
    factoryReturnTypes.set(
      owner.qualifiedName,
      ownerFactories
    );
  }

  for (const match of methodMatches) {
    const name = match[1];
    const start = match.index;
    if (
      !name ||
      start === undefined ||
      CALL_KEYWORDS.has(name) ||
      !codeOffsets.isCode(capturedGroupOffset(match, 1))
    ) {
      continue;
    }
    const owner = javaTypeOwnerAtOffset(
      content,
      typeBlocks,
      start
    );
    if (!owner || name === owner.name) {
      continue;
    }
    const braceIndex = start + match[0].lastIndexOf("{");
    const end = findMatchingBrace(content, braceIndex);
    const qualifiedName = `${owner.qualifiedName}.${name}`;
    const annotationBlock = leadingJavaAnnotationBlock(
      content,
      start,
      annotationSpans
    );
    const symbolStart = annotationBlock?.start ?? start;
    const line = lineForOffset(lineStarts, symbolStart);
    const annotations = annotationBlock?.text ?? "";
    const methodReceiverTypes = new Map(receiverTypes);
    for (const [receiver, type] of extractJavaVariableTypes(
      content.slice(start, end + 1)
    )) {
      methodReceiverTypes.set(receiver, type);
    }

    symbols.push({
      name,
      qualifiedName,
      kind: "method",
      line,
      endLine: lineForOffset(lineStarts, end),
      parentQualifiedName: owner.qualifiedName,
      signature: javaMethodSignature(name, match[0]),
      ...documentationField(content, symbolStart),
      calls: extractCalls(
        content.slice(braceIndex + 1, end),
        lineForOffset(lineStarts, braceIndex + 1),
        methodReceiverTypes,
        factoryReturnTypes.get(owner.qualifiedName)
      ),
      ...referenceField(
        extractJavaQualifiedReferences(
          content.slice(braceIndex + 1, end),
          lineForOffset(lineStarts, braceIndex + 1),
          imports
        )
      ),
      source: "builtin"
    });
    remoteBoundaries.push(
      ...collectJavaMethodProfileBoundaries({
        annotations,
        hasBody: true,
        imports,
        line,
        packageName,
        symbolQualifiedName: qualifiedName
      })
    );

    for (const endpoint of extractSpringEndpoints(
      annotations,
      annotationRoutes(owner.annotations)
    )) {
      serverEndpoints.push({
        ...endpoint,
        line,
        symbolQualifiedName: qualifiedName
      });
    }
  }

  const declarationMethodPattern =
    /^[ \t]*(?:(?:public|protected|private|static|final|abstract|synchronized|native|default)\s+)*(?:<[^>{}]+>\s+)?[A-Za-z_$][\w$<>\[\], ?.@]*(?:\s*\[\s*\])?\s+([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*(?:throws\s+[^;{}]+)?;/gm;

  for (const match of content.matchAll(
    declarationMethodPattern
  )) {
    const name = match[1];
    const start = match.index;
    if (
      !name ||
      start === undefined ||
      CALL_KEYWORDS.has(name) ||
      !codeOffsets.isCode(capturedGroupOffset(match, 1))
    ) {
      continue;
    }
    const owner = javaTypeOwnerAtOffset(
      content,
      typeBlocks,
      start
    );
    if (!owner || name === owner.name) {
      continue;
    }
    const qualifiedName = `${owner.qualifiedName}.${name}`;
    const annotationBlock = leadingJavaAnnotationBlock(
      content,
      start,
      annotationSpans
    );
    if (!annotationBlock) {
      continue;
    }
    const line = lineForOffset(
      lineStarts,
      annotationBlock.start
    );
    const annotations = annotationBlock.text;
    const end = start + match[0].length - 1;
    symbols.push({
      name,
      qualifiedName,
      kind: "method",
      line,
      endLine: lineForOffset(lineStarts, end),
      parentQualifiedName: owner.qualifiedName,
      signature: javaMethodSignature(name, match[0]),
      ...documentationField(content, annotationBlock.start),
      calls: [],
      source: "builtin"
    });
    remoteBoundaries.push(
      ...collectJavaMethodProfileBoundaries({
        annotations,
        hasBody: false,
        imports,
        line,
        packageName,
        symbolQualifiedName: qualifiedName
      })
    );
  }

  const functionalRoutePattern =
    /\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*\(\s*(["'`])([^"'`]+)\2\s*\)\s*,\s*([A-Za-z_$][\w$]*)(?:::|\.)([A-Za-z_$][\w$]*)/g;
  for (const match of content.matchAll(
    functionalRoutePattern
  )) {
    const method = match[1];
    const rawRoute = match[3];
    const owner = match[4];
    const handler = match[5];
    if (
      !method ||
      !rawRoute ||
      !owner ||
      !handler ||
      match.index === undefined ||
      !codeOffsets.isCode(match.index)
    ) {
      continue;
    }
    serverEndpoints.push({
      method,
      route: normalizeRoute(rawRoute),
      rawRoute,
      line: lineForOffset(lineStarts, match.index),
      symbolQualifiedName: `${owner}.${handler}`,
      annotation: "RouterFunctions"
    });
  }

  for (const symbol of symbols) {
    if (
      packageName &&
      symbol.kind !== "package" &&
      symbol.kind !== "module"
    ) {
      symbol.packageName = packageName;
    }
    symbol.semanticId = [
      symbol.packageName ?? "",
      symbol.qualifiedName,
      symbol.kind,
      symbol.signature ?? "",
      String(symbol.line)
    ].join("\0");
  }

  return {
    file,
    symbols,
    clientRequests: [],
    serverEndpoints,
    remoteBoundaries
  };
}

function extractJavaTypeBlocks(
  content: string,
  codeOffsets: SourceCodeOffsets
): JavaTypeBlock[] {
  const blocks: JavaTypeBlock[] = [];
  const pattern =
    /((?:^[ \t]*@[^\r\n]+[\r\n]+)*)^[ \t]*(?:(?:public|protected|private|abstract|static|final|sealed|non-sealed|strictfp)\s+)*(class|interface|record|enum)\s+([A-Za-z_$][\w$]*)[^{;]*\{/gm;
  for (const match of content.matchAll(pattern)) {
    const declarationKind = match[2];
    const name = match[3];
    const declarationStart = match.index;
    if (
      !declarationKind ||
      !name ||
      declarationStart === undefined ||
      !codeOffsets.isCode(capturedGroupOffset(match, 3))
    ) {
      continue;
    }
    const braceIndex =
      declarationStart + match[0].lastIndexOf("{");
    const bodyEnd = findMatchingBrace(content, braceIndex);
    const parent = [...blocks]
      .reverse()
      .find(
        (candidate) =>
          declarationStart >= candidate.bodyStart &&
          declarationStart < candidate.bodyEnd
      );
    if (
      parent &&
      !isTopLevelTypeMember(
        content,
        parent.bodyStart,
        parent.bodyEnd,
        declarationStart
      )
    ) {
      continue;
    }
    const qualifiedName = parent
      ? `${parent.qualifiedName}.${name}`
      : name;
    blocks.push({
      name,
      qualifiedName,
      kind:
        declarationKind === "interface"
          ? "interface"
          : declarationKind === "enum"
            ? "enum"
            : "class",
      declarationStart,
      bodyStart: braceIndex + 1,
      bodyEnd,
      annotations: match[1] ?? "",
      ...(parent
        ? { parentQualifiedName: parent.qualifiedName }
        : {})
    });
  }
  return blocks;
}

function javaTypeOwnerAtOffset(
  content: string,
  blocks: JavaTypeBlock[],
  offset: number
): JavaTypeBlock | undefined {
  return [...blocks]
    .reverse()
    .find(
      (block) =>
        offset >= block.bodyStart &&
        offset < block.bodyEnd &&
        isTopLevelTypeMember(
          content,
          block.bodyStart,
          block.bodyEnd,
          offset
        )
    );
}

function extractJavaQualifiedReferences(
  content: string,
  startingLine: number,
  imports: ReadonlyMap<string, string>
): ParsedReference[] {
  const references: ParsedReference[] = [];
  const lineStarts = createLineStarts(content);
  const codeOffsets = createSourceCodeOffsets(content);
  const seen = new Set<string>();
  const pattern =
    /\b([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)+)\b/g;
  for (const match of content.matchAll(pattern)) {
    const rawQualifiedName = match[1];
    const start = match.index;
    if (
      !rawQualifiedName ||
      start === undefined ||
      !codeOffsets.isCode(start)
    ) {
      continue;
    }
    const rawTargetQualifiedName =
      rawQualifiedName.replace(/\s+/g, "");
    const firstSegment =
      rawTargetQualifiedName.split(".")[0] ?? "";
    const importedType = imports.get(firstSegment);
    const targetQualifiedName = importedType
      ? `${importedType}${rawTargetQualifiedName.slice(
          firstSegment.length
        )}`
      : rawTargetQualifiedName;
    const name = targetQualifiedName.split(".").at(-1);
    const nextOffset = skipWhitespace(
      content,
      start + match[0].length
    );
    if (
      !name ||
      name === "class" ||
      content[nextOffset] === "("
    ) {
      continue;
    }
    const line =
      startingLine +
      lineForOffset(lineStarts, start) -
      1;
    const key = `${targetQualifiedName}\0${line}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    references.push({
      name,
      targetQualifiedName,
      line,
      source: "builtin",
      evidence: `静态限定引用 ${targetQualifiedName}`
    });
  }
  return references;
}

function javaMethodSignature(
  name: string,
  declaration: string
): string {
  const open = declaration.indexOf("(");
  const close = declaration.lastIndexOf(")");
  if (open < 0 || close <= open) {
    return `${name}()`;
  }
  const parameters = declaration
    .slice(open + 1, close)
    .replace(/\s+/g, " ")
    .trim();
  return `${name}(${parameters})`;
}

function javaNoArgReturnType(
  declaration: string,
  name: string
): string | undefined {
  const open = declaration.indexOf("(");
  const close = declaration.lastIndexOf(")");
  if (
    open < 0 ||
    close < open ||
    declaration.slice(open + 1, close).trim()
  ) {
    return undefined;
  }
  const beforeParameters = declaration
    .slice(0, open)
    .trimEnd();
  if (!beforeParameters.endsWith(name)) {
    return undefined;
  }
  const beforeName = beforeParameters
    .slice(0, -name.length)
    .trimEnd();
  const returnType = beforeName.match(
    /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)$/
  )?.[1];
  return returnType && returnType !== "void"
    ? returnType.split(".").at(-1)
    : undefined;
}

function referenceField(
  references: ParsedReference[]
): Pick<ParsedSymbol, "references"> | Record<string, never> {
  return references.length > 0 ? { references } : {};
}

function extractJavaImports(
  content: string,
  codeOffsets: SourceCodeOffsets
): ReadonlyMap<string, string> {
  const imports = new Map<string, string>();
  const pattern =
    /\bimport\s+(?!static\b)([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*;/g;
  for (const match of content.matchAll(pattern)) {
    if (
      match.index === undefined ||
      !codeOffsets.isCode(match.index)
    ) {
      continue;
    }
    const qualifiedName = match[1];
    const simpleName = qualifiedName?.split(".").at(-1);
    if (qualifiedName && simpleName) {
      imports.set(simpleName, qualifiedName);
    }
  }
  return imports;
}

interface JavaAnnotationSpan {
  start: number;
  end: number;
  text: string;
}

function extractJavaAnnotationSpans(
  content: string,
  codeOffsets: SourceCodeOffsets
): JavaAnnotationSpan[] {
  const spans: JavaAnnotationSpan[] = [];
  const pattern =
    /^[ \t]*@[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/gm;
  for (const match of content.matchAll(pattern)) {
    const start = match.index;
    if (start === undefined) {
      continue;
    }
    if (!codeOffsets.isCode(start)) {
      continue;
    }
    let end = start + match[0].length;
    end = skipHorizontalWhitespace(content, end);
    if (content[end] === "(") {
      end = findMatchingDelimiter(content, end, "(", ")") + 1;
    }
    const lineEnd = content.indexOf("\n", end);
    const trailingEnd =
      lineEnd < 0 ? content.length : lineEnd + 1;
    spans.push({
      start,
      end: trailingEnd,
      text: content.slice(start, trailingEnd)
    });
  }
  return removeNestedAnnotationSpans(spans);
}

function removeNestedAnnotationSpans(
  spans: JavaAnnotationSpan[]
): JavaAnnotationSpan[] {
  const topLevel: JavaAnnotationSpan[] = [];
  for (const span of spans) {
    const containing = topLevel.at(-1);
    if (
      containing &&
      span.start >= containing.start &&
      span.end <= containing.end
    ) {
      continue;
    }
    topLevel.push(span);
  }
  return topLevel;
}

function leadingJavaAnnotationBlock(
  content: string,
  declarationStart: number,
  spans: JavaAnnotationSpan[]
): { start: number; text: string } | undefined {
  let currentStart = declarationStart;
  let firstIndex = -1;
  for (let index = spans.length - 1; index >= 0; index -= 1) {
    const span = spans[index];
    if (!span || span.end > currentStart) {
      continue;
    }
    if (content.slice(span.end, currentStart).trim()) {
      break;
    }
    firstIndex = index;
    currentStart = span.start;
  }
  if (firstIndex < 0) {
    return undefined;
  }
  return {
    start: currentStart,
    text: content.slice(currentStart, declarationStart)
  };
}

function skipHorizontalWhitespace(
  content: string,
  start: number
): number {
  let index = start;
  while (
    content[index] === " " ||
    content[index] === "\t"
  ) {
    index += 1;
  }
  return index;
}

function findMatchingDelimiter(
  content: string,
  opening: number,
  open: string,
  close: string
): number {
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = opening; index < content.length; index += 1) {
    const current = content[index] ?? "";
    const next = content[index + 1] ?? "";
    if (lineComment) {
      if (current === "\n") {
        lineComment = false;
      }
      continue;
    }
    if (blockComment) {
      if (current === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === quote) {
        quote = "";
      }
      continue;
    }
    if (current === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (
      current === '"' ||
      current === "'" ||
      current === "`"
    ) {
      quote = current;
      continue;
    }
    if (current === open) {
      depth += 1;
    } else if (current === close) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return content.length - 1;
}

function extractJavaVariableTypes(
  content: string
): ReadonlyMap<string, string> {
  const types = new Map<string, string>();
  const ambiguous = new Set<string>();
  const codeOffsets = createSourceCodeOffsets(content);
  const pattern =
    /\b([A-Z][A-Za-z0-9_$.]*(?:\s*<[^;={}()]+>)?(?:\s*\[\s*\])*)\s+([A-Za-z_$][\w$]*)\s*(?=[=;,)])/g;
  for (const match of content.matchAll(pattern)) {
    const rawType = match[1];
    const variable = match[2];
    if (
      !rawType ||
      !variable ||
      ambiguous.has(variable) ||
      !codeOffsets.isCode(capturedGroupOffset(match, 2))
    ) {
      continue;
    }
    const type = rawType
      .replace(/\s*<[\s\S]*>/, "")
      .replace(/\s*\[\s*\]/g, "")
      .split(".")
      .at(-1);
    if (!type) {
      continue;
    }
    const existing = types.get(variable);
    if (existing && existing !== type) {
      types.delete(variable);
      ambiguous.add(variable);
      continue;
    }
    types.set(variable, type);
  }
  return types;
}

function isTopLevelTypeMember(
  content: string,
  bodyStart: number,
  bodyEnd: number,
  offset: number
): boolean {
  if (
    bodyStart < 0 ||
    bodyEnd < bodyStart ||
    offset < bodyStart ||
    offset > bodyEnd
  ) {
    return false;
  }

  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = bodyStart; index < offset; index += 1) {
    const current = content[index] ?? "";
    const next = content[index + 1] ?? "";
    if (lineComment) {
      if (current === "\n") {
        lineComment = false;
      }
      continue;
    }
    if (blockComment) {
      if (current === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === quote) {
        quote = "";
      }
      continue;
    }
    if (current === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (current === '"' || current === "'") {
      quote = current;
      continue;
    }
    if (current === "{") {
      depth += 1;
    } else if (current === "}") {
      depth = Math.max(0, depth - 1);
    }
  }
  return depth === 0;
}

function extractClientRequests(
  content: string,
  lineStarts: number[],
  symbols: ParsedSymbol[],
  codeOffsets: SourceCodeOffsets
): ParsedClientRequest[] {
  const requests: ParsedClientRequest[] = [];
  const constants = extractStaticStringConstants(
    content,
    codeOffsets
  );
  const imports = extractRequestImports(
    content,
    codeOffsets,
    constants
  );

  for (const [helperName, method] of imports.directMethods) {
    const pattern = new RegExp(
      `\\b${escapeRegExp(helperName)}\\b`,
      "g"
    );
    for (const match of content.matchAll(pattern)) {
      if (
        match.index === undefined ||
        !codeOffsets.isCode(match.index)
      ) {
        continue;
      }
      const previous = previousNonWhitespace(
        content,
        match.index - 1
      );
      if (previous === ".") {
        continue;
      }
      const openingParenthesis = findCallOpeningParenthesis(
        content,
        match.index + helperName.length
      );
      if (openingParenthesis < 0) {
        continue;
      }
      const rawRoute = readStaticRouteArgument(
        content,
        openingParenthesis + 1,
        constants
      );
      if (rawRoute === undefined) {
        continue;
      }
      pushClientRequest(
        requests,
        content,
        symbols,
        lineStarts,
        match.index,
        method,
        rawRoute
      );
    }
  }

  const receiverPattern =
    /\b([A-Za-z_$][\w$]*)\s*\.\s*(get|post|put|delete|del|patch|head|options|postForm|postJson|post_json)\b/gi;
  for (const match of content.matchAll(receiverPattern)) {
    const receiver = match[1];
    const helperName = match[2];
    if (
      !receiver ||
      !helperName ||
      match.index === undefined ||
      !codeOffsets.isCode(match.index) ||
      !imports.receivers.has(receiver)
    ) {
      continue;
    }
    const method = requestMethodForHelper(helperName);
    if (!method) {
      continue;
    }
    const openingParenthesis = findCallOpeningParenthesis(
      content,
      match.index + match[0].length
    );
    if (openingParenthesis < 0) {
      continue;
    }
    const rawRoute = readStaticRouteArgument(
      content,
      openingParenthesis + 1,
      constants
    );
    if (rawRoute === undefined) {
      continue;
    }
    pushClientRequest(
      requests,
      content,
      symbols,
      lineStarts,
      match.index,
      method,
      applyRequestBaseRoute(
        imports.baseRoutes.get(receiver),
        rawRoute
      )
    );
  }

  const fetchPattern = /\bfetch\b/g;
  for (const match of content.matchAll(fetchPattern)) {
    if (
      match.index === undefined ||
      !codeOffsets.isCode(match.index)
    ) {
      continue;
    }
    const openingParenthesis = findCallOpeningParenthesis(
      content,
      match.index + match[0].length
    );
    if (openingParenthesis < 0) {
      continue;
    }
    const rawRoute = readStaticRouteArgument(
      content,
      openingParenthesis + 1,
      constants
    );
    if (rawRoute === undefined) {
      continue;
    }
    const closingParenthesis = findMatchingDelimiter(
      content,
      openingParenthesis,
      "(",
      ")"
    );
    const callArguments = content.slice(
      openingParenthesis + 1,
      closingParenthesis
    );
    const method =
      readStaticObjectProperty(
        callArguments,
        "method",
        constants
      ) ?? "GET";
    pushClientRequest(
      requests,
      content,
      symbols,
      lineStarts,
      match.index,
      method,
      rawRoute
    );
  }

  const configCallPattern =
    /\b([A-Za-z_$][\w$]*)(?:\s*\.\s*([A-Za-z_$][\w$]*))?/g;
  for (const match of content.matchAll(configCallPattern)) {
    const receiver = match[1];
    const member = match[2];
    if (
      !receiver ||
      match.index === undefined ||
      !codeOffsets.isCode(match.index)
    ) {
      continue;
    }
    const configCallable = member
      ? member === "request" &&
        (receiver === "uni" || imports.receivers.has(receiver))
      : imports.configCallables.has(receiver);
    if (!configCallable) {
      continue;
    }
    const openingParenthesis = findCallOpeningParenthesis(
      content,
      match.index + match[0].length
    );
    if (openingParenthesis < 0) {
      continue;
    }
    const objectStart = skipWhitespace(
      content,
      openingParenthesis + 1
    );
    if (content[objectStart] !== "{") {
      continue;
    }
    const objectEnd = findMatchingBrace(content, objectStart);
    const config = content.slice(objectStart + 1, objectEnd);
    const rawRoute = readStaticObjectProperty(
      config,
      "url",
      constants
    );
    if (rawRoute === undefined) {
      continue;
    }
    const method =
      readStaticObjectProperty(
        config,
        "method",
        constants
      ) ?? "GET";
    pushClientRequest(
      requests,
      content,
      symbols,
      lineStarts,
      match.index,
      method.toUpperCase(),
      applyRequestBaseRoute(
        imports.baseRoutes.get(receiver),
        rawRoute
      )
    );
  }

  return deduplicateRequests(requests);
}

interface RequestImportInfo {
  directMethods: Map<string, string>;
  receivers: Set<string>;
  configCallables: Set<string>;
  baseRoutes: Map<string, string>;
}

function extractRequestImports(
  content: string,
  codeOffsets: SourceCodeOffsets,
  constants: ReadonlyMap<string, string>
): RequestImportInfo {
  const directMethods = new Map<string, string>();
  const receivers = new Set([
    "axios",
    "api",
    "request",
    "http",
    "client"
  ]);
  const configCallables = new Set(["axios"]);
  const baseRoutes = new Map<string, string>();
  const importPattern =
    /\bimport\s+([\s\S]*?)\s+from\s*(["'])([^"']+)\2\s*;?/g;

  for (const match of content.matchAll(importPattern)) {
    if (
      match.index === undefined ||
      !codeOffsets.isCode(match.index)
    ) {
      continue;
    }
    const clause = match[1]?.trim();
    const source = match[3];
    if (
      !clause ||
      !source ||
      !isRequestModule(source)
    ) {
      continue;
    }

    const namespaceMatch =
      /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause);
    if (namespaceMatch?.[1]) {
      receivers.add(namespaceMatch[1]);
    }

    const namedMatch = /\{([\s\S]*?)\}/.exec(clause);
    if (namedMatch?.[1]) {
      for (const rawSpecifier of namedMatch[1].split(",")) {
        const specifier = rawSpecifier
          .trim()
          .replace(/^type\s+/, "");
        if (!specifier) {
          continue;
        }
        const [importedName, localName] = specifier.split(
          /\s+as\s+/
        );
        const imported = importedName?.trim();
        const local = (localName ?? importedName)?.trim();
        if (!imported || !local) {
          continue;
        }
        const method = requestMethodForHelper(imported);
        if (method) {
          directMethods.set(local, method);
        }
        if (
          /^(?:request|axios|http|client)$/i.test(imported)
        ) {
          receivers.add(local);
          configCallables.add(local);
        }
      }
    }

    const defaultImport = clause
      .replace(/\{[\s\S]*?\}/, "")
      .replace(/,\s*$/, "")
      .trim();
    if (
      defaultImport &&
      !defaultImport.startsWith("*") &&
      !defaultImport.startsWith("type ")
    ) {
      const local = defaultImport.split(/\s+/)[0];
      if (local) {
        receivers.add(local);
        configCallables.add(local);
        const method = requestMethodForHelper(local);
        if (method) {
          directMethods.set(local, method);
        }
      }
    }
  }

  const instancePattern =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\.\s*create\b/g;
  for (const match of content.matchAll(instancePattern)) {
    const instance = match[1];
    const factory = match[2];
    if (
      !instance ||
      !factory ||
      match.index === undefined ||
      !codeOffsets.isCode(capturedGroupOffset(match, 1)) ||
      !receivers.has(factory)
    ) {
      continue;
    }
    const openingParenthesis = findCallOpeningParenthesis(
      content,
      match.index + match[0].length
    );
    if (openingParenthesis < 0) {
      continue;
    }
    receivers.add(instance);
    configCallables.add(instance);
    const objectStart = skipWhitespace(
      content,
      openingParenthesis + 1
    );
    if (content[objectStart] !== "{") {
      continue;
    }
    const objectEnd = findMatchingBrace(content, objectStart);
    const config = content.slice(objectStart + 1, objectEnd);
    const baseRoute = readStaticObjectProperty(
      config,
      "baseURL",
      constants
    );
    if (baseRoute !== undefined) {
      baseRoutes.set(instance, baseRoute);
    }
  }

  return {
    directMethods,
    receivers,
    configCallables,
    baseRoutes
  };
}

function isRequestModule(source: string): boolean {
  const normalized = source
    .replace(/\\/g, "/")
    .toLocaleLowerCase("en-US");
  if (
    normalized === "node:http" ||
    normalized === "node:https" ||
    normalized === "http" ||
    normalized === "https"
  ) {
    return false;
  }
  if (normalized === "axios") {
    return true;
  }
  return normalized
    .split(/[/@._:-]+/)
    .some((segment) =>
      ["api", "request", "http", "client", "axios"].includes(
        segment
      )
    );
}

function requestMethodForHelper(
  helperName: string
): string | undefined {
  const normalized = helperName
    .replace(/[_-]/g, "")
    .toLocaleLowerCase("en-US");
  return {
    get: "GET",
    post: "POST",
    postjson: "POST",
    postform: "POST",
    put: "PUT",
    putjson: "PUT",
    delete: "DELETE",
    del: "DELETE",
    patch: "PATCH",
    patchjson: "PATCH",
    head: "HEAD",
    options: "OPTIONS"
  }[normalized];
}

function pushClientRequest(
  requests: ParsedClientRequest[],
  content: string,
  symbols: ParsedSymbol[],
  lineStarts: number[],
  offset: number,
  method: string,
  rawRoute: string
): void {
  const line = lineForOffset(lineStarts, offset);
  requests.push({
    method: method.toUpperCase(),
    route: normalizeClientRoute(rawRoute),
    rawRoute,
    line,
    ...requestDocumentationField(content, offset),
    ...containerField(symbols, line)
  });
}

function findCallOpeningParenthesis(
  content: string,
  start: number
): number {
  let index = skipWhitespace(content, start);
  if (content[index] === "<") {
    let depth = 0;
    let quote = "";
    let escaped = false;
    for (; index < content.length; index += 1) {
      const current = content[index] ?? "";
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (current === "\\") {
          escaped = true;
        } else if (current === quote) {
          quote = "";
        }
        continue;
      }
      if (
        current === '"' ||
        current === "'" ||
        current === "`"
      ) {
        quote = current;
        continue;
      }
      if (current === "<") {
        depth += 1;
      } else if (current === ">") {
        depth -= 1;
        if (depth === 0) {
          index += 1;
          break;
        }
      }
    }
    if (depth !== 0) {
      return -1;
    }
    index = skipWhitespace(content, index);
  }
  return content[index] === "(" ? index : -1;
}

function readQuotedArgument(
  content: string,
  start: number
): string | undefined {
  let index = skipWhitespace(content, start);
  const quote = content[index];
  if (
    quote !== '"' &&
    quote !== "'" &&
    quote !== "`"
  ) {
    return undefined;
  }
  index += 1;
  const valueStart = index;
  let escaped = false;
  for (; index < content.length; index += 1) {
    const current = content[index] ?? "";
    if (escaped) {
      escaped = false;
      continue;
    }
    if (current === "\\") {
      escaped = true;
      continue;
    }
    if (current === quote) {
      return content.slice(valueStart, index);
    }
  }
  return undefined;
}

function extractStaticStringConstants(
  content: string,
  codeOffsets: SourceCodeOffsets
): ReadonlyMap<string, string> {
  const constants = new Map<string, string>();
  const ambiguous = new Set<string>();
  const pattern =
    /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*/g;
  for (const match of content.matchAll(pattern)) {
    const name = match[1];
    if (
      !name ||
      match.index === undefined ||
      !codeOffsets.isCode(capturedGroupOffset(match, 1)) ||
      ambiguous.has(name)
    ) {
      continue;
    }
    const value = readQuotedArgument(
      content,
      match.index + match[0].length
    );
    if (value === undefined) {
      continue;
    }
    const existing = constants.get(name);
    if (existing !== undefined && existing !== value) {
      constants.delete(name);
      ambiguous.add(name);
      continue;
    }
    constants.set(name, value);
  }
  return constants;
}

function readStaticRouteArgument(
  content: string,
  start: number,
  constants: ReadonlyMap<string, string>
): string | undefined {
  const index = skipWhitespace(content, start);
  const quoted = readQuotedArgument(content, index);
  if (quoted !== undefined) {
    return quoted;
  }

  const newUrlMatch = /^new\s+URL\b/.exec(
    content.slice(index)
  );
  if (newUrlMatch) {
    const openingParenthesis = findCallOpeningParenthesis(
      content,
      index + newUrlMatch[0].length
    );
    return openingParenthesis < 0
      ? undefined
      : readStaticRouteArgument(
          content,
          openingParenthesis + 1,
          constants
        );
  }

  const identifier =
    /^[A-Za-z_$][\w$]*/.exec(content.slice(index))?.[0];
  return identifier ? constants.get(identifier) : undefined;
}

function readStaticObjectProperty(
  content: string,
  property: string,
  constants: ReadonlyMap<string, string>
): string | undefined {
  const codeOffsets = createSourceCodeOffsets(content);
  const pattern = new RegExp(
    `\\b${escapeRegExp(property)}\\s*:\\s*`,
    "g"
  );
  for (const match of content.matchAll(pattern)) {
    if (
      match.index === undefined ||
      !codeOffsets.isCode(match.index)
    ) {
      continue;
    }
    const value = readStaticRouteArgument(
      content,
      match.index + match[0].length,
      constants
    );
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function applyRequestBaseRoute(
  baseRoute: string | undefined,
  route: string
): string {
  if (
    !baseRoute ||
    /^[A-Za-z][A-Za-z\d+.-]*:\/\//.test(route)
  ) {
    return route;
  }
  return joinRoutes(baseRoute, route);
}

function skipWhitespace(
  content: string,
  start: number
): number {
  let index = start;
  while (
    index < content.length &&
    /\s/.test(content[index] ?? "")
  ) {
    index += 1;
  }
  return index;
}

function previousNonWhitespace(
  content: string,
  start: number
): string {
  let index = start;
  while (
    index >= 0 &&
    /\s/.test(content[index] ?? "")
  ) {
    index -= 1;
  }
  return content[index] ?? "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSpringEndpoints(
  annotations: string,
  classRoutes: string[]
): Array<
  Omit<
    ParsedServerEndpoint,
    "line" | "symbolQualifiedName"
  >
> {
  const endpoints: Array<
    Omit<
      ParsedServerEndpoint,
      "line" | "symbolQualifiedName"
    >
  > = [];
  const mappingPattern =
    /@(Get|Post|Put|Delete|Patch)Mapping\s*(?:\(([^)]*)\))?/g;
  for (const match of annotations.matchAll(mappingPattern)) {
    const methodPrefix = match[1];
    if (!methodPrefix) {
      continue;
    }
    const method = methodPrefix.toUpperCase();
    const methodRoutes = extractMappingRoutes(
      match[2] ?? ""
    );
    for (const classRoute of classRoutes) {
      for (const methodRoute of methodRoutes) {
        const rawRoute = joinRoutes(
          classRoute,
          methodRoute
        );
        endpoints.push({
          method,
          route: normalizeRoute(rawRoute),
          rawRoute,
          annotation: `@${methodPrefix}Mapping`
        });
      }
    }
  }

  const requestMappingPattern =
    /@RequestMapping\s*(?:\(([^)]*)\))?/g;
  for (const match of annotations.matchAll(
    requestMappingPattern
  )) {
    const argumentsText = match[1] ?? "";
    const methods = extractRequestMappingMethods(
      argumentsText
    );
    const methodRoutes =
      extractMappingRoutes(argumentsText);
    for (const classRoute of classRoutes) {
      for (const methodRoute of methodRoutes) {
        const rawRoute = joinRoutes(
          classRoute,
          methodRoute
        );
        for (const method of methods) {
          endpoints.push({
            method,
            route: normalizeRoute(rawRoute),
            rawRoute,
            annotation: "@RequestMapping"
          });
        }
      }
    }
  }

  return [
    ...new Map(
      endpoints.map((endpoint) => [
        `${endpoint.method}\0${endpoint.route}\0${endpoint.annotation}`,
        endpoint
      ])
    ).values()
  ];
}

function annotationRoutes(annotations: string): string[] {
  const match =
    /@RequestMapping\s*(?:\(([^)]*)\))?/.exec(annotations);
  return extractMappingRoutes(match?.[1] ?? "");
}

function extractMappingRoutes(argumentsText: string): string[] {
  const attribute =
    /\b(?:value|path)\s*=\s*/.exec(argumentsText);
  const start = attribute
    ? attribute.index + attribute[0].length
    : 0;
  const index = skipWhitespace(argumentsText, start);
  if (argumentsText[index] === "{") {
    const end = findMatchingDelimiter(
      argumentsText,
      index,
      "{",
      "}"
    );
    const values = extractQuotedValues(
      argumentsText.slice(index + 1, end)
    );
    return values.length > 0 ? values : [""];
  }
  const route = readQuotedArgument(argumentsText, index);
  return route === undefined ? [""] : [route];
}

function extractRequestMappingMethods(
  argumentsText: string
): string[] {
  const methods = [
    ...argumentsText.matchAll(
      /RequestMethod\.(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|TRACE)/g
    )
  ].flatMap((match) => (match[1] ? [match[1]] : []));
  return methods.length > 0 ? [...new Set(methods)] : ["ANY"];
}

function extractQuotedValues(text: string): string[] {
  return [
    ...text.matchAll(/(["'])([\s\S]*?)\1/g)
  ].flatMap((match) =>
    match[2] === undefined ? [] : [match[2]]
  );
}

function joinRoutes(prefix: string, suffix: string): string {
  return `${prefix.replace(/\/+$/g, "")}/${suffix.replace(
    /^\/+/g,
    ""
  )}`;
}

export function normalizeRoute(route: string): string {
  const withoutQuery = route.split(/[?#]/, 1)[0] ?? "";
  const normalized = withoutQuery
    .replace(/\$\{[^}]+\}/g, ":param")
    .replace(/\{[^}/]+\}/g, ":param")
    .replace(/\+\s*[A-Za-z_$][\w$.[\]]*/g, ":param")
    .replace(/\/+/g, "/")
    .trim();
  if (!normalized || normalized === "/") {
    return "/";
  }
  const withLeadingSlash = normalized.startsWith("/")
    ? normalized
    : `/${normalized}`;
  return withLeadingSlash.replace(/\/+$/g, "");
}

function normalizeClientRoute(route: string): string {
  const withoutOrigin = route.replace(
    /^https?:\/\/[^/]+/i,
    ""
  );
  return normalizeRoute(withoutOrigin);
}

function extractCalls(
  body: string,
  startingLine: number,
  receiverTypes: ReadonlyMap<string, string> = new Map(),
  factoryReturnTypes?: ReadonlyMap<string, string>
): ParsedCall[] {
  const calls: ParsedCall[] = [];
  const lineStarts = createLineStarts(body);
  const codeOffsets = createSourceCodeOffsets(body);
  const pattern =
    /\b(?:(?<receiver>[A-Za-z_$][\w$]*)\s*\.\s*)?(?<name>[A-Za-z_$][\w$]*)\s*\(/g;
  for (const match of body.matchAll(pattern)) {
    const name = match.groups?.name;
    if (
      !name ||
      CALL_KEYWORDS.has(name) ||
      match.index === undefined ||
      !codeOffsets.isCode(
        match.index + match[0].lastIndexOf(name)
      )
    ) {
      continue;
    }
    const precedingExpression = body.slice(
      Math.max(0, match.index - 128),
      match.index
    );
    const factoryMatch =
      factoryReturnTypes &&
      !match.groups?.receiver
        ? /([A-Za-z_$][\w$]*)\s*\(\s*\)\s*\.\s*$/.exec(
            precedingExpression
          )
        : undefined;
    const chainedFactory = factoryMatch?.[1];
    const factoryQualifier = factoryMatch
      ? precedingExpression
          .slice(0, factoryMatch.index)
          .trimEnd()
      : "";
    const localFactory =
      chainedFactory &&
      (!factoryQualifier.endsWith(".") ||
        factoryQualifier.endsWith("this."));
    const receiver =
      match.groups?.receiver ??
      (chainedFactory
        ? `${chainedFactory}()`
        : undefined);
    const receiverType = localFactory
      ? factoryReturnTypes?.get(chainedFactory)
      : receiver
        ? receiverTypes.get(receiver)
        : undefined;
    calls.push({
      name,
      ...(receiver ? { receiver } : {}),
      ...(receiverType ? { receiverType } : {}),
      line:
        startingLine +
        lineForOffset(lineStarts, match.index) -
        1,
      source: "builtin",
      evidence: receiver
        ? `静态调用表达式 ${receiver}.${name}(…)`
        : `静态调用表达式 ${name}(…)`
    });
  }
  return calls;
}

function containerField(
  symbols: ParsedSymbol[],
  line: number
): Pick<
  ParsedClientRequest,
  "containerQualifiedName"
> | Record<string, never> {
  const container = symbols
    .filter(
      (symbol) =>
        (symbol.kind === "function" ||
          symbol.kind === "method") &&
        line >= symbol.line &&
        line <= symbol.endLine
    )
    .sort(
      (left, right) =>
        left.endLine -
        left.line -
        (right.endLine - right.line)
    )[0];
  return container
    ? { containerQualifiedName: container.qualifiedName }
    : {};
}

function requestDocumentationField(
  content: string,
  requestOffset: number
): Pick<
  ParsedClientRequest,
  "documentation"
> | Record<string, never> {
  const lineStart =
    content.lastIndexOf(
      "\n",
      Math.max(0, requestOffset - 1)
    ) + 1;
  const documentation = extractLeadingDocumentation(
    content,
    lineStart
  );
  return documentation ? { documentation } : {};
}

function deduplicateRequests(
  requests: ParsedClientRequest[]
): ParsedClientRequest[] {
  const seen = new Set<string>();
  return requests
    .filter((request) => {
      const key = `${request.method}:${request.route}:${request.line}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((left, right) => left.line - right.line);
}

function documentationField(
  content: string,
  declarationStart: number
): Pick<ParsedSymbol, "documentation"> | Record<string, never> {
  const documentation = extractLeadingDocumentation(
    content,
    declarationStart
  );
  return documentation ? { documentation } : {};
}

function extractLeadingDocumentation(
  content: string,
  declarationStart: number
): string | undefined {
  const anchor = decoratorBlockStart(content, declarationStart);
  const prefix = content.slice(0, anchor);
  const trimmedEnd = prefix.trimEnd().length;
  const gap = prefix.slice(trimmedEnd);
  if ((gap.match(/\n/g) ?? []).length > 1 || trimmedEnd === 0) {
    return undefined;
  }

  const beforeDeclaration = prefix.slice(0, trimmedEnd);
  if (beforeDeclaration.endsWith("*/")) {
    const commentStart = beforeDeclaration.lastIndexOf("/*");
    if (commentStart < 0) {
      return undefined;
    }
    const lineStart =
      beforeDeclaration.lastIndexOf("\n", commentStart - 1) + 1;
    if (
      beforeDeclaration.slice(lineStart, commentStart).trim()
    ) {
      return undefined;
    }
    return summarizeDocumentation(
      beforeDeclaration.slice(commentStart, trimmedEnd)
    );
  }

  const lines: string[] = [];
  let lineEnd = trimmedEnd;
  while (lineEnd > 0) {
    const lineStart =
      beforeDeclaration.lastIndexOf("\n", lineEnd - 1) + 1;
    const line = beforeDeclaration
      .slice(lineStart, lineEnd)
      .replace(/\r$/, "");
    const match = /^\s*\/\/\/?\s?(.*)$/.exec(line);
    if (!match) {
      break;
    }
    lines.unshift(match[1] ?? "");
    if (lineStart === 0) {
      break;
    }
    lineEnd = lineStart - 1;
  }
  return lines.length > 0
    ? summarizeDocumentation(lines.join("\n"))
    : undefined;
}

function decoratorBlockStart(
  content: string,
  declarationStart: number
): number {
  const currentLineStart =
    content.lastIndexOf(
      "\n",
      Math.max(0, declarationStart - 1)
    ) + 1;
  let anchor = declarationStart;
  let lineStart = currentLineStart;

  while (lineStart > 0) {
    const previousLineEnd = lineStart - 1;
    const previousLineStart =
      content.lastIndexOf("\n", previousLineEnd - 1) + 1;
    const previousLine = content
      .slice(previousLineStart, previousLineEnd)
      .replace(/\r$/, "");
    if (!/^\s*@[A-Za-z_$]/.test(previousLine)) {
      break;
    }
    anchor = previousLineStart;
    lineStart = previousLineStart;
  }

  return anchor;
}

function summarizeDocumentation(
  comment: string
): string | undefined {
  const lines = comment
    .replace(/^\/\*\*?/, "")
    .replace(/\*\/$/, "")
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*\*\s?/, "")
        .replace(/^\s*\/\/\/?\s?/, "")
        .trim()
    );
  const description: string[] = [];
  for (const line of lines) {
    if (line.startsWith("@")) {
      break;
    }
    if (!line) {
      if (description.length > 0) {
        break;
      }
      continue;
    }
    description.push(line);
  }
  const value = description.join(" ").replace(/\s+/g, " ").trim();
  return value
    ? value.slice(0, MAX_CODE_DOCUMENTATION_CHARACTERS)
    : undefined;
}

interface SourceCodeOffsets {
  isCode(offset: number): boolean;
}

function createSourceCodeOffsets(
  content: string,
  vueScriptOnly = false
): SourceCodeOffsets {
  const flags = new Uint8Array(content.length);
  const ranges = vueScriptOnly
    ? vueScriptRanges(content)
    : [{ start: 0, end: content.length }];
  for (const range of ranges) {
    markLexicalCode(
      content,
      flags,
      range.start,
      range.end
    );
  }
  return {
    isCode(offset: number): boolean {
      return (
        Number.isSafeInteger(offset) &&
        offset >= 0 &&
        offset < flags.length &&
        flags[offset] === 1
      );
    }
  };
}

function vueScriptRanges(
  content: string
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const openingPattern = /<script\b[^>]*>/gi;
  const closingPattern = /<\/script\s*>/gi;
  let opening = openingPattern.exec(content);
  while (opening) {
    const start = opening.index + opening[0].length;
    closingPattern.lastIndex = start;
    const closing = closingPattern.exec(content);
    ranges.push({
      start,
      end: closing?.index ?? content.length
    });
    if (!closing) {
      break;
    }
    openingPattern.lastIndex =
      closing.index + closing[0].length;
    opening = openingPattern.exec(content);
  }
  if (
    ranges.length === 0 &&
    !/<(?:template|style)\b/i.test(content)
  ) {
    return [{ start: 0, end: content.length }];
  }
  return ranges;
}

function markLexicalCode(
  content: string,
  flags: Uint8Array,
  start: number,
  end: number
): void {
  flags.fill(1, start, end);
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = start; index < end; index += 1) {
    const current = content[index] ?? "";
    const next = content[index + 1] ?? "";

    if (lineComment) {
      flags[index] = 0;
      if (current === "\n") {
        lineComment = false;
      }
      continue;
    }
    if (blockComment) {
      flags[index] = 0;
      if (current === "*" && next === "/") {
        if (index + 1 < end) {
          flags[index + 1] = 0;
        }
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      flags[index] = 0;
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === quote) {
        quote = "";
      }
      continue;
    }
    if (current === "/" && next === "/") {
      flags[index] = 0;
      if (index + 1 < end) {
        flags[index + 1] = 0;
      }
      lineComment = true;
      index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      flags[index] = 0;
      if (index + 1 < end) {
        flags[index + 1] = 0;
      }
      blockComment = true;
      index += 1;
      continue;
    }
    if (
      current === '"' ||
      current === "'" ||
      current === "`"
    ) {
      flags[index] = 0;
      quote = current;
    }
  }
}

function capturedGroupOffset(
  match: RegExpMatchArray,
  group: number
): number {
  const start = match.index ?? 0;
  const value = match[group];
  if (!value) {
    return start;
  }
  const relative = match[0].lastIndexOf(value);
  return start + Math.max(0, relative);
}

function firstCodeMatch(
  content: string,
  pattern: RegExp,
  codeOffsets: SourceCodeOffsets,
  group: number
): RegExpMatchArray | undefined {
  for (const match of content.matchAll(pattern)) {
    if (codeOffsets.isCode(capturedGroupOffset(match, group))) {
      return match;
    }
  }
  return undefined;
}

function isInsideAnyClass(
  offset: number,
  classBlocks: Array<{
    bodyStart: number;
    bodyEnd: number;
  }>
): boolean {
  return classBlocks.some(
    (block) =>
      offset >= block.bodyStart && offset <= block.bodyEnd
  );
}

function createLineStarts(content: string): number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) {
      starts.push(index + 1);
    }
  }
  return starts;
}

function lineForOffset(
  lineStarts: number[],
  offset: number
): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const start = lineStarts[middle] ?? 0;
    const next = lineStarts[middle + 1] ?? Number.POSITIVE_INFINITY;
    if (offset < start) {
      high = middle - 1;
    } else if (offset >= next) {
      low = middle + 1;
    } else {
      return middle + 1;
    }
  }
  return Math.max(1, low + 1);
}

function findMatchingBrace(
  content: string,
  openingBrace: number
): number {
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (
    let index = openingBrace;
    index < content.length;
    index += 1
  ) {
    const current = content[index] ?? "";
    const next = content[index + 1] ?? "";

    if (lineComment) {
      if (current === "\n") {
        lineComment = false;
      }
      continue;
    }
    if (blockComment) {
      if (current === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === quote) {
        quote = "";
      }
      continue;
    }
    if (
      current === "/" &&
      next === "/"
    ) {
      lineComment = true;
      index += 1;
      continue;
    }
    if (
      current === "/" &&
      next === "*"
    ) {
      blockComment = true;
      index += 1;
      continue;
    }
    if (
      current === '"' ||
      current === "'" ||
      current === "`"
    ) {
      quote = current;
      continue;
    }
    if (current === "{") {
      depth += 1;
    } else if (current === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return content.length - 1;
}

function findExpressionEnd(
  content: string,
  expressionStart: number
): number {
  let parentheses = 0;
  let brackets = 0;
  let braces = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  let seenExpression = false;

  for (
    let index = expressionStart;
    index < content.length;
    index += 1
  ) {
    const current = content[index] ?? "";
    const next = content[index + 1] ?? "";

    if (lineComment) {
      if (current === "\n") {
        lineComment = false;
        if (
          seenExpression &&
          parentheses === 0 &&
          brackets === 0 &&
          braces === 0
        ) {
          return index;
        }
      }
      continue;
    }
    if (blockComment) {
      if (current === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === quote) {
        quote = "";
      }
      continue;
    }
    if (current === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (
      current === '"' ||
      current === "'" ||
      current === "`"
    ) {
      quote = current;
      seenExpression = true;
      continue;
    }
    if (current === "(") {
      parentheses += 1;
    } else if (current === ")") {
      parentheses = Math.max(0, parentheses - 1);
    } else if (current === "[") {
      brackets += 1;
    } else if (current === "]") {
      brackets = Math.max(0, brackets - 1);
    } else if (current === "{") {
      braces += 1;
    } else if (current === "}") {
      braces = Math.max(0, braces - 1);
    } else if (
      current === ";" &&
      parentheses === 0 &&
      brackets === 0 &&
      braces === 0
    ) {
      return index;
    } else if (
      current === "\n" &&
      seenExpression &&
      parentheses === 0 &&
      brackets === 0 &&
      braces === 0
    ) {
      return index;
    }
    if (!/\s/.test(current)) {
      seenExpression = true;
    }
  }
  return content.length - 1;
}

import { describe, expect, it } from "vitest";

import {
  tokenizeSourceLines,
  type SourceSyntaxTokenKind
} from "./sourceSyntax";

describe("sourceSyntax", () => {
  it("highlights TypeScript declarations without coloring string contents as code", () => {
    const line =
      'export async function loadUser(id: string): Promise<User> { return "class 42"; } // note';
    const [tokens] = tokenizeSourceLines(
      [line],
      "typescript",
      "src/loadUser.ts"
    );

    expect(textForKind(line, tokens, "keyword")).toEqual([
      "export",
      "async",
      "function",
      "return"
    ]);
    expect(textForKind(line, tokens, "function")).toEqual([
      "loadUser"
    ]);
    expect(textForKind(line, tokens, "type")).toEqual([
      "string",
      "Promise",
      "User"
    ]);
    expect(textForKind(line, tokens, "string")).toEqual([
      '"class 42"'
    ]);
    expect(textForKind(line, tokens, "comment")).toEqual([
      "// note"
    ]);
    expect(textForKind(line, tokens, "number")).toEqual([]);
  });

  it("keeps block comments and template strings stateful across lines", () => {
    const lines = [
      "/* export class",
      "still a comment */ const count = 42;",
      "const message = `return",
      "still a string`;"
    ];
    const tokens = tokenizeSourceLines(
      lines,
      "javascript",
      "src/example.js"
    );

    expect(textForKind(lines[0] ?? "", tokens[0], "comment")).toEqual([
      "/* export class"
    ]);
    expect(textForKind(lines[1] ?? "", tokens[1], "comment")).toEqual([
      "still a comment */"
    ]);
    expect(textForKind(lines[1] ?? "", tokens[1], "keyword")).toEqual([
      "const"
    ]);
    expect(textForKind(lines[1] ?? "", tokens[1], "number")).toEqual([
      "42"
    ]);
    expect(textForKind(lines[2] ?? "", tokens[2], "string")).toEqual([
      "`return"
    ]);
    expect(textForKind(lines[3] ?? "", tokens[3], "string")).toEqual([
      "still a string`"
    ]);
  });

  it("highlights Java annotations, types, methods, and literals", () => {
    const line =
      "@Transactional(readOnly = true) public UserDto findById(String id) { return null; }";
    const [tokens] = tokenizeSourceLines(
      [line],
      "java",
      "src/UserService.java"
    );

    expect(
      textForKind(line, tokens, "annotation")
    ).toEqual(["@Transactional"]);
    expect(textForKind(line, tokens, "keyword")).toEqual([
      "public",
      "return"
    ]);
    expect(textForKind(line, tokens, "type")).toEqual([
      "UserDto",
      "String"
    ]);
    expect(textForKind(line, tokens, "function")).toEqual([
      "findById"
    ]);
    expect(textForKind(line, tokens, "literal")).toEqual([
      "true",
      "null"
    ]);
  });

  it("highlights Vue tags and attributes while preserving valid ranges", () => {
    const line =
      '<UserCard :user="user" @click="openUser">Profile</UserCard>';
    const [lineTokens = []] = tokenizeSourceLines(
      [line],
      "vue",
      "src/UserCard.vue"
    );

    expect(textForKind(line, lineTokens, "tag")).toEqual([
      "UserCard",
      "UserCard"
    ]);
    expect(textForKind(line, lineTokens, "property")).toEqual([
      ":user",
      "@click"
    ]);
    expect(textForKind(line, lineTokens, "string")).toEqual([
      '"user"',
      '"openUser"'
    ]);
    expect(lineTokens).toEqual(
      [...lineTokens].sort((left, right) => left.start - right.start)
    );
    for (
      let index = 1;
      index < lineTokens.length;
      index += 1
    ) {
      expect(lineTokens[index - 1]!.end).toBeLessThanOrEqual(
        lineTokens[index]!.start
      );
    }
  });
});

function textForKind(
  line: string,
  tokens:
    | readonly {
        start: number;
        end: number;
        kind: SourceSyntaxTokenKind;
      }[]
    | undefined,
  kind: SourceSyntaxTokenKind
): string[] {
  return (tokens ?? [])
    .filter((token) => token.kind === kind)
    .map((token) => line.slice(token.start, token.end));
}

import { describe, expect, it } from "vitest";

import {
  createCommitArguments,
  stageArguments,
  unstageArguments
} from "./write-repository";

describe("repository write commands", () => {
  it("uses literal pathspecs and an explicit boundary for stage", () => {
    expect(
      stageArguments(["-leading.txt", "src/入口.ts"])
    ).toEqual([
      "--literal-pathspecs",
      "add",
      "--",
      "-leading.txt",
      "src/入口.ts"
    ]);
  });

  it("uses restore for normal repositories and cached rm for unborn repositories", () => {
    expect(unstageArguments(["file.txt"], true)).toEqual([
      "--literal-pathspecs",
      "restore",
      "--staged",
      "--",
      "file.txt"
    ]);
    expect(unstageArguments(["file.txt"], false)).toEqual([
      "--literal-pathspecs",
      "rm",
      "--cached",
      "--ignore-unmatch",
      "--",
      "file.txt"
    ]);
  });

  it("passes commit messages as values and keeps hooks enabled", () => {
    const args = createCommitArguments(
      "-safe subject",
      "Body line"
    );

    expect(args).toEqual([
      "commit",
      "--message",
      "-safe subject",
      "--message",
      "Body line"
    ]);
    expect(args).not.toContain("--no-verify");
  });
});

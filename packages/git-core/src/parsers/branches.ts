import type { Branch } from "../domain/repository";
import { GitError } from "../errors/git-errors";

const RECORD_SEPARATOR = "\x1e";
const FIELD_SEPARATOR = "\x1f";

export function parseBranches(output: string): Branch[] {
  return output
    .split(RECORD_SEPARATOR)
    .map((record) => record.replace(/^[\r\n]+|[\r\n]+$/g, ""))
    .filter(Boolean)
    .map((record) => {
      const fields = record.split(FIELD_SEPARATOR);

      if (fields.length < 6) {
        throw new GitError(
          "INVALID_GIT_OUTPUT",
          "A branch record does not contain all required fields."
        );
      }

      const [
        fullName = "",
        name = "",
        head = "",
        upstream = "",
        current = "",
        worktreePath = ""
      ] = fields;
      const remote = fullName.startsWith("refs/remotes/");

      return {
        fullName,
        name,
        head,
        ...(upstream ? { upstream } : {}),
        current: current === "*",
        remote,
        ...(worktreePath ? { worktreePath } : {})
      };
    })
    .filter(
      (branch) =>
        !(branch.remote && branch.fullName.endsWith("/HEAD"))
    );
}

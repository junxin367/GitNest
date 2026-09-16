import { useCallback, useState } from "react";

interface RepositoryCommitDraft {
  message: string;
  pushAfterCommit: boolean;
}

export interface RepositoryCommitDraftController
  extends RepositoryCommitDraft {
  setMessage(message: string): void;
  setMessageForScope(scopeKey: string, message: string): void;
  setPushAfterCommit(pushAfterCommit: boolean): void;
}

const EMPTY_DRAFT: RepositoryCommitDraft = {
  message: "",
  pushAfterCommit: false
};

export function useRepositoryCommitDraft(
  scopeKey: string
): RepositoryCommitDraftController {
  const [drafts, setDrafts] = useState<
    ReadonlyMap<string, RepositoryCommitDraft>
  >(() => new Map());
  const draft = drafts.get(scopeKey) ?? EMPTY_DRAFT;

  const updateDraft = useCallback(
    (
      targetScopeKey: string,
      update: (
        current: RepositoryCommitDraft
      ) => RepositoryCommitDraft
    ) => {
      if (!targetScopeKey) {
        return;
      }

      setDrafts((current) => {
        const previous =
          current.get(targetScopeKey) ?? EMPTY_DRAFT;
        const nextDraft = update(previous);
        if (
          previous.message === nextDraft.message &&
          previous.pushAfterCommit ===
            nextDraft.pushAfterCommit
        ) {
          return current;
        }

        const next = new Map(current);
        if (
          !nextDraft.message &&
          !nextDraft.pushAfterCommit
        ) {
          next.delete(targetScopeKey);
        } else {
          next.set(targetScopeKey, nextDraft);
        }
        return next;
      });
    },
    []
  );

  const setMessageForScope = useCallback(
    (targetScopeKey: string, message: string) => {
      updateDraft(targetScopeKey, (current) => ({
        ...current,
        message
      }));
    },
    [updateDraft]
  );

  const setMessage = useCallback(
    (message: string) => {
      setMessageForScope(scopeKey, message);
    },
    [scopeKey, setMessageForScope]
  );

  const setPushAfterCommit = useCallback(
    (pushAfterCommit: boolean) => {
      updateDraft(scopeKey, (current) => ({
        ...current,
        pushAfterCommit
      }));
    },
    [scopeKey, updateDraft]
  );

  return {
    message: draft.message,
    pushAfterCommit: draft.pushAfterCommit,
    setMessage,
    setMessageForScope,
    setPushAfterCommit
  };
}

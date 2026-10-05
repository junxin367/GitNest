import {
  useEffect,
  useState
} from "react";

import type {
  CodeAnalysisFileDto,
  CodeGraphNodeDto,
  GitReadErrorDto
} from "@gitnest/contracts";

export interface CodeNodeSourceState {
  file: CodeAnalysisFileDto | null;
  loading: boolean;
  error: GitReadErrorDto | null;
}

const EMPTY_STATE: CodeNodeSourceState = {
  file: null,
  loading: false,
  error: null
};

export function useCodeNodeSource(
  node: CodeGraphNodeDto | null
): CodeNodeSourceState {
  const [state, setScopedState] = useState({
    nodeKey: "",
    value: EMPTY_STATE
  });
  const nodeId = node?.id ?? "";
  const nodeKey = node
    ? JSON.stringify([
        node.id,
        node.location.repositoryId,
        node.location.worktreeId,
        node.location.path,
        node.location.line
      ])
    : "";

  useEffect(() => {
    const setState = (value: CodeNodeSourceState) =>
      setScopedState({ nodeKey, value });
    if (!nodeId) {
      setState(EMPTY_STATE);
      return;
    }

    let disposed = false;
    setState({
      file: null,
      loading: true,
      error: null
    });

    void window.gitnest.codeAnalysis
      .readFile({ nodeId })
      .then((result) => {
        if (disposed) {
          return;
        }
        if (result.ok) {
          setState({
            file: result.value,
            loading: false,
            error: null
          });
          return;
        }
        setState({
          file: null,
          loading: false,
          error: result.error
        });
      })
      .catch((reason: unknown) => {
        if (disposed) {
          return;
        }
        setState({
          file: null,
          loading: false,
          error: {
            code: "COMMAND_FAILED",
            message:
              reason instanceof Error
                ? reason.message
                : "无法读取节点对应的代码。",
            details: {}
          }
        });
      });

    return () => {
      disposed = true;
    };
  }, [nodeId, nodeKey]);

  return state.nodeKey === nodeKey
    ? state.value
    : { ...EMPTY_STATE, loading: Boolean(nodeId) };
}

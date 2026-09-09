import type { ChangedPathDto } from "@gitnest/contracts";

export interface ChangeTreeNode {
  name: string;
  path: string;
  directory: boolean;
  change?: ChangedPathDto;
  children: ChangeTreeNode[];
}

export function buildChangeTree(
  changes: readonly ChangedPathDto[]
): ChangeTreeNode[] {
  const root: ChangeTreeNode = {
    name: "",
    path: "",
    directory: true,
    children: []
  };

  for (const change of changes) {
    const segments = normalizeChangePath(change.path);
    let parent = root;

    segments.forEach((segment, index) => {
      const directory = index < segments.length - 1;
      const path = directory
        ? `${parent.path}/${segment}`.replace(/^\/+/, "")
        : change.path;
      const existing = parent.children.find(
        (node) =>
          node.name === segment &&
          node.directory === directory
      );
      const node =
        existing ??
        ({
          name: segment,
          path,
          directory,
          children: []
        } satisfies ChangeTreeNode);

      if (!existing) {
        parent.children.push(node);
      }

      if (directory) {
        parent = node;
      } else {
        node.change = change;
      }
    });
  }

  return sortChangeTreeNodes(root.children);
}

export function compactChangeTreeNodes(
  nodes: readonly ChangeTreeNode[]
): ChangeTreeNode[] {
  return nodes.map((node) => {
    if (!node.directory) {
      return node;
    }

    let terminal = node;
    const names = [node.name];

    while (
      terminal.children.length === 1 &&
      terminal.children[0]?.directory
    ) {
      terminal = terminal.children[0];
      names.push(terminal.name);
    }

    return {
      ...terminal,
      name: names.join(" \\ "),
      children: compactChangeTreeNodes(terminal.children)
    };
  });
}

export function changeTreeDirectoryPaths(
  path: string
): string[] {
  const segments = normalizeChangePath(path);
  const paths: string[] = [];
  let current = "";

  for (const segment of segments.slice(0, -1)) {
    current = current ? `${current}/${segment}` : segment;
    paths.push(current);
  }

  return paths;
}

function sortChangeTreeNodes(
  nodes: readonly ChangeTreeNode[]
): ChangeTreeNode[] {
  return [...nodes]
    .sort((left, right) => {
      if (left.directory !== right.directory) {
        return left.directory ? -1 : 1;
      }
      return left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: "base"
      });
    })
    .map((node) => ({
      ...node,
      children: sortChangeTreeNodes(node.children)
    }));
}

function normalizeChangePath(path: string): string[] {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);
}

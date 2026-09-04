import { WorkspaceError } from "@gitnest/workspace-core";
import { AtomicJsonStore } from "@gitnest/persistence-json";

export const WINDOW_STATE_SCHEMA_VERSION = 1;
export const MIN_WINDOW_WIDTH = 1_100;
export const MIN_WINDOW_HEIGHT = 720;

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PersistedWindowState {
  bounds: WindowBounds;
  maximized: boolean;
}

export interface DisplayWorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface WindowStateDocument {
  schemaVersion: typeof WINDOW_STATE_SCHEMA_VERSION;
  bounds: WindowBounds;
  maximized: boolean;
  updatedAt: string;
}

export class JsonWindowStateStore {
  readonly #store: AtomicJsonStore;
  readonly #clock: () => string;

  constructor(
    filePath: string,
    clock: () => string = () => new Date().toISOString()
  ) {
    this.#store = new AtomicJsonStore(filePath);
    this.#clock = clock;
  }

  async load(): Promise<PersistedWindowState | null> {
    const value = await this.#store.read();
    if (value === null) {
      return null;
    }
    const migrated = migrateWindowStateDocument(value);
    if (!isWindowStateDocument(migrated)) {
      this.#store.blockWrites(
        "Window state schema validation or migration failed."
      );
      throw new WorkspaceError(
        "INVALID_PERSISTED_DATA",
        "The persisted window state is invalid."
      );
    }
    const state = {
      bounds: { ...migrated.bounds },
      maximized: migrated.maximized
    };
    if (
      readSchemaVersion(value) !== migrated.schemaVersion
    ) {
      await this.#store.write({
        schemaVersion: WINDOW_STATE_SCHEMA_VERSION,
        bounds: state.bounds,
        maximized: state.maximized,
        updatedAt: migrated.updatedAt
      });
    }
    return state;
  }

  save(state: PersistedWindowState): Promise<void> {
    const normalized = validateWindowState(state);
    return this.#store.write({
      schemaVersion: WINDOW_STATE_SCHEMA_VERSION,
      bounds: normalized.bounds,
      maximized: normalized.maximized,
      updatedAt: this.#clock()
    });
  }
}

export function clampWindowState(
  state: PersistedWindowState,
  displays: readonly DisplayWorkArea[],
  primaryDisplay: DisplayWorkArea
): PersistedWindowState {
  const validated = validateWindowState(state);
  const candidates =
    displays.length > 0 ? [...displays] : [primaryDisplay];
  const selected =
    candidates
      .map((display) => ({
        display,
        overlap: intersectionArea(
          validated.bounds,
          display
        )
      }))
      .sort(
        (left, right) => right.overlap - left.overlap
      )[0];
  const workArea =
    selected && selected.overlap > 0
      ? selected.display
      : primaryDisplay;
  const minimumWidth = Math.min(
    MIN_WINDOW_WIDTH,
    workArea.width
  );
  const minimumHeight = Math.min(
    MIN_WINDOW_HEIGHT,
    workArea.height
  );
  const width = clamp(
    validated.bounds.width,
    minimumWidth,
    workArea.width
  );
  const height = clamp(
    validated.bounds.height,
    minimumHeight,
    workArea.height
  );
  const x = clamp(
    validated.bounds.x,
    workArea.x,
    workArea.x + workArea.width - width
  );
  const y = clamp(
    validated.bounds.y,
    workArea.y,
    workArea.y + workArea.height - height
  );
  return {
    bounds: { x, y, width, height },
    maximized: validated.maximized
  };
}

function migrateWindowStateDocument(
  value: unknown
): unknown {
  if (!isRecord(value) || value.schemaVersion !== 0) {
    return value;
  }
  return {
    schemaVersion: WINDOW_STATE_SCHEMA_VERSION,
    bounds: {
      x: value.x,
      y: value.y,
      width: value.width,
      height: value.height
    },
    maximized:
      typeof value.maximized === "boolean"
        ? value.maximized
        : value.isMaximized,
    updatedAt:
      typeof value.updatedAt === "string"
        ? value.updatedAt
        : new Date(0).toISOString()
  };
}

function isWindowStateDocument(
  value: unknown
): value is WindowStateDocument {
  return (
    isRecord(value) &&
    value.schemaVersion === WINDOW_STATE_SCHEMA_VERSION &&
    isWindowBounds(value.bounds) &&
    typeof value.maximized === "boolean" &&
    typeof value.updatedAt === "string"
  );
}

function validateWindowState(
  state: PersistedWindowState
): PersistedWindowState {
  if (
    !state ||
    !isWindowBounds(state.bounds) ||
    typeof state.maximized !== "boolean"
  ) {
    throw new WorkspaceError(
      "INVALID_PERSISTED_DATA",
      "Window state bounds are invalid."
    );
  }
  return {
    bounds: { ...state.bounds },
    maximized: state.maximized
  };
}

function isWindowBounds(value: unknown): value is WindowBounds {
  return (
    isRecord(value) &&
    isFiniteInteger(value.x) &&
    isFiniteInteger(value.y) &&
    isFiniteInteger(value.width) &&
    value.width > 0 &&
    value.width <= 32_768 &&
    isFiniteInteger(value.height) &&
    value.height > 0 &&
    value.height <= 32_768
  );
}

function isFiniteInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value)
  );
}

function intersectionArea(
  left: WindowBounds,
  right: DisplayWorkArea
): number {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) -
      Math.max(left.x, right.x)
  );
  const height = Math.max(
    0,
    Math.min(
      left.y + left.height,
      right.y + right.height
    ) - Math.max(left.y, right.y)
  );
  return width * height;
}

function clamp(
  value: number,
  minimum: number,
  maximum: number
): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function readSchemaVersion(value: unknown): unknown {
  return isRecord(value) ? value.schemaVersion : undefined;
}

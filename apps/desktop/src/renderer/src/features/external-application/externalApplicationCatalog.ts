import type {
  ExternalApplicationProfileDto,
  GitNestBridge,
  GitReadErrorDto
} from "@gitnest/contracts";

interface CatalogState {
  profiles: ExternalApplicationProfileDto[] | null;
  loading: boolean;
  error: GitReadErrorDto | null;
}

// Discovery describes this machine, not a repository. Share it across renderer
// entry points while keeping launch contexts and their errors in each controller.
const catalogs = new WeakMap<GitNestBridge["system"], ReturnType<typeof createCatalog>>();

export function getExternalApplicationCatalog(system: GitNestBridge["system"]) {
  let catalog = catalogs.get(system);
  if (!catalog) {
    catalog = createCatalog(system);
    catalogs.set(system, catalog);
  }
  return catalog;
}

function createCatalog(system: GitNestBridge["system"]) {
  let state: CatalogState = { profiles: null, loading: false, error: null };
  let sequence = 0;
  let loadedAt = -Infinity;
  let pending: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: CatalogState) => {
    state = next;
    listeners.forEach(listener => listener());
  };
  const reload = () => {
    const request = ++sequence;
    publish({ ...state, loading: true, error: null });
    const work = (async () => {
      try {
        const result = await system.listExternalApplications();
        if (request !== sequence) return;
        if (result.ok) loadedAt = performance.now();
        publish(result.ok
          ? { profiles: result.value, loading: false, error: null }
          : { ...state, loading: false, error: result.error });
      } catch (reason) {
        if (request !== sequence) return;
        publish({
          ...state,
          loading: false,
          error: {
            code: "COMMAND_FAILED",
            message: reason instanceof Error ? reason.message : "本地应用检测失败。",
            details: {}
          }
        });
      }
    })();
    pending = work;
    void work.finally(() => {
      if (request === sequence) pending = null;
    });
    return work;
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    ensureLoaded: () => pending ?? (
      state.profiles !== null && performance.now() - loadedAt < 30_000
        ? Promise.resolve()
        : reload()
    ),
    reload,
    clearError: () => {
      if (state.error) publish({ ...state, error: null });
    }
  };
}

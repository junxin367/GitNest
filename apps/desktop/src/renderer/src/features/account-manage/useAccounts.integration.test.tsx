/** @vitest-environment jsdom */

import { act } from "react";
import {
  createRoot,
  type Root
} from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

import type {
  AccountProfileDto,
  AccountOverviewDto,
  GitNestBridge,
  SaveAccountRequest
} from "@gitnest/contracts";

import {
  useAccounts,
  type AccountController
} from "./useAccounts";

const TOKEN = "renderer-ephemeral-token-测试";

describe("useAccounts", () => {
  let container: HTMLDivElement;
  let root: Root;
  let controller: AccountController | undefined;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("forwards a token only to save and never keeps it in account state", async () => {
    let overview: AccountOverviewDto = {
      accounts: [],
      bindings: []
    };
    const list = vi.fn(async () => ({
      ok: true as const,
      value: structuredClone(overview)
    }));
    const savedAccount: AccountProfileDto = {
      id: "account_1",
      provider: "github",
      host: "github.example.test",
      username: "user",
      authType: "https-token",
      hasCredential: true,
      verificationStatus: "untested"
    };
    const save = vi.fn(async (_request: SaveAccountRequest) => {
      overview = {
        accounts: [savedAccount],
        bindings: [
          {
            host: "github.example.test",
            accountId: "account_1"
          }
        ]
      };
      return {
        ok: true as const,
        value: savedAccount
      };
    });
    installAccountBridge({ list, save });
    await renderHarness();

    let saved = false;
    await act(async () => {
      saved =
        (await controller?.save({
          provider: "github",
          host: "github.example.test",
          username: "user",
          authType: "https-token",
          token: TOKEN,
          makeHostDefault: true
        })) ?? false;
    });

    expect(saved).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      token: TOKEN
    });
    expect(JSON.stringify(controller)).not.toContain(TOKEN);
    expect(JSON.stringify(controller)).not.toContain(
      "credentialRef"
    );
    expect(controller?.overview).toEqual(overview);
  });

  it("loads a removal impact before sending confirmed deletion", async () => {
    const overview: AccountOverviewDto = {
      accounts: [
        {
          id: "account_1",
          provider: "custom",
          host: "git.example.test",
          authType: "system-ssh",
          hasCredential: false,
          verificationStatus: "untested"
        }
      ],
      bindings: []
    };
    const list = vi.fn(async () => ({
      ok: true as const,
      value: overview
    }));
    const getRemovalImpact = vi.fn(async () => ({
      ok: true as const,
      value: {
        accountId: "account_1",
        host: "git.example.test",
        repositoryIds: ["repository_1"],
        hostDefault: true
      }
    }));
    const remove = vi.fn(async () => ({
      ok: true as const,
      value: {
        accountId: "account_1",
        host: "git.example.test",
        repositoryIds: ["repository_1"],
        hostDefault: true
      }
    }));
    installAccountBridge({
      list,
      getRemovalImpact,
      remove
    });
    await renderHarness();

    await act(async () => {
      await controller?.requestRemoval("account_1");
    });
    expect(remove).not.toHaveBeenCalled();
    expect(controller?.removalImpact).toMatchObject({
      repositoryIds: ["repository_1"],
      hostDefault: true
    });

    await act(async () => {
      await controller?.confirmRemoval();
    });
    expect(remove).toHaveBeenCalledWith({
      accountId: "account_1",
      confirmed: true
    });
  });

  async function renderHarness(): Promise<void> {
    await act(async () => {
      root.render(
        <Harness
          onController={(value) => {
            controller = value;
          }}
        />
      );
    });
  }
});

function Harness({
  onController
}: {
  onController(value: AccountController): void;
}) {
  onController(useAccounts());
  return null;
}

function installAccountBridge(
  account: Partial<GitNestBridge["account"]>
): void {
  Object.defineProperty(window, "gitnest", {
    configurable: true,
    value: {
      account
    } as unknown as GitNestBridge
  });
}

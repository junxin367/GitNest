import { describe, expect, it } from "vitest";

import { LANGUAGE_SERVER_LANGUAGES } from "@gitnest/contracts";

import { installedLanguageServerSettingsPatch } from "./language-server-settings";

describe("installedLanguageServerSettingsPatch", () => {
  it("updates only the installed language", () => {
    for (const language of LANGUAGE_SERVER_LANGUAGES) {
      expect(
        installedLanguageServerSettingsPatch(
          language,
          `${language}-server`,
          ["--stdio"]
        )
      ).toEqual({
        [language]: {
          enabled: true,
          command: `${language}-server`,
          args: ["--stdio"]
        }
      });
    }
  });
});

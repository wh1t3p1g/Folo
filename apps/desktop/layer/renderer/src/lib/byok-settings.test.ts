import type { UserByokSettings } from "@follow/shared/settings/interface"
import { describe, expect, test } from "vitest"

import { canUseSummaryWithByok, hasByokModeEnabled } from "./byok-settings"

const createByokSettings = (
  apiKey: string | null | undefined,
  enabled = true,
): UserByokSettings => ({
  enabled,
  providers: [
    {
      provider: "openai",
      apiKey,
    },
  ],
})

describe("canUseSummaryWithByok", () => {
  test("allows summary when server AI is disabled but BYOK has a usable local key", () => {
    expect(
      canUseSummaryWithByok({
        aiEnabled: false,
        byok: createByokSettings("sk-local"),
      }),
    ).toBe(true)
  })

  test("does not treat server-encrypted BYOK keys as usable", () => {
    expect(
      canUseSummaryWithByok({
        aiEnabled: false,
        byok: createByokSettings("encrypt__stored-on-server"),
      }),
    ).toBe(false)
  })

  test("keeps server AI eligibility when BYOK is unavailable", () => {
    expect(
      canUseSummaryWithByok({
        aiEnabled: true,
        byok: createByokSettings(null, false),
      }),
    ).toBe(true)
  })
})

describe("hasByokModeEnabled", () => {
  test("treats encrypted-key BYOK settings as BYOK mode enabled", () => {
    expect(hasByokModeEnabled(createByokSettings("encrypt__stored-on-server"))).toBe(true)
  })
})

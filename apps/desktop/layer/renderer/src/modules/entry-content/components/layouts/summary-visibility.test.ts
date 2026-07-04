import { describe, expect, test } from "vitest"

import { AIChatPanelStyle } from "~/atoms/settings/ai"

import { shouldRenderAISummary } from "./summary-visibility"

describe("shouldRenderAISummary", () => {
  test("keeps BYOK summary mounted when the fixed AI panel is visible", () => {
    expect(
      shouldRenderAISummary({
        aiChatPanelStyle: AIChatPanelStyle.Fixed,
        byokEnabled: true,
        isAIPanelVisible: true,
      }),
    ).toBe(true)
  })

  test("preserves the previous server AI panel visibility rule", () => {
    expect(
      shouldRenderAISummary({
        aiChatPanelStyle: AIChatPanelStyle.Fixed,
        byokEnabled: false,
        isAIPanelVisible: true,
      }),
    ).toBe(false)
  })
})

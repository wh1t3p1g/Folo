import { describe, expect, test } from "vitest"

import { resolveSummarySourceContent, shouldEnableSummaryQuery } from "./useByokSummary"

describe("resolveSummarySourceContent", () => {
  test("falls back to normal entry content when readability content is not available for BYOK", () => {
    expect(
      resolveSummarySourceContent({
        target: "readabilityContent",
        entryContent: {
          content: "stored content",
          readabilityContent: null,
        },
        entryDetail: {
          content: "detail content",
          readabilityContent: null,
        },
      }),
    ).toBe("stored content")
  })

  test("uses entry detail content when the entry store has not loaded content yet", () => {
    expect(
      resolveSummarySourceContent({
        target: "content",
        entryContent: null,
        entryDetail: {
          content: "detail content",
          readabilityContent: null,
        },
      }),
    ).toBe("detail content")
  })
})

describe("shouldEnableSummaryQuery", () => {
  test("enables server summary without local content but keeps BYOK waiting for content", () => {
    expect(
      shouldEnableSummaryQuery({
        enabled: true,
        byokModeEnabled: true,
        content: null,
      }),
    ).toBe(false)

    expect(
      shouldEnableSummaryQuery({
        enabled: true,
        byokModeEnabled: false,
        content: null,
      }),
    ).toBe(true)
  })

  test("keeps BYOK mode from falling back to server summary even when the local key is unusable", () => {
    expect(
      shouldEnableSummaryQuery({
        enabled: true,
        byokModeEnabled: true,
        content: "entry content",
      }),
    ).toBe(true)
  })
})

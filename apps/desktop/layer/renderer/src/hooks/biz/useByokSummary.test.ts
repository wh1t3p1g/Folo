import { describe, expect, test } from "vitest"

import {
  getSummaryQueryIdentity,
  requireSummaryContent,
  resolveSummarySourceContent,
  shouldEnableSummaryQuery,
} from "./useByokSummary"

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

  test("does not treat an empty content field as a usable source", () => {
    expect(
      resolveSummarySourceContent({
        target: "content",
        entryContent: { content: "", readabilityContent: "readable source" },
        entryDetail: null,
      }),
    ).toBe("readable source")
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

describe("getSummaryQueryIdentity", () => {
  test("changes when the source or BYOK configuration changes", () => {
    const base = {
      target: "content" as const,
      language: "en" as const,
      byokModeEnabled: true,
      byokEnabled: true,
    }
    expect(getSummaryQueryIdentity({ ...base, content: "one", providerIdentity: "a" })).not.toBe(
      getSummaryQueryIdentity({ ...base, content: "two", providerIdentity: "a" }),
    )
    expect(getSummaryQueryIdentity({ ...base, content: "one", providerIdentity: "a" })).not.toBe(
      getSummaryQueryIdentity({ ...base, content: "one", providerIdentity: "b" }),
    )
  })
})

describe("requireSummaryContent", () => {
  test("turns an empty server response into a retryable error", () => {
    expect(() => requireSummaryContent("", "server")).toThrow("SUMMARY_EMPTY_RESPONSE")
    expect(requireSummaryContent("  useful summary  ", "server")).toBe("useful summary")
  })
})

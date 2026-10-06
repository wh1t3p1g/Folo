import { describe, expect, test } from "vitest"

import {
  getSummaryOutputTokenBudget,
  normalizeSummaryContent,
  shouldRetrySummaryCompletion,
} from "./byok-ai"

describe("BYOK summary input", () => {
  test("removes markup while preserving readable paragraph boundaries", () => {
    expect(normalizeSummaryContent("<h1>Title</h1><p>First <b>fact</b>.</p><p>Second.</p>")).toBe(
      "Title\nFirst fact.\nSecond.",
    )
  })

  test("keeps both the beginning and end of long articles", () => {
    const content = normalizeSummaryContent(`${"Beginning ".repeat(4000)}END_OF_ARTICLE`)

    expect(content).toContain("Beginning")
    expect(content).toContain("END_OF_ARTICLE")
  })

  test("allocates more output space for longer source content", () => {
    expect(getSummaryOutputTokenBudget(500)).toBeLessThan(getSummaryOutputTokenBudget(12000))
    expect(getSummaryOutputTokenBudget(12000)).toBeLessThanOrEqual(2200)
  })
})

describe("BYOK summary completion", () => {
  test("retries a provider response that was cut off by the output limit", () => {
    expect(shouldRetrySummaryCompletion("length", 1200)).toBe(true)
    expect(shouldRetrySummaryCompletion("MAX_TOKENS", 1200)).toBe(true)
    expect(shouldRetrySummaryCompletion("stop", 1200)).toBe(false)
    expect(shouldRetrySummaryCompletion("length", 2200)).toBe(false)
  })
})

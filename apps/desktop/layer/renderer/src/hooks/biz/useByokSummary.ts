/**
 * Custom hook for generating AI summaries with BYOK support
 *
 * This hook checks if BYOK is enabled and uses the user's own API key
 * to generate summaries directly, bypassing the Folo server.
 */

import type { SupportedActionLanguage } from "@follow/shared"
import { toApiSupportedActionLanguage } from "@follow/shared"
import { useEntry, usePrefetchEntryDetail } from "@follow/store/entry/hooks"
import { summaryActions } from "@follow/store/summary/store"
import type { SupportedLanguages } from "@follow-app/client-sdk"
import { useQuery } from "@tanstack/react-query"

import { generateSummaryWithByok, getByokSummaryCacheIdentity } from "~/lib/byok-ai"
import { getByokProvider, useIsByokEnabled, useIsByokModeEnabled } from "~/lib/byok-settings"

import { followApi } from "../../lib/api-client"

interface UsePrefetchSummaryByokOptions {
  entryId: string
  target: "content" | "readabilityContent"
  actionLanguage: SupportedLanguages
  enabled?: boolean
}

type SummaryTarget = UsePrefetchSummaryByokOptions["target"]

interface SummaryContentSource {
  content?: string | null
  readabilityContent?: string | null
}

export const resolveSummarySourceContent = ({
  target,
  entryContent,
  entryDetail,
}: {
  target: SummaryTarget
  entryContent?: SummaryContentSource | null
  entryDetail?: SummaryContentSource | null
}) => {
  const firstNonEmpty = (...values: Array<string | null | undefined>) =>
    values.find((value) => !!value?.trim()) ?? null
  const content = firstNonEmpty(entryContent?.content, entryDetail?.content)
  const readabilityContent = firstNonEmpty(
    entryContent?.readabilityContent,
    entryDetail?.readabilityContent,
  )

  return target === "readabilityContent"
    ? (readabilityContent ?? content)
    : (content ?? readabilityContent)
}

export const shouldEnableSummaryQuery = ({
  enabled,
  byokModeEnabled,
  content,
}: {
  enabled: boolean
  byokModeEnabled: boolean
  content?: string | null
}) => enabled && (!!content?.trim() || !byokModeEnabled)

export function requireSummaryContent(
  summary: string | null | undefined,
  source: "server" | "byok",
): string {
  const normalized = summary?.trim()
  if (!normalized) {
    throw new Error(source === "server" ? "SUMMARY_EMPTY_RESPONSE" : "BYOK_SUMMARY_EMPTY")
  }
  return normalized
}

export function getSummaryQueryIdentity({
  content,
  target,
  language,
  byokModeEnabled,
  byokEnabled,
  providerIdentity,
}: {
  content?: string | null
  target: SummaryTarget
  language: string
  byokModeEnabled: boolean
  byokEnabled: boolean
  providerIdentity: string
}): string {
  const value = [
    "summary-v2",
    target,
    language,
    byokModeEnabled,
    byokEnabled,
    providerIdentity,
    content ?? "",
  ].join("\u0000")
  let hash = 2166136261
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

/**
 * Custom usePrefetchSummary hook that supports BYOK
 *
 * When BYOK is enabled, it generates summaries using the user's own API key.
 * Otherwise, it falls back to the Folo server API.
 */
export function usePrefetchSummaryByok({
  entryId,
  target,
  actionLanguage,
  enabled = true,
}: UsePrefetchSummaryByokOptions) {
  // Convert to SupportedActionLanguage type for store compatibility
  const storeLanguage = actionLanguage as SupportedActionLanguage

  // Get entry content from store
  const entryContent = useEntry(entryId, (state) => ({
    content: state.content,
    readabilityContent: state.readabilityContent,
    title: state.title,
  }))

  // Prefetch entry detail to ensure content is loaded
  const { data: entryDetail, isFetched: isEntryDetailFetched } = usePrefetchEntryDetail(entryId)

  // The actual content to use for summary
  const content = resolveSummarySourceContent({
    target,
    entryContent,
    entryDetail,
  })

  // Only enable query when we have content (for BYOK) or always for server API
  const byokModeEnabled = useIsByokModeEnabled()
  const byokEnabled = useIsByokEnabled()
  const byokProvider = getByokProvider()
  const providerIdentity =
    byokModeEnabled && byokProvider
      ? getByokSummaryCacheIdentity({
          content: content ?? "",
          language: actionLanguage,
          title: entryContent?.title ?? entryDetail?.title ?? undefined,
          provider: byokProvider,
        })
      : "server"
  const queryIdentity = getSummaryQueryIdentity({
    content,
    target,
    language: actionLanguage,
    byokModeEnabled,
    byokEnabled,
    providerIdentity,
  })
  const shouldEnable =
    shouldEnableSummaryQuery({ enabled, byokModeEnabled, content }) ||
    (enabled && byokModeEnabled && !isEntryDetailFetched)

  // // Debug logging
  // console.log("[BYOK Summary Debug]", {
  //   entryId,
  //   target,
  //   enabled,
  //   byokEnabled,
  //   hasContent,
  //   shouldEnable,
  //   isLoadingDetail,
  //   contentLength: content?.length ?? 0,
  //   entryContentExists: !!entryContent,
  //   entryDetailExists: !!entryDetail,
  // })

  return useQuery({
    queryKey: ["summary", entryId, target, actionLanguage, "byok", queryIdentity],
    queryFn: async () => {
      // console.log("[BYOK Summary] queryFn called", {
      //   entryId,
      //   byokEnabled,
      //   contentLength: content?.length,
      // })

      // Check if BYOK is enabled
      if (byokModeEnabled) {
        // console.log("[BYOK Summary] Using BYOK mode")
        // Use BYOK to generate summary
        if (!content?.trim()) {
          throw new Error("BYOK_SUMMARY_NO_CONTENT")
        }

        if (!byokEnabled) {
          throw new Error("BYOK_SUMMARY_NO_PROVIDER")
        }

        const summary = await generateSummaryWithByok({
          content,
          language: actionLanguage,
          title: entryContent?.title ?? entryDetail?.title ?? undefined,
        })

        return summary
      } else {
        // console.log("[BYOK Summary] Using server API fallback")
        // Fallback to server API
        const result = await followApi.ai.summary({
          id: entryId,
          language: toApiSupportedActionLanguage(storeLanguage),
          target,
        })
        // console.log("[BYOK Summary] Server API result:", { data: result.data?.substring(0, 50) })

        const summary = requireSummaryContent(result.data, "server")

        summaryActions.upsertMany([
          {
            entryId,
            summary: target === "content" ? summary : "",
            language: storeLanguage,
            readabilitySummary: target === "readabilityContent" ? summary : null,
          },
        ])

        return summary
      }
    },
    enabled: shouldEnable,
    staleTime: 1000 * 60 * 60 * 24,
  })
}

export { SummaryGeneratingStatus } from "@follow/store/summary/enum"
export { useSummary, useSummaryStatus } from "@follow/store/summary/hooks"

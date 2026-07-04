/**
 * Custom hook for generating AI summaries with BYOK support
 *
 * This hook checks if BYOK is enabled and uses the user's own API key
 * to generate summaries directly, bypassing the Folo server.
 */

import type { SupportedActionLanguage } from "@follow/shared"
import { toApiSupportedActionLanguage } from "@follow/shared"
import { useEntry, usePrefetchEntryDetail } from "@follow/store/entry/hooks"
import { summaryActions, useSummaryStore } from "@follow/store/summary/store"
import type { SupportedLanguages } from "@follow-app/client-sdk"
import { useQuery } from "@tanstack/react-query"

import { generateSummaryWithByok } from "~/lib/byok-ai"
import { useIsByokEnabled, useIsByokModeEnabled } from "~/lib/byok-settings"

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
  const content = entryContent?.content ?? entryDetail?.content ?? null
  const readabilityContent =
    entryContent?.readabilityContent ?? entryDetail?.readabilityContent ?? null

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
}) => enabled && (!!content || !byokModeEnabled)

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
  const { data: entryDetail } = usePrefetchEntryDetail(entryId)

  // The actual content to use for summary
  const content = resolveSummarySourceContent({
    target,
    entryContent,
    entryDetail,
  })

  // Only enable query when we have content (for BYOK) or always for server API
  const byokModeEnabled = useIsByokModeEnabled()
  const byokEnabled = useIsByokEnabled()
  const shouldEnable = shouldEnableSummaryQuery({ enabled, byokModeEnabled, content })

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
    queryKey: ["summary", entryId, target, actionLanguage, "byok", byokModeEnabled, byokEnabled],
    queryFn: async () => {
      // console.log("[BYOK Summary] queryFn called", {
      //   entryId,
      //   byokEnabled,
      //   contentLength: content?.length,
      // })

      // Check existing summary first
      const state = useSummaryStore.getState()
      const existing =
        state.data[entryId]?.[storeLanguage]?.[
          target === "content" ? "summary" : "readabilitySummary"
        ]
      if (existing) {
        // console.log("[BYOK Summary] Found existing summary", {
        //   entryId,
        //   existing: existing.substring(0, 50),
        // })
        return existing
      }

      // Check if BYOK is enabled
      if (byokModeEnabled) {
        // console.log("[BYOK Summary] Using BYOK mode")
        // Use BYOK to generate summary
        if (!content) {
          // This shouldn't happen due to shouldEnable check, but just in case
          // console.error("[BYOK Summary] No content available!")
          throw new Error("No content available for summary")
        }

        if (!byokEnabled) {
          throw new Error("BYOK is enabled but no usable local API key is configured")
        }

        const summary = await generateSummaryWithByok({
          content,
          language: actionLanguage,
          title: entryContent?.title ?? entryDetail?.title ?? undefined,
        })

        if (summary) {
          // Save to store
          summaryActions.upsertMany([
            {
              entryId,
              summary: target === "content" ? summary : "",
              language: storeLanguage,
              readabilitySummary: target === "readabilityContent" ? summary : null,
            },
          ])
        }

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

        const summary = result.data || ""

        if (summary) {
          summaryActions.upsertMany([
            {
              entryId,
              summary: target === "content" ? summary : "",
              language: storeLanguage,
              readabilitySummary: target === "readabilityContent" ? summary : null,
            },
          ])
        }

        return summary
      }
    },
    enabled: shouldEnable,
    staleTime: 1000 * 60 * 60 * 24,
  })
}

export { SummaryGeneratingStatus } from "@follow/store/summary/enum"
export { useSummary, useSummaryStatus } from "@follow/store/summary/hooks"

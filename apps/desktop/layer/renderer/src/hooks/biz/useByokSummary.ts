/**
 * Custom hook for generating AI summaries with BYOK support
 *
 * This hook checks if BYOK is enabled and uses the user's own API key
 * to generate summaries directly, bypassing the Folo server.
 */

import type { SupportedActionLanguage } from "@follow/shared"
import { useEntry, usePrefetchEntryDetail } from "@follow/store/entry/hooks"
import { summaryActions, useSummaryStore } from "@follow/store/summary/store"
import type { SupportedLanguages } from "@follow-app/client-sdk"
import { useQuery } from "@tanstack/react-query"

import { generateSummaryWithByok, isByokEnabled } from "~/lib/byok-ai"

import { followApi } from "../../lib/api-client"

interface UsePrefetchSummaryByokOptions {
  entryId: string
  target: "content" | "readabilityContent"
  actionLanguage: SupportedLanguages
  enabled?: boolean
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
  const { data: entryDetail } = usePrefetchEntryDetail(entryId)

  // The actual content to use for summary
  const content =
    target === "readabilityContent"
      ? entryContent?.readabilityContent
      : (entryContent?.content ?? entryDetail?.content)

  // Only enable query when we have content (for BYOK) or always for server API
  const byokEnabled = isByokEnabled()
  const hasContent = !!content
  const shouldEnable = enabled && (hasContent || !byokEnabled)

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
    queryKey: ["summary", entryId, target, actionLanguage, "byok", byokEnabled],
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
      if (byokEnabled) {
        // console.log("[BYOK Summary] Using BYOK mode")
        // Use BYOK to generate summary
        if (!content) {
          // This shouldn't happen due to shouldEnable check, but just in case
          // console.error("[BYOK Summary] No content available!")
          throw new Error("No content available for summary")
        }

        const summary = await generateSummaryWithByok({
          content,
          language: actionLanguage,
          title: entryContent?.title ?? undefined,
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
          language: storeLanguage,
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

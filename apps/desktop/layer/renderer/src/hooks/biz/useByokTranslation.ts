/**
 * Custom hook for generating AI translations with BYOK support
 *
 * This hook checks if BYOK is enabled and uses the user's own API key
 * to generate translations directly, bypassing the Folo server.
 */

import type { SupportedActionLanguage } from "@follow/shared"
import { useEntry, usePrefetchEntryDetail } from "@follow/store/entry/hooks"
import { translationActions, useTranslationStore } from "@follow/store/translation/store"
import type { SupportedLanguages } from "@follow-app/client-sdk"
import { useQuery } from "@tanstack/react-query"
import { useCallback } from "react"

import { generateTranslationWithByok } from "~/lib/byok-ai"
import { isByokEnabled } from "~/lib/byok-settings"

interface UseByokTranslationOptions {
  entryId: string
  language: SupportedLanguages
  enabled: boolean
  withContent?: boolean
  target?: "content" | "readabilityContent"
}

/**
 * Custom hook that provides BYOK-aware translation
 *
 * When BYOK is enabled, it generates translations using the user's own API key.
 * Otherwise, it returns the translation from the store (populated by server API).
 */
export function useByokTranslation({
  entryId,
  language,
  enabled,
  withContent = false,
  target = "content",
}: UseByokTranslationOptions) {
  const storeLanguage = language as SupportedActionLanguage

  // Get entry content from store
  const entryContent = useEntry(entryId, (state) => ({
    title: state.title,
    description: state.description,
    content: state.content,
    readabilityContent: state.readabilityContent,
  }))

  // Prefetch entry detail to ensure content is loaded
  const { data: entryDetail } = usePrefetchEntryDetail(entryId)

  // Get existing translation from store
  const existingTranslation = useTranslationStore(
    useCallback(
      (state) => {
        if (!enabled) return
        return state.data[entryId]?.[storeLanguage]
      },
      [entryId, storeLanguage, enabled],
    ),
  )

  const byokEnabled = isByokEnabled()

  // The actual content to translate
  const contentToTranslate =
    target === "readabilityContent"
      ? entryContent?.readabilityContent
      : (entryContent?.content ?? entryDetail?.content)

  // Only run BYOK query when enabled and content is available
  const shouldFetch = enabled && byokEnabled && !existingTranslation

  const query = useQuery({
    queryKey: ["translation-byok", entryId, language, withContent, target],
    queryFn: async () => {
      // Check if we already have translation
      if (existingTranslation) {
        return existingTranslation
      }

      const title = entryContent?.title || entryDetail?.title
      const description = entryContent?.description || entryDetail?.description

      try {
        const result = await generateTranslationWithByok({
          title,
          description,
          content: withContent ? contentToTranslate : null,
          language,
        })

        // Build the final result with readabilityContent mapped from content based on target
        const finalResult = {
          title: result.title,
          description: result.description,
          content: target === "content" ? result.content : null,
          readabilityContent: target === "readabilityContent" ? result.content : null,
        }

        // Save to store
        await translationActions.upsertMany([
          {
            entryId,
            language: storeLanguage,
            ...finalResult,
          },
        ])

        return finalResult
      } catch (error) {
        console.error("[BYOK Translation] generation failed:", error)
        throw error
      }
    },
    enabled: shouldFetch,
    staleTime: 1000 * 60 * 60 * 24, // 24 hours
  })

  // Return existing translation if available, otherwise query result
  return {
    translation: existingTranslation ?? query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    isByokEnabled: byokEnabled,
  }
}

/**
 * Prefetch translation for multiple entries with BYOK support
 */
export function usePrefetchByokTranslation({
  entryIds,
  language,
  enabled,
  withContent = false,
  target = "content",
}: {
  entryIds: string[]
  language: SupportedLanguages
  enabled: boolean
  withContent?: boolean
  target?: "content" | "readabilityContent"
}) {
  const byokEnabled = isByokEnabled()

  // For BYOK mode, we process entries one by one
  // For simplicity, we'll just use the first entry for now
  // A more complete implementation would batch these
  const firstEntryId = entryIds[0]

  return useByokTranslation({
    entryId: firstEntryId || "",
    language,
    enabled: enabled && !!firstEntryId && byokEnabled,
    withContent,
    target,
  })
}

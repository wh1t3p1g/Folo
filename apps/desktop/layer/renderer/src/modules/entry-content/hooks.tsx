import { isFreeRole } from "@follow/constants"
import { useEntry, usePrefetchEntryDetail } from "@follow/store/entry/hooks"
import { useEntryTranslation, usePrefetchEntryTranslation } from "@follow/store/translation/hooks"
import { useUserRole } from "@follow/store/user/hooks"
import { tracker } from "@follow/tracker"
import { createElement, useCallback, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { useShowAITranslation } from "~/atoms/ai-translation"
import { useEntryIsInReadability, useEntryIsInReadabilitySuccess } from "~/atoms/readability"
import { useActionLanguage } from "~/atoms/settings/general"
import { useModalStack } from "~/components/ui/modal/stacked/hooks"
import { useByokTranslation } from "~/hooks/biz/useByokTranslation"
import { isByokEnabled } from "~/lib/byok-ai"

import { ImageGalleryContent } from "./components/ImageGalleryContent"

export const useGalleryModal = () => {
  const { present } = useModalStack()
  const { t } = useTranslation()
  return useCallback(
    (entryId?: string) => {
      if (!entryId) {
        // this should not happen unless there is a bug in the code
        toast.error("Invalid feed id")
        return
      }
      tracker.entryContentHeaderImageGalleryClick({
        feedId: entryId,
      })
      present({
        title: t("entry_actions.image_gallery"),
        content: () => createElement(ImageGalleryContent, { entryId }),
        max: true,
        clickOutsideToDismiss: true,
      })
    },
    [present, t],
  )
}

export const useEntryContent = (entryId: string) => {
  const entry = useEntry(entryId, (state) => {
    const { inboxHandle, content, readabilityContent } = state
    return { inboxId: inboxHandle, content, readabilityContent }
  })
  const { error, data, isPending } = usePrefetchEntryDetail(entryId)

  const isInReadabilityMode = useEntryIsInReadability(entryId)
  const isReadabilitySuccess = useEntryIsInReadabilitySuccess(entryId)

  const enableTranslation = useShowAITranslation()
  const userRole = useUserRole()
  const actionLanguage = useActionLanguage()
  const target = isReadabilitySuccess ? "readabilityContent" : "content"

  // Check if BYOK is enabled
  const byokEnabled = isByokEnabled()

  // Use BYOK translation if enabled
  const { translation: byokTranslation } = useByokTranslation({
    entryId,
    language: actionLanguage,
    enabled: enableTranslation && byokEnabled,
    withContent: true,
    target,
  })

  // Use server translation if BYOK is not enabled
  const shouldPrefetchTranslation = enableTranslation && !isFreeRole(userRole) && !byokEnabled
  const contentTranslated = useEntryTranslation({
    entryId,
    language: actionLanguage,
    enabled: enableTranslation && !byokEnabled,
  })
  usePrefetchEntryTranslation({
    entryIds: [entryId],
    enabled: shouldPrefetchTranslation,
    language: actionLanguage,
    withContent: true,
    target,
  })

  // Use BYOK translation if available, otherwise fall back to server translation
  const finalTranslation = byokEnabled ? byokTranslation : contentTranslated

  return useMemo(() => {
    const entryContent = isInReadabilityMode
      ? entry?.readabilityContent
      : (entry?.content ?? data?.content)
    const translatedContent = isInReadabilityMode
      ? finalTranslation?.readabilityContent
      : finalTranslation?.content
    const content = translatedContent || entryContent
    return {
      content,
      error,
      isPending,
    }
  }, [
    finalTranslation?.content,
    finalTranslation?.readabilityContent,
    data?.content,
    entry?.content,
    error,
    isInReadabilityMode,
    isPending,
    entry?.readabilityContent,
  ])
}

export const useEntryMediaInfo = (entryId: string) => {
  return useEntry(entryId, (entry) =>
    Object.fromEntries(
      entry?.media
        ?.filter((m) => m.type === "photo")
        .map((cur) => [
          cur.url,
          {
            width: cur.width,
            height: cur.height,
          },
        ]) ?? [],
    ),
  )
}

import type { UserByokProviderConfig, UserByokSettings } from "@follow/shared/settings/interface"

import { getAISettings, useAISettingSelector } from "~/atoms/settings/ai"

const ENCRYPT_PREFIX = "encrypt__"

function isServerEncryptedApiKey(key: string | null | undefined): boolean {
  if (!key) return false
  return key.startsWith(ENCRYPT_PREFIX)
}

function processApiKey(key: string | null | undefined): string | null {
  if (!key) return null

  if (isServerEncryptedApiKey(key)) {
    return null
  }

  return key
}

const getUsableByokProvider = (
  byok: UserByokSettings | null | undefined,
): UserByokProviderConfig | null => {
  if (!byok?.enabled || !byok.providers?.length) {
    return null
  }

  for (const provider of byok.providers) {
    const apiKey = processApiKey(provider.apiKey)
    if (!apiKey) continue

    return {
      ...provider,
      apiKey,
    }
  }

  return null
}

export const hasUsableByokProvider = (byok: UserByokSettings | null | undefined): boolean => {
  return !!getUsableByokProvider(byok)
}

export const hasByokModeEnabled = (byok: UserByokSettings | null | undefined): boolean => {
  return !!byok?.enabled
}

export const canUseSummaryWithByok = ({
  aiEnabled,
  byok,
}: {
  readonly aiEnabled: boolean
  readonly byok: UserByokSettings | null | undefined
}): boolean => {
  return aiEnabled || hasUsableByokProvider(byok)
}

export function isByokEnabled(): boolean {
  const aiSettings = getAISettings()
  return hasUsableByokProvider(aiSettings.byok)
}

export function isByokModeEnabled(): boolean {
  const aiSettings = getAISettings()
  return hasByokModeEnabled(aiSettings.byok)
}

export function getByokProvider(): UserByokProviderConfig | null {
  const aiSettings = getAISettings()
  return getUsableByokProvider(aiSettings.byok)
}

export const useIsByokModeEnabled = (): boolean => {
  return useAISettingSelector((settings) => hasByokModeEnabled(settings.byok))
}

export const useIsByokEnabled = (): boolean => {
  return useAISettingSelector((settings) => hasUsableByokProvider(settings.byok))
}

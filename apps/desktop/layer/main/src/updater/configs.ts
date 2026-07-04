import { MICROSOFT_STORE_BUILD } from "@follow/shared/constants"

const isStoreDistribution = Boolean(process.mas || MICROSOFT_STORE_BUILD)

export const appUpdaterConfig = {
  // Fork build: never hot-update the renderer from ota.folo.is. The official OTA
  // bundle lacks this fork's features (e.g. BYOK AI summaries) and, being >= the
  // app version, would override the renderer bundled in app.asar and run instead
  // of it. Keep this false so the app always loads the local bundled renderer.
  enableRenderHotUpdate: false,
  enableCoreUpdate: !isStoreDistribution,

  // Fork build: don't auto-replace this custom build with an official release.
  enableAppUpdate: false,
  enableDistributionStoreUpdate: isStoreDistribution,

  app: {
    autoCheckUpdate: true,
    autoDownloadUpdate: true,
    checkUpdateInterval: 15 * 60 * 1000,
  },
}

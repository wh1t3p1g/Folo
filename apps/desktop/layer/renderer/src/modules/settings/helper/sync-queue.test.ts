import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import {
  clearAISettings,
  getAISettings,
  initializeDefaultAISettings,
  setAISetting,
} from "~/atoms/settings/ai"
import {
  getSpotlightSettings,
  initializeDefaultSpotlightSettings,
  setSpotlightSetting,
} from "~/atoms/settings/spotlight"
import { initializeDefaultUISettings } from "~/atoms/settings/ui"

import { settingSyncQueue } from "./sync-queue"

const { settingsPrefetchMock, settingsUpdateMock, whoamiMock } = vi.hoisted(() => ({
  settingsPrefetchMock: vi.fn(),
  settingsUpdateMock: vi.fn(),
  whoamiMock: vi.fn(),
}))

vi.mock("@follow/store/user/getters", () => ({
  whoami: whoamiMock,
}))

vi.mock("@follow/tracker", () => ({
  tracker: {
    manager: {
      captureException: vi.fn(),
    },
  },
}))

vi.mock("~/lib/api-client", () => ({
  followClient: {
    api: {
      settings: {
        update: settingsUpdateMock,
      },
    },
  },
}))

vi.mock("~/queries/settings", () => ({
  settings: {
    get: () => ({
      prefetch: settingsPrefetchMock,
    }),
  },
}))

const createRule = () => ({
  id: "rule-1",
  enabled: true,
  pattern: "alpha",
  patternType: "keyword" as const,
  caseSensitive: false,
  color: "#FDE68A",
})

const createLocalStorageMock = (): Storage => {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key) {
      return store.get(key) ?? null
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key) {
      store.delete(key)
    },
    setItem(key, value) {
      store.set(key, value)
    },
  }
}

describe("desktop spotlight setting sync", () => {
  beforeEach(() => {
    const eventTarget = new EventTarget()
    const localStorageMock = createLocalStorageMock()
    Object.defineProperties(window, {
      addEventListener: {
        configurable: true,
        value: eventTarget.addEventListener.bind(eventTarget),
      },
      removeEventListener: {
        configurable: true,
        value: eventTarget.removeEventListener.bind(eventTarget),
      },
      dispatchEvent: {
        configurable: true,
        value: eventTarget.dispatchEvent.bind(eventTarget),
      },
      localStorage: {
        configurable: true,
        value: localStorageMock,
      },
    })
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: localStorageMock,
    })

    whoamiMock.mockReturnValue({ id: "user-1" })
    settingsUpdateMock.mockResolvedValue({ code: 0 })
    settingsPrefetchMock.mockResolvedValue({
      code: 0,
      settings: {},
      updated: {},
    })

    clearAISettings()
    initializeDefaultAISettings()
    initializeDefaultUISettings()
    initializeDefaultSpotlightSettings()
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    settingSyncQueue.teardown()
    settingSyncQueue.queue = []
    localStorage.clear()
    clearAISettings()
    initializeDefaultAISettings()
    initializeDefaultUISettings()
    initializeDefaultSpotlightSettings()
  })

  test("syncLocal hydrates spotlight rules from remote appearance settings", async () => {
    const rule = createRule()
    settingsPrefetchMock.mockResolvedValue({
      code: 0,
      settings: {
        appearance: {
          spotlights: [rule],
          spotlightsUpdated: 1710000000100,
        },
      },
      updated: {
        appearance: "2026-04-14T12:00:00.000Z",
      },
    })

    await settingSyncQueue.syncLocal()

    expect(getSpotlightSettings()).toMatchObject({
      updated: 1710000000100,
      spotlights: [rule],
    })
  })

  test("changing spotlight settings syncs them through the appearance tab", async () => {
    vi.useFakeTimers()

    const rule = createRule()
    settingsPrefetchMock.mockResolvedValue({
      code: 0,
      settings: {
        appearance: {
          uiFontFamily: "system-ui",
          spotlights: [],
        },
      },
      updated: {
        appearance: "2026-04-14T12:00:00.000Z",
      },
    })

    await settingSyncQueue.init()

    setSpotlightSetting("spotlights", [rule])

    await vi.advanceTimersByTimeAsync(1000)
    await Promise.resolve()

    expect(settingsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tab: "appearance",
        spotlights: [rule],
      }),
    )
  })

  test("keeps BYOK settings local instead of sending API keys to remote settings", async () => {
    vi.useFakeTimers()

    await settingSyncQueue.init()

    setAISetting("byok", {
      enabled: true,
      providers: [
        {
          provider: "openai",
          apiKey: "sk-local",
        },
      ],
    })

    await vi.advanceTimersByTimeAsync(1000)
    await Promise.resolve()

    expect(settingsUpdateMock).not.toHaveBeenCalled()
  })

  test("does not hydrate server-encrypted BYOK settings over the local BYOK config", async () => {
    settingsPrefetchMock.mockResolvedValue({
      code: 0,
      settings: {
        ai: {
          byok: {
            enabled: true,
            providers: [
              {
                provider: "openai",
                apiKey: "encrypt__stored-on-server",
              },
            ],
          },
        },
      },
      updated: {
        ai: "2026-04-14T12:00:00.000Z",
      },
    })

    await settingSyncQueue.syncLocal()

    expect(getAISettings().byok).toEqual({
      enabled: false,
      providers: [],
    })
  })
})

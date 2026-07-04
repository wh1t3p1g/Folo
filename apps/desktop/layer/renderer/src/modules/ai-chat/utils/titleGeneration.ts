import { followClient } from "~/lib/api-client"
import { generateTitleWithByok } from "~/lib/byok-ai"
import { isByokEnabled } from "~/lib/byok-settings"

import { AIPersistService } from "../services"
import type { SendingUIMessage } from "../store/types"

/**
 * Extract text content from message parts
 */
function extractMessageContent(msg: SendingUIMessage): string {
  let content = ""
  if (msg.parts && Array.isArray(msg.parts)) {
    for (const part of msg.parts) {
      switch (part.type) {
        case "text": {
          content += `${part.text}`
          break
        }
        case "data-rich-text": {
          content += part.data.text
          break
        }
      }
    }
  }
  return content
}

/**
 * Generate chat title using BYOK if enabled, otherwise use server API
 */
export const generateChatTitle = async (
  chatId: string,
  messages: SendingUIMessage[],
): Promise<string | null> => {
  const relevantMessages = messages.map((msg) => ({
    role: msg.role,
    content: extractMessageContent(msg),
  }))

  // Try BYOK first if enabled
  if (isByokEnabled()) {
    try {
      const title = await generateTitleWithByok({ messages: relevantMessages })
      if (title) {
        return title
      }
    } catch (error) {
      console.error("[BYOK] Title generation failed, falling back to server:", error)
      // Fall through to server API
    }
  }

  // Fallback to server API
  const response = await followClient.api.ai
    .summaryTitle({
      chatId,
      messages: relevantMessages,
    })
    .catch((error) => {
      console.error("Failed to generate chat title:", error)
      return null
    })

  if (response && "title" in response) {
    return response.title
  }

  return null
}

/**
 * Generate and update chat title based on messages
 * @param chatId - Current chat session ID
 * @param messages - Messages to generate title from
 * @param onTitleUpdate - Callback when title is updated
 * @returns Generated title or null
 */
export const generateAndUpdateChatTitle = async (
  chatId: string,
  messages: SendingUIMessage[],
  onTitleUpdate?: (title: string) => void,
): Promise<string | null> => {
  if (messages.length === 0) {
    return null
  }

  const title = await generateChatTitle(chatId, messages)

  if (title && chatId) {
    try {
      await AIPersistService.updateSessionTitle(chatId, title)
      onTitleUpdate?.(title)
      return title
    } catch (error) {
      console.error("Failed to update session title:", error)
      throw error
    }
  }

  return null
}

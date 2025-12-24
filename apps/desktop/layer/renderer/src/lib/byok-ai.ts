/**
 * BYOK (Bring Your Own Key) AI Service
 *
 * This module provides direct AI provider API calls using user's own API keys,
 * bypassing the Folo server when BYOK is enabled.
 *
 * Uses IPC customFetch to bypass CORS restrictions in Electron.
 */

import type { UserByokProviderConfig } from "@follow/shared/settings/interface"

import { getAISettings } from "~/atoms/settings/ai"
import { ipcServices } from "~/lib/client"

/**
 * Fetch via IPC to bypass CORS (for Electron)
 * Falls back to regular fetch for web
 */
async function byokFetch(
  url: string,
  options: {
    method: string
    headers: Record<string, string>
    body?: string
  },
): Promise<{
  ok: boolean
  status: number
  text: () => Promise<string>
  json: () => Promise<unknown>
}> {
  // Check if we're in Electron environment - use IPC to bypass CORS
  if (ipcServices?.integration?.customFetch) {
    const result = await ipcServices.integration.customFetch({
      url,
      method: options.method,
      headers: options.headers,
      body: options.body,
      timeout: 60000, // 60 second timeout for AI calls
    })
    return {
      ok: result.ok,
      status: result.status,
      text: async () => result.text,
      json: async () => JSON.parse(result.text) as unknown,
    }
  }

  // Fallback to regular fetch for web
  const response = await fetch(url, options)
  return response
}

export interface ByokSummaryOptions {
  content: string
  language: string
  title?: string
}

export interface ByokTitleGenerationOptions {
  messages: Array<{ role: string; content: string }>
}

export interface ByokTranslationOptions {
  title?: string | null
  description?: string | null
  content?: string | null
  language: string
}

export interface ByokTranslationResult {
  title: string | null
  description: string | null
  content: string | null
  readabilityContent: string | null
}

/**
 * Check if BYOK is enabled and has valid provider configuration
 */
export function isByokEnabled(): boolean {
  const aiSettings = getAISettings()
  const { byok } = aiSettings
  return !!(byok?.enabled && byok.providers?.length > 0)
}

// /**
//  * Mask API key for logging (show first 4 and last 4 characters)
//  */
// function maskApiKey(key: string | null | undefined): string {
//   if (!key) return "(empty)"
//   if (key.length <= 8) return "****"
//   return `${key.slice(0, 4)}...${key.slice(-4)}`
// }

const ENCRYPT_PREFIX = "encrypt__"

/**
 * Check if API key is in encrypted format (from server sync)
 * If so, it cannot be used and user needs to re-enter the key
 */
function isServerEncryptedApiKey(key: string | null | undefined): boolean {
  if (!key) return false
  return key.startsWith(ENCRYPT_PREFIX)
}

/**
 * Process API key - return as-is if plain text, null if encrypted
 * Since BYOK settings are now local-only (not synced to server),
 * new API keys should always be plain text.
 * If we detect an encrypted key, it means the key was synced from server
 * before we disabled sync, and the user needs to re-enter it.
 */
function processApiKey(key: string | null | undefined): string | null {
  if (!key) return null

  // console.info("[BYOK] Processing API key:", maskApiKey(key))

  // If the key is in server-encrypted format, it cannot be decrypted client-side
  // User needs to re-enter the API key
  if (isServerEncryptedApiKey(key)) {
    // console.warn(
    //   "[BYOK] API key is in encrypted format from server sync. " +
    //     "Please re-enter your API key in Settings > AI > BYOK.",
    // )
    return null
  }

  // Plain text API key - return as-is
  return key
}

/**
 * Get the first valid BYOK provider configuration
 * Returns provider with processed API key (null if encrypted)
 */
export function getByokProvider(): UserByokProviderConfig | null {
  const aiSettings = getAISettings()
  const { byok } = aiSettings

  if (!byok?.enabled || !byok.providers?.length) {
    return null
  }

  // Find first provider with API key
  const provider = byok.providers.find((p) => p.apiKey) ?? null
  if (!provider) {
    return null
  }

  // Process the API key - return null if it's in encrypted format
  const processedApiKey = processApiKey(provider.apiKey)

  // If API key couldn't be processed (encrypted from server), return null
  if (!processedApiKey) {
    // console.warn("[BYOK] API key is encrypted and cannot be used. Please re-enter your API key.")
    return null
  }

  return {
    ...provider,
    apiKey: processedApiKey,
  }
}

/**
 * Get base URL for a provider
 */
function getProviderBaseUrl(provider: UserByokProviderConfig): string {
  if (provider.baseURL) {
    return provider.baseURL
  }

  switch (provider.provider) {
    case "openai": {
      return "https://api.openai.com/v1"
    }
    case "google": {
      return "https://generativelanguage.googleapis.com/v1beta"
    }
    case "openrouter": {
      return "https://openrouter.ai/api/v1"
    }
    case "vercel-ai-gateway": {
      return "https://gateway.ai.cloudflare.com/v1"
    }
    default: {
      return "https://api.openai.com/v1"
    }
  }
}

/**
 * Generate summary using BYOK provider (OpenAI-compatible API)
 */
export async function generateSummaryWithByok(options: ByokSummaryOptions): Promise<string | null> {
  const provider = getByokProvider()
  if (!provider || !provider.apiKey) {
    throw new Error("No valid BYOK provider configured")
  }

  const { content, language, title } = options
  const baseUrl = getProviderBaseUrl(provider)

  // Build the prompt
  const systemPrompt = `You are a helpful assistant that summarizes content. Provide a concise summary in ${language === "default" ? "the same language as the content" : language}. Keep the summary brief and informative.`

  const userPrompt = title
    ? `Please summarize the following article titled "${title}":\n\n${content}`
    : `Please summarize the following content:\n\n${content}`

  // Determine model based on provider and baseURL
  let model = "gpt-4o-mini"
  const isDeepSeek = baseUrl.includes("deepseek.com")
  const isQwen = baseUrl.includes("dashscope.aliyuncs.com")
  const isMoonshot = baseUrl.includes("moonshot.cn")
  const isZhipu = baseUrl.includes("bigmodel.cn")

  if (provider.provider === "google") {
    model = "gemini-1.5-flash"
  } else if (provider.provider === "openrouter") {
    model = "openai/gpt-4o-mini"
  } else if (isDeepSeek) {
    model = "deepseek-chat"
  } else if (isQwen) {
    model = "qwen-turbo"
  } else if (isMoonshot) {
    model = "moonshot-v1-8k"
  } else if (isZhipu) {
    model = "glm-4-flash"
  }

  let result: string
  if (provider.provider === "google") {
    // Google AI uses different API format
    result = await callGoogleAI(baseUrl, provider.apiKey, systemPrompt, userPrompt, model)
  } else {
    // OpenAI-compatible API (OpenAI, OpenRouter, Vercel AI Gateway)
    result = await callOpenAICompatible(
      baseUrl,
      provider.apiKey,
      systemPrompt,
      userPrompt,
      model,
      provider.headers,
    )
  }
  return result
}

/**
 * Call OpenAI-compatible API
 */
async function callOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  model: string,
  customHeaders?: Record<string, string>,
): Promise<string> {
  const response = await byokFetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...customHeaders,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 500,
      temperature: 0.3,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OpenAI API error: ${response.status} - ${error}`)
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return data.choices?.[0]?.message?.content || ""
}

/**
 * Call Google AI API
 */
async function callGoogleAI(
  baseUrl: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  model: string,
): Promise<string> {
  const url = `${baseUrl}/models/${model}:generateContent?key=${apiKey}`
  const response = await byokFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
        },
      ],
      generationConfig: {
        maxOutputTokens: 500,
        temperature: 0.3,
      },
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Google AI API error: ${response.status} - ${error}`)
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  return data.candidates?.[0]?.content?.parts?.[0]?.text || ""
}

/**
 * Generate chat title using BYOK provider
 */
export async function generateTitleWithByok(
  options: ByokTitleGenerationOptions,
): Promise<string | null> {
  const provider = getByokProvider()
  if (!provider || !provider.apiKey) {
    throw new Error("No valid BYOK provider configured")
  }

  const { messages } = options
  const baseUrl = getProviderBaseUrl(provider)

  // Build the prompt for title generation
  const systemPrompt = `You are a helpful assistant that generates short, concise titles for chat conversations.
Based on the conversation messages provided, generate a brief title (max 50 characters) that captures the main topic.
Return ONLY the title text, nothing else. No quotes, no explanation.`

  // Format messages for the prompt
  const conversationText = messages
    .map((msg) => `${msg.role}: ${msg.content}`)
    .join("\n")
    .slice(0, 2000) // Limit context size

  const userPrompt = `Generate a short title for this conversation:\n\n${conversationText}`

  // Determine model based on provider and baseURL
  let model = "gpt-4o-mini"
  const isDeepSeek = baseUrl.includes("deepseek.com")
  const isQwen = baseUrl.includes("dashscope.aliyuncs.com")
  const isMoonshot = baseUrl.includes("moonshot.cn")
  const isZhipu = baseUrl.includes("bigmodel.cn")

  if (provider.provider === "google") {
    model = "gemini-1.5-flash"
  } else if (provider.provider === "openrouter") {
    model = "openai/gpt-4o-mini"
  } else if (isDeepSeek) {
    model = "deepseek-chat"
  } else if (isQwen) {
    model = "qwen-turbo"
  } else if (isMoonshot) {
    model = "moonshot-v1-8k"
  } else if (isZhipu) {
    model = "glm-4-flash"
  }

  let result: string
  if (provider.provider === "google") {
    result = await callGoogleAI(baseUrl, provider.apiKey, systemPrompt, userPrompt, model)
  } else {
    result = await callOpenAICompatible(
      baseUrl,
      provider.apiKey,
      systemPrompt,
      userPrompt,
      model,
      provider.headers,
    )
  }
  // Clean up the title - remove quotes and trim
  return result
    .replaceAll(/^["']|["']$/g, "")
    .trim()
    .slice(0, 50)
}

/**
 * Translate content using BYOK provider
 */
export async function generateTranslationWithByok(
  options: ByokTranslationOptions,
): Promise<ByokTranslationResult> {
  const provider = getByokProvider()
  if (!provider || !provider.apiKey) {
    throw new Error("No valid BYOK provider configured")
  }

  const { title, description, content, language } = options
  const baseUrl = getProviderBaseUrl(provider)

  // Build the translation prompt
  const systemPrompt = `You are a professional translator. Translate the given content to ${language}.
Rules:
1. Maintain the original formatting and structure
2. Keep proper nouns, brand names, and technical terms as-is or transliterate appropriately
3. Return a valid JSON object with the translated fields
4. If a field is empty or null, return null for that field
5. Do NOT add any explanation, only return the JSON object`

  // Build content to translate
  const fieldsToTranslate: Record<string, string> = {}
  if (title) fieldsToTranslate.title = title
  if (description) fieldsToTranslate.description = description
  if (content) fieldsToTranslate.content = content

  if (Object.keys(fieldsToTranslate).length === 0) {
    return { title: null, description: null, content: null, readabilityContent: null }
  }

  const userPrompt = `Translate the following JSON fields to ${language}. Return a JSON object with the same keys but translated values:

${JSON.stringify(fieldsToTranslate, null, 2)}`

  // Determine model based on provider and baseURL
  let model = "gpt-4o-mini"
  const isDeepSeek = baseUrl.includes("deepseek.com")
  const isQwen = baseUrl.includes("dashscope.aliyuncs.com")
  const isMoonshot = baseUrl.includes("moonshot.cn")
  const isZhipu = baseUrl.includes("bigmodel.cn")

  if (provider.provider === "google") {
    model = "gemini-1.5-flash"
  } else if (provider.provider === "openrouter") {
    model = "openai/gpt-4o-mini"
  } else if (isDeepSeek) {
    model = "deepseek-chat"
  } else if (isQwen) {
    model = "qwen-turbo"
  } else if (isMoonshot) {
    model = "moonshot-v1-8k"
  } else if (isZhipu) {
    model = "glm-4-flash"
  }

  let result: string
  if (provider.provider === "google") {
    result = await callGoogleAI(baseUrl, provider.apiKey, systemPrompt, userPrompt, model)
  } else {
    result = await callOpenAICompatible(
      baseUrl,
      provider.apiKey,
      systemPrompt,
      userPrompt,
      model,
      provider.headers,
    )
  }

  // Parse the JSON response
  // Try to extract JSON from the response (it might be wrapped in markdown code blocks)
  let jsonStr = result.trim()
  // Extract JSON from markdown code block if present
  if (jsonStr.startsWith("```")) {
    const endIndex = jsonStr.lastIndexOf("```")
    if (endIndex > 3) {
      // Skip the opening ``` and optional language tag
      const startIndex = jsonStr.indexOf("\n") + 1
      jsonStr = jsonStr.slice(startIndex, endIndex).trim()
    }
  }

  const parsed = JSON.parse(jsonStr) as Record<string, string | null>
  return {
    title: parsed.title ?? null,
    description: parsed.description ?? null,
    content: parsed.content ?? null,
    readabilityContent: parsed.readabilityContent ?? null,
  }
}

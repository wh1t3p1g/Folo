/**
 * BYOK (Bring Your Own Key) AI Service
 *
 * This module provides direct AI provider API calls using user's own API keys,
 * bypassing the Folo server when BYOK is enabled.
 *
 * Uses IPC customFetch to bypass CORS restrictions in Electron.
 */

import type { UserByokProviderConfig } from "@follow/shared/settings/interface"

import { getByokProvider } from "~/lib/byok-settings"
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

const SUMMARY_PROMPT_VERSION = "summary-v2"
const SUMMARY_MAX_INPUT_CHARS = 24_000
const SUMMARY_INITIAL_OUTPUT_TOKENS = 1_200
const SUMMARY_MAX_OUTPUT_TOKENS = 2_200

/** Convert feed HTML into a compact, readable source for the language model. */
export function normalizeSummaryContent(content: string): string {
  const normalized = content
    .replaceAll(/<script[\s\S]*?<\/script>/gi, " ")
    .replaceAll(/<style[\s\S]*?<\/style>/gi, " ")
    .replaceAll(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/blockquote)>/gi, "\n")
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll(/&nbsp;/gi, " ")
    .replaceAll(/&amp;/gi, "&")
    .replaceAll(/&lt;/gi, "<")
    .replaceAll(/&gt;/gi, ">")
    .replaceAll(/[ \t]+/g, " ")
    .replaceAll(/\s+([,.!?;:])/g, "$1")
    .replaceAll(/\n[ \t]+/g, "\n")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim()

  if (normalized.length <= SUMMARY_MAX_INPUT_CHARS) return normalized

  const headLength = Math.floor(SUMMARY_MAX_INPUT_CHARS * 0.7)
  const tailLength = SUMMARY_MAX_INPUT_CHARS - headLength
  return `${normalized.slice(0, headLength)}\n\n[...middle of article omitted...]\n\n${normalized.slice(-tailLength)}`
}

export function getSummaryOutputTokenBudget(sourceLength: number): number {
  if (sourceLength >= 8_000) return SUMMARY_MAX_OUTPUT_TOKENS
  if (sourceLength >= 3_000) return 1_600
  return SUMMARY_INITIAL_OUTPUT_TOKENS
}

export function shouldRetrySummaryCompletion(
  finishReason: string | undefined,
  outputTokens: number,
): boolean {
  return (
    (finishReason === "length" || finishReason === "MAX_TOKENS") &&
    outputTokens < SUMMARY_MAX_OUTPUT_TOKENS
  )
}

function hashSummaryValue(value: string): string {
  let hash = 2166136261
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

export function getByokSummaryCacheIdentity({
  content,
  language,
  title,
  provider,
}: ByokSummaryOptions & { provider: UserByokProviderConfig }): string {
  return hashSummaryValue(
    [
      SUMMARY_PROMPT_VERSION,
      normalizeSummaryContent(content),
      language,
      title ?? "",
      provider.provider,
      provider.baseURL ?? "",
      provider.apiKey,
    ].join("\u0000"),
  )
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
  const apiKey = provider.apiKey

  const { content, language, title } = options
  const normalizedContent = normalizeSummaryContent(content)
  if (!normalizedContent) {
    throw new Error("BYOK_SUMMARY_NO_CONTENT")
  }
  const baseUrl = getProviderBaseUrl(provider)
  const outputTokens = getSummaryOutputTokenBudget(normalizedContent.length)

  // Build the prompt
  const systemPrompt = `You summarize articles accurately in ${language === "default" ? "the same language as the content" : language}. Cover the main thesis, important facts, decisions, numbers, and conclusions. Do not invent details. Return 5-8 concise bullet points followed by one short takeaway sentence. If the supplied text is an excerpt, summarize only what is present.`

  const userPrompt = title
    ? `Summarize the following article titled "${title}":\n\n${normalizedContent}`
    : `Summarize the following content:\n\n${normalizedContent}`

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
    model = "deepseek-v4-flash"
  } else if (isQwen) {
    model = "qwen-turbo"
  } else if (isMoonshot) {
    model = "moonshot-v1-8k"
  } else if (isZhipu) {
    model = "glm-4-flash"
  }

  const request = () =>
    provider.provider === "google"
      ? callGoogleAI(baseUrl, apiKey, systemPrompt, userPrompt, model, outputTokens)
      : callOpenAICompatible(
          baseUrl,
          apiKey,
          systemPrompt,
          userPrompt,
          model,
          provider.headers,
          outputTokens,
        )

  let result = await request()
  if (shouldRetrySummaryCompletion(result.finishReason, outputTokens)) {
    result =
      provider.provider === "google"
        ? await callGoogleAI(
            baseUrl,
            apiKey,
            systemPrompt,
            userPrompt,
            model,
            SUMMARY_MAX_OUTPUT_TOKENS,
          )
        : await callOpenAICompatible(
            baseUrl,
            apiKey,
            systemPrompt,
            userPrompt,
            model,
            provider.headers,
            SUMMARY_MAX_OUTPUT_TOKENS,
          )
  }
  if (shouldRetrySummaryCompletion(result.finishReason, SUMMARY_MAX_OUTPUT_TOKENS)) {
    throw new Error("BYOK_SUMMARY_INCOMPLETE")
  }
  if (!result.text.trim()) {
    throw new Error("BYOK_SUMMARY_EMPTY")
  }
  return result.text.trim()
}

interface ByokCompletion {
  text: string
  finishReason?: string
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
  maxTokens = 500,
): Promise<ByokCompletion> {
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
      max_tokens: maxTokens,
      temperature: 0.3,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OpenAI API error: ${response.status} - ${error}`)
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
  }
  return {
    text: data.choices?.[0]?.message?.content || "",
    finishReason: data.choices?.[0]?.finish_reason,
  }
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
  maxOutputTokens = 500,
): Promise<ByokCompletion> {
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
        maxOutputTokens,
        temperature: 0.3,
      },
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Google AI API error: ${response.status} - ${error}`)
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> }
      finishReason?: string
    }>
  }
  const candidate = data.candidates?.[0]
  return {
    text: candidate?.content?.parts?.map((part) => part.text || "").join("") || "",
    finishReason: candidate?.finishReason,
  }
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
    model = "deepseek-v4-flash"
  } else if (isQwen) {
    model = "qwen-turbo"
  } else if (isMoonshot) {
    model = "moonshot-v1-8k"
  } else if (isZhipu) {
    model = "glm-4-flash"
  }

  let result: string
  if (provider.provider === "google") {
    result = (await callGoogleAI(baseUrl, provider.apiKey, systemPrompt, userPrompt, model)).text
  } else {
    result = (
      await callOpenAICompatible(
        baseUrl,
        provider.apiKey,
        systemPrompt,
        userPrompt,
        model,
        provider.headers,
      )
    ).text
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
    model = "deepseek-v4-flash"
  } else if (isQwen) {
    model = "qwen-turbo"
  } else if (isMoonshot) {
    model = "moonshot-v1-8k"
  } else if (isZhipu) {
    model = "glm-4-flash"
  }

  let result: string
  if (provider.provider === "google") {
    result = (await callGoogleAI(baseUrl, provider.apiKey, systemPrompt, userPrompt, model)).text
  } else {
    result = (
      await callOpenAICompatible(
        baseUrl,
        provider.apiKey,
        systemPrompt,
        userPrompt,
        model,
        provider.headers,
      )
    ).text
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

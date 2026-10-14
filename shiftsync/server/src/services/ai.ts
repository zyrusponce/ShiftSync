// Gemini (Google AI Studio) over REST. The key stays on the server.
export class AiUnavailable extends Error {}
export interface AiClient {
  readonly available: boolean;
  /** Returns parsed JSON that matches `schema`, or throws AiUnavailable. */
  generateJson(args: {
    system: string;
    prompt: string;
    schema: Record<string, unknown>;
  }): Promise<unknown>;
}
export const disabledAi: AiClient = {
  available: false,
  async generateJson() {
    throw new AiUnavailable("AI is not configured");
  },
};

/** Overloaded or rate-limited responses that usually clear within seconds. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface GeminiOptions {
  /** Tried in order when `model` keeps failing with a retryable status. */
  fallbackModels?: string[];
  /** Attempts per model for retryable statuses. */
  attempts?: number;
  retryDelayMs?: number;
}

/**
 * OpenRouter (OpenAI-compatible chat completions). `fallbackModels` are sent
 * as OpenRouter's `models` list, so it fails over server-side.
 */
export function openRouterClient(
  apiKey: string | null,
  model: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 25000,
  {
    fallbackModels = [],
    attempts = 2,
    retryDelayMs = 1000,
  }: GeminiOptions = {},
): AiClient {
  if (!apiKey) return disabledAi;
  const models = [model, ...fallbackModels.filter((name) => name !== model)];
  const sendBody = (system: string, prompt: string, schema: unknown) =>
    JSON.stringify({
      model,
      ...(models.length > 1 ? { models } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 2048,
      response_format: {
        type: "json_schema",
        json_schema: { name: "result", strict: true, schema },
      },
      // Only route to providers that honour the JSON schema.
      provider: { require_parameters: true },
    });

  return {
    available: true,
    async generateJson({ system, prompt, schema }) {
      const body = sendBody(system, prompt, schema);
      for (let attempt = 1; attempt <= attempts; attempt++) {
        let response: Response;
        try {
          response = await fetchImpl(
            "https://openrouter.ai/api/v1/chat/completions",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
              body,
              signal: AbortSignal.timeout(timeoutMs),
            },
          );
        } catch (error) {
          console.warn("openrouter_unreachable", (error as Error).name);
          break;
        }
        if (!response.ok) {
          // Status and OpenRouter's error reason only; never the key or prompt.
          const detail = (await response.text().catch(() => ""))
            .replace(/\s+/g, " ")
            .slice(0, 300);
          console.warn("openrouter_error", response.status, model, detail);
          if (RETRYABLE.has(response.status) && attempt < attempts) {
            await sleep(retryDelayMs * attempt);
            continue;
          }
          break;
        }
        const data = (await response.json().catch(() => null)) as {
          choices?: {
            finish_reason?: string;
            message?: { content?: string };
          }[];
        } | null;
        const text = data?.choices?.[0]?.message?.content;
        if (!text) {
          console.warn(
            "openrouter_empty",
            model,
            data?.choices?.[0]?.finish_reason ?? "no choices",
          );
          break;
        }
        try {
          return JSON.parse(text);
        } catch {
          throw new AiUnavailable("OpenRouter returned malformed JSON");
        }
      }
      throw new AiUnavailable("OpenRouter is unavailable");
    },
  };
}

export function geminiClient(
  apiKey: string | null,
  model: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 25000,
  {
    fallbackModels = [],
    attempts = 2,
    retryDelayMs = 1000,
  }: GeminiOptions = {},
): AiClient {
  if (!apiKey) return disabledAi;
  const models = [model, ...fallbackModels.filter((name) => name !== model)];

  async function callOnce(
    name: string,
    body: string,
  ): Promise<{ text: string } | { retry: boolean }> {
    let response: Response;
    try {
      response = await fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(name)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey!,
          },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
    } catch (error) {
      console.warn("gemini_unreachable", name, (error as Error).name);
      return { retry: false };
    }
    if (!response.ok) {
      // Status and Google's error reason only; never the key or the prompt.
      const detail = (await response.text().catch(() => ""))
        .replace(/\s+/g, " ")
        .slice(0, 300);
      console.warn("gemini_error", response.status, name, detail);
      return { retry: RETRYABLE.has(response.status) };
    }
    const data = (await response.json().catch(() => null)) as {
      candidates?: {
        finishReason?: string;
        content?: { parts?: { text?: string }[] };
      }[];
    } | null;
    const text = data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("");
    if (!text) {
      console.warn(
        "gemini_empty",
        name,
        data?.candidates?.[0]?.finishReason ?? "no candidates",
      );
      return { retry: false };
    }
    return { text };
  }

  return {
    available: true,
    async generateJson({ system, prompt, schema }) {
      for (const name of models) {
        const body = JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 2048,
            // 2.5 Flash otherwise spends the budget on hidden thinking
            // and can return no text at all.
            ...(/2\.5-flash/.test(name)
              ? { thinkingConfig: { thinkingBudget: 0 } }
              : {}),
            responseMimeType: "application/json",
            responseSchema: schema,
          },
        });
        for (let attempt = 1; attempt <= attempts; attempt++) {
          const result = await callOnce(name, body);
          if ("text" in result) {
            try {
              return JSON.parse(result.text);
            } catch {
              throw new AiUnavailable("Gemini returned malformed JSON");
            }
          }
          if (!result.retry) break;
          if (attempt < attempts) await sleep(retryDelayMs * attempt);
        }
      }
      throw new AiUnavailable("Gemini is unavailable");
    },
  };
}

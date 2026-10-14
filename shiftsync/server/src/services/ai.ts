// AI providers (Groq, OpenRouter, Gemini) over REST. Keys stay on the server.
export class AiUnavailable extends Error {}
export interface AiClient {
  readonly available: boolean;
  /** Which service answers, for health checks and logs. */
  readonly provider?: "groq" | "openrouter" | "gemini" | "none";
  /** Returns parsed JSON that matches `schema`, or throws AiUnavailable. */
  generateJson(args: {
    system: string;
    prompt: string;
    schema: Record<string, unknown>;
  }): Promise<unknown>;
}
export const disabledAi: AiClient = {
  available: false,
  provider: "none",
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
/**
 * The app writes its response schemas in Gemini's dialect ("OBJECT",
 * "STRING"). OpenRouter speaks standard JSON Schema ("object", "string"):
 * given the Gemini spelling, models ignore the schema and answer in plain
 * text, so every reply failed validation and fell back to templates.
 */
export function toJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toJsonSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    out[key] =
      key === "type" && typeof value === "string"
        ? value.toLowerCase()
        : toJsonSchema(value);
  }
  if (out.type === "object") out.additionalProperties = false;
  return out;
}

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
        // Not strict: strict mode demands every property be required, and
        // CalenBud's action fields are optional by design.
        json_schema: {
          name: "result",
          strict: false,
          schema: toJsonSchema(schema),
        },
      },
      // Only route to providers that honour the JSON schema.
      provider: { require_parameters: true },
    });

  return {
    available: true,
    provider: "openrouter",
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

/**
 * Groq (OpenAI-compatible chat completions). Only a few Groq models can
 * follow a JSON schema; the rest only guarantee syntactically valid JSON.
 * So the schema is sent as `json_schema` where it is supported, and spelled
 * out in the prompt otherwise. Replies are validated by the callers either way.
 */
const GROQ_SCHEMA_MODELS = /^(openai\/gpt-oss|qwen\/qwen3)/;
// Reasoning models spend output tokens thinking; keep that small and out of
// the reply.
const GROQ_REASONING_MODELS = /^(openai\/gpt-oss|qwen\/qwen3)/;
export function groqRequestBody(
  model: string,
  system: string,
  prompt: string,
  schema: unknown,
) {
  const json = toJsonSchema(schema);
  const structured = GROQ_SCHEMA_MODELS.test(model);
  return {
    model,
    messages: [
      {
        role: "system",
        content: structured
          ? system
          : `${system}\nRespond with a single JSON object that matches this JSON Schema, and nothing else: ${JSON.stringify(json)}`,
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.3,
    max_completion_tokens: 2048,
    response_format: structured
      ? {
          type: "json_schema",
          // Best-effort: strict mode needs every property required, and
          // CalenBud's action fields are optional by design.
          json_schema: { name: "result", strict: false, schema: json },
        }
      : { type: "json_object" },
    ...(GROQ_REASONING_MODELS.test(model)
      ? { reasoning_effort: "low", include_reasoning: false }
      : {}),
  };
}

export function groqClient(
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

  return {
    available: true,
    provider: "groq",
    async generateJson({ system, prompt, schema }) {
      for (const name of models) {
        const body = JSON.stringify(
          groqRequestBody(name, system, prompt, schema),
        );
        for (let attempt = 1; attempt <= attempts; attempt++) {
          let response: Response;
          try {
            response = await fetchImpl(
              "https://api.groq.com/openai/v1/chat/completions",
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
            console.warn("groq_unreachable", name, (error as Error).name);
            break;
          }
          if (!response.ok) {
            // Status and Groq's error reason only; never the key or prompt.
            const detail = (await response.text().catch(() => ""))
              .replace(/\s+/g, " ")
              .slice(0, 300);
            console.warn("groq_error", response.status, name, detail);
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
              "groq_empty",
              name,
              data?.choices?.[0]?.finish_reason ?? "no choices",
            );
            break;
          }
          try {
            return JSON.parse(text);
          } catch {
            // A truncated or malformed answer: try the next model.
            console.warn("groq_malformed", name);
            break;
          }
        }
      }
      throw new AiUnavailable("Groq is unavailable");
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
    provider: "gemini",
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

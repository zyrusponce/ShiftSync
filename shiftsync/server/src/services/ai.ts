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

export function geminiClient(
  apiKey: string | null,
  model: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 15000,
): AiClient {
  if (!apiKey) return disabledAi;
  return {
    available: true,
    async generateJson({ system, prompt, schema }) {
      let response: Response;
      try {
        response = await fetchImpl(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey,
            },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: system }] },
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 2048,
                responseMimeType: "application/json",
                responseSchema: schema,
              },
            }),
            signal: AbortSignal.timeout(timeoutMs),
          },
        );
      } catch {
        throw new AiUnavailable("Gemini could not be reached");
      }
      if (!response.ok)
        throw new AiUnavailable(`Gemini returned ${response.status}`);
      const data = (await response.json().catch(() => null)) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      } | null;
      const text = data?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("");
      if (!text) throw new AiUnavailable("Gemini returned no content");
      try {
        return JSON.parse(text);
      } catch {
        throw new AiUnavailable("Gemini returned malformed JSON");
      }
    },
  };
}

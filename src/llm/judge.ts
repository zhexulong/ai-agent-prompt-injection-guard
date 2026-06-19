import type { Fingerprint } from "../core/types";

export interface JudgeConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

export async function judgeUnknownPattern(
  config: JudgeConfig | undefined,
  text: string,
  examples: Fingerprint[],
): Promise<Fingerprint | null> {
  if (!config) return null;
  const fetchImpl = config.fetchImpl ?? fetch;
  const prompt = [
    "Return JSON only.",
    "If the text contains a reusable injected banner or padding pattern, propose one fingerprint.",
    `Known examples: ${JSON.stringify(examples)}`,
    `Candidate text: ${text}`,
  ].join("\n\n");

  const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    }),
  });

  const payload = await response.json() as any;
  const content = payload.choices?.[0]?.message?.content;
  if (!content) return null;
  return JSON.parse(content) as Fingerprint;
}

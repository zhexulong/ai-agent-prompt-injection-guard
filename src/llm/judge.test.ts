import { expect, mock, test } from "bun:test";
import { judgeUnknownPattern } from "./judge";

test("returns null when Tier 1 config is missing", async () => {
  const result = await judgeUnknownPattern(undefined, "text", []);
  expect(result).toBeNull();
});

test("parses a suggested fingerprint from an OpenAI-compatible response", async () => {
  const fetchMock = mock(async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ id: "new1", type: "literal", pattern: "Injected by Y", note: "banner" }) } }],
  })));
  const result = await judgeUnknownPattern(
    { baseUrl: "https://example.invalid", apiKey: "k", model: "m", fetchImpl: fetchMock as unknown as typeof fetch },
    "Injected by Y",
    [],
  );
  expect(result?.pattern).toBe("Injected by Y");
});

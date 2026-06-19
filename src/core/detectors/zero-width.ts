import { Confidence, type Detection, type Threat } from "../types";

const ZERO_WIDTH_RUN = /[\u200B\u200C\u200D\uFEFF\u2060]+/g;
const MIN_RUN = 2;

export function detectZeroWidth(text: string, threat: Threat): Detection[] {
  const out: Detection[] = [];
  for (const match of text.matchAll(ZERO_WIDTH_RUN)) {
    if ((match[0] ?? "").length < MIN_RUN) continue;
    out.push({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      confidence: Confidence.High,
      threat,
      note: "zero-width sequence",
    });
  }
  return out;
}

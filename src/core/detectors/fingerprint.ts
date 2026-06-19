import { Confidence, type Detection, type Fingerprint, type Threat } from "../types";

function spansFor(text: string, fp: Fingerprint): Array<[number, number]> {
  if (fp.type === "literal") {
    const out: Array<[number, number]> = [];
    let from = 0;
    while (from < text.length) {
      const idx = text.indexOf(fp.pattern, from);
      if (idx === -1) break;
      out.push([idx, idx + fp.pattern.length]);
      from = idx + Math.max(fp.pattern.length, 1);
    }
    return out;
  }

  try {
    const re = new RegExp(fp.pattern, "g");
    return Array.from(text.matchAll(re), (m) => [m.index ?? 0, (m.index ?? 0) + m[0].length]);
  } catch {
    return [];
  }
}

function overlaps(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}

export function detectFingerprints(
  text: string,
  positives: Fingerprint[],
  negatives: Fingerprint[],
  threat: Threat,
): Detection[] {
  const negativeSpans = negatives.flatMap((fp) => spansFor(text, fp));
  const out: Detection[] = [];

  for (const fp of positives) {
    for (const [start, end] of spansFor(text, fp)) {
      if (negativeSpans.some((neg) => overlaps([start, end], neg))) continue;
      out.push({
        start,
        end,
        confidence: Confidence.High,
        threat,
        fingerprintId: fp.id,
        note: fp.note,
      });
    }
  }

  return out.sort((a, b) => a.start - b.start);
}

import type { Detection } from "./types";

export function mergeDetections(detections: Detection[]): Detection[] {
  const ordered = [...detections].sort((a, b) => a.start - b.start || a.end - b.end);
  if (ordered.length === 0) return [];

  const out: Detection[] = [{ ...ordered[0] }];
  for (const current of ordered.slice(1)) {
    const last = out[out.length - 1];
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
      continue;
    }
    out.push({ ...current });
  }
  return out;
}

export function stripText(text: string, detections: Detection[]): string {
  const merged = mergeDetections(detections);
  let cursor = 0;
  let out = "";
  for (const detection of merged) {
    out += text.slice(cursor, detection.start);
    cursor = detection.end;
  }
  return out + text.slice(cursor);
}

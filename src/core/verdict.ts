import { Confidence, type Detection } from "./types";

export function buildVerdict(detections: Detection[]) {
  const ordered = [...detections].sort((a, b) => a.start - b.start || a.end - b.end);
  return {
    detections: ordered,
    highConfidence: ordered.filter((d) => d.confidence === Confidence.High),
    lowConfidence: ordered.filter((d) => d.confidence === Confidence.Low),
  };
}

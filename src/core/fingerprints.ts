import { readFileSync, writeFileSync } from "node:fs";
import type { Fingerprint, FingerprintFile } from "./types";

export function loadFingerprints(path: string): FingerprintFile {
  return JSON.parse(readFileSync(path, "utf8")) as FingerprintFile;
}

export function appendFingerprint(
  path: string,
  target: "positives" | "negatives",
  fingerprint: Fingerprint,
): void {
  const file = loadFingerprints(path);
  file[target].push(fingerprint);
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

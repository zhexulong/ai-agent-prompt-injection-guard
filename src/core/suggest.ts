import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { decideSuggestionTarget } from "./confirm";
import { appendFingerprint } from "./fingerprints";
import type { Suggestion } from "./types";

export function writePendingSuggestion(path: string, suggestion: Suggestion, maxEntries = 100): void {
  const current = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as Suggestion[] : [];
  current.push(suggestion);
  writeFileSync(path, `${JSON.stringify(current.slice(-maxEntries), null, 2)}\n`, "utf8");
}

export function applyConfirmedSuggestion(fingerprintsPath: string, suggestion: Suggestion, approved: boolean): void {
  appendFingerprint(fingerprintsPath, decideSuggestionTarget(approved), suggestion.pattern);
}

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { AlertRecord } from "./types";

export function appendAlertRing(path: string, maxEntries: number, record: AlertRecord): void {
  const existing = existsSync(path)
    ? readFileSync(path, "utf8").split("\n").filter(Boolean)
    : [];
  existing.push(JSON.stringify(record));
  const bounded = existing.slice(-maxEntries);
  writeFileSync(path, `${bounded.join("\n")}\n`, "utf8");
}

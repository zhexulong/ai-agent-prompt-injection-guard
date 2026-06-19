import { NotifyLevel, type Threat } from "./types";

export function shouldNotify(
  seen: Set<string>,
  sessionId: string,
  threat: Threat,
  level: NotifyLevel,
): boolean {
  if (level === NotifyLevel.Never) return false;
  if (level === NotifyLevel.Always) return true;
  const key = `${sessionId}:${threat}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}

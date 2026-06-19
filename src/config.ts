import { NotifyLevel } from "./core/types";
import type { JudgeConfig } from "./llm/judge";

export interface GuardConfig {
  fingerprintsPath: string;
  alertsPath: string;
  pendingSuggestionsPath: string;
  alertLimit: number;
  notifyLevel: NotifyLevel;
  judge?: JudgeConfig;
}

export function loadConfig(env = process.env): GuardConfig {
  return {
    fingerprintsPath: env.AIPIG_FINGERPRINTS_PATH ?? "fingerprints.json",
    alertsPath: env.AIPIG_ALERTS_PATH ?? "alerts.jsonl",
    pendingSuggestionsPath: env.AIPIG_PENDING_SUGGESTIONS_PATH ?? "pending-suggestions.json",
    alertLimit: Number(env.AIPIG_ALERT_LIMIT ?? 100),
    notifyLevel: (env.AIPIG_NOTIFY_LEVEL as NotifyLevel | undefined) ?? NotifyLevel.First,
    judge: env.AIPIG_JUDGE_BASE_URL && env.AIPIG_JUDGE_API_KEY && env.AIPIG_JUDGE_MODEL
      ? {
          baseUrl: env.AIPIG_JUDGE_BASE_URL,
          apiKey: env.AIPIG_JUDGE_API_KEY,
          model: env.AIPIG_JUDGE_MODEL,
        }
      : undefined,
  };
}

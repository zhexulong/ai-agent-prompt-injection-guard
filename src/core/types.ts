export enum Confidence {
  High = "high",
  Low = "low",
}

export enum Threat {
  ToolInjection = "tool_injection",
  ResponseInjection = "response_injection",
  Padding = "padding",
}

export enum Action {
  Stripped = "stripped",
  Flagged = "flagged",
  FlaggedUnhandled = "flagged_unhandled",
  ErrorPassthrough = "error_passthrough",
  Clean = "clean",
}

export enum NotifyLevel {
  First = "first",
  Always = "always",
  Never = "never",
}

export type HostName = "claude" | "codex" | "opencode" | "proxy";
export type Channel = "tool_result" | "response_text" | "user_prompt" | "usage_only";

export interface Fingerprint {
  id: string;
  type: "literal" | "regex";
  pattern: string;
  note?: string;
}

export interface FingerprintFile {
  _README: string;
  positives: Fingerprint[];
  negatives: Fingerprint[];
}

export interface Detection {
  start: number;
  end: number;
  confidence: Confidence;
  threat: Threat;
  fingerprintId?: string;
  note?: string;
}

export interface GuardRequest {
  host: HostName;
  sessionId: string;
  channel: Channel;
  text: string;
  notifyLevel: NotifyLevel;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface Suggestion {
  pattern: Fingerprint;
  reason: string;
  evidence?: {
    supportingExamples: string[];
    variableSlots: string[];
  };
}

export interface GuardDecision {
  sanitizedText: string;
  detections: Detection[];
  action: Action;
  notifications: string[];
  suggestion?: Suggestion;
}

export interface AlertRecord {
  ts: string;
  host: HostName;
  sessionId: string;
  threat: Threat;
  confidence: Confidence;
  action: Action;
  fingerprintId?: string;
  snippet: string;
}

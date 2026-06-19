import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createCandidateTracker, extractCandidatePatterns, observeCandidatePattern } from "../src/core/candidates";
import type { Channel, HostName } from "../src/core/types";

export interface HistoryRecord {
  host: HostName;
  sessionId: string;
  channel: Channel;
  text: string;
}

export interface ReplayCandidate {
  id: string;
  pattern: string;
  reason: string;
  supportingExamples: string[];
  variableSlots: string[];
  extraMatches: string[];
}

export interface ReplayResult {
  inputPath?: string;
  totalRecords: number;
  truncated: boolean;
  candidates: ReplayCandidate[];
}

export interface ReplayOptions {
  maxRecords?: number;
  maxExtraMatchPool?: number;
}

function asHost(value: unknown): HostName {
  return value === "codex" || value === "opencode" || value === "proxy" ? value : "claude";
}

function asChannel(value: unknown): Channel {
  return value === "tool_result" || value === "user_prompt" || value === "usage_only" ? value : "response_text";
}

function firstTextField(value: any): string | undefined {
  for (const key of ["text", "content", "message", "message_text", "tool_response", "response", "assistant", "output"]) {
    if (typeof value?.[key] === "string") return value[key];
  }
  return undefined;
}

function textFromContentParts(parts: unknown): string | undefined {
  if (!Array.isArray(parts)) return undefined;
  const texts = parts
    .map((part: any) => typeof part?.text === "string" ? part.text : undefined)
    .filter((text): text is string => Boolean(text));
  return texts.length > 0 ? texts.join("\n") : undefined;
}

function parseCodexRolloutRecord(parsed: any): HistoryRecord | null {
  if (parsed.type === "session_meta") return null;

  if (parsed.type === "event_msg" && parsed.payload?.type === "agent_message") {
    const text = firstTextField(parsed.payload);
    return text ? { host: "codex", sessionId: "history", channel: "response_text", text } : null;
  }

  if (parsed.type !== "response_item") return null;

  const payload = parsed.payload;
  if (payload?.type === "function_call_output") {
    const text = firstTextField(payload);
    return text ? { host: "codex", sessionId: "history", channel: "tool_result", text } : null;
  }

  if (payload?.type === "message") {
    const text = firstTextField(payload) ?? textFromContentParts(payload.content);
    if (!text) return null;
    return {
      host: "codex",
      sessionId: "history",
      channel: payload.role === "user" ? "user_prompt" : "response_text",
      text,
    };
  }

  return null;
}

export function parseHistoryRecord(line: string, _index: number): HistoryRecord | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    const rolloutRecord = parseCodexRolloutRecord(parsed);
    if (rolloutRecord) return rolloutRecord;
    if (parsed.type === "session_meta" || parsed.type === "event_msg" || parsed.type === "response_item") return null;
    const text = firstTextField(parsed);
    if (!text) return null;
    return {
      host: asHost(parsed.host),
      sessionId: String(parsed.sessionId ?? parsed.session_id ?? "history"),
      channel: asChannel(parsed.channel),
      text,
    };
  } catch {
    return {
      host: "claude",
      sessionId: "history",
      channel: "response_text",
      text: trimmed,
    };
  }
}

export function replayHistoryRecords(records: HistoryRecord[], inputPath?: string, options: ReplayOptions = {}): ReplayResult {
  const tracker = createCandidateTracker();
  const candidates = new Map<string, ReplayCandidate>();
  const maxRecords = options.maxRecords ?? 10_000;
  const maxExtraMatchPool = options.maxExtraMatchPool ?? 10_000;
  const boundedRecords = records.slice(0, maxRecords);
  const sampleTexts = boundedRecords
    .filter((record) => record.channel === "response_text" || record.channel === "tool_result")
    .slice(0, maxExtraMatchPool)
    .map((record) => record.text);

  for (const [recordIndex, record] of boundedRecords.entries()) {
    if (record.channel !== "response_text" && record.channel !== "tool_result") continue;
    for (const pattern of extractCandidatePatterns(record.text)) {
      const suggestion = observeCandidatePattern(tracker, { ...record, pattern, observationId: String(recordIndex) });
      if (!suggestion) continue;
      const regex = new RegExp(suggestion.pattern.pattern);
      candidates.set(suggestion.pattern.id, {
        id: suggestion.pattern.id,
        pattern: suggestion.pattern.pattern,
        reason: suggestion.reason,
        supportingExamples: suggestion.evidence?.supportingExamples ?? [],
        variableSlots: suggestion.evidence?.variableSlots ?? [],
        extraMatches: sampleTexts
          .map((text) => text.match(regex)?.[0])
          .filter((text): text is string => Boolean(text))
          .slice(0, 10),
      });
    }
  }

  return { inputPath, totalRecords: boundedRecords.length, truncated: records.length > boundedRecords.length, candidates: [...candidates.values()] };
}

function excerpt(text: string, maxLength = 180): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function escapeCell(text: string): string {
  return excerpt(text).replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

export function renderHistoryReplayReport(result: ReplayResult): string {
  const rows = result.candidates.map((candidate) => [
    candidate.id,
    `\`${candidate.pattern}\``,
    candidate.supportingExamples.slice(0, 3).map(escapeCell).join("<br>"),
    candidate.extraMatches.slice(0, 5).map(escapeCell).join("<br>"),
    "未判定",
    candidate.variableSlots.map(escapeCell).join("<br>"),
  ]);
  return [
    "# History Replay Report",
    "",
    `Input: ${result.inputPath ?? "(in-memory)"}`,
    `Records: ${result.totalRecords}`,
    `Truncated: ${result.truncated ? "yes" : "no"}`,
    `Candidates: ${result.candidates.length}`,
    "",
    "| 候选 | Regex | 支持样本 | 额外命中 | 人工判定 | 备注 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.join(" | ")} |`),
    "",
    "人工判定建议：正确 / 过宽 / 过窄 / 正常内容。过宽写入 negatives 或调窄槽位；过窄调整 mask / 相似度规则后重放。",
  ].join("\n");
}

export async function replayHistoryFile(inputPath: string, options: ReplayOptions = {}): Promise<ReplayResult> {
  return replayHistoryFiles([inputPath], options);
}

export async function replayHistoryFiles(inputPaths: string[], options: ReplayOptions = {}): Promise<ReplayResult> {
  const maxRecords = options.maxRecords ?? 10_000;
  const records: HistoryRecord[] = [];
  for (const inputPath of inputPaths) {
    const lines = createInterface({ input: createReadStream(inputPath, { encoding: "utf8" }), crlfDelay: Infinity });
    let lineIndex = 0;
    for await (const line of lines) {
      const record = parseHistoryRecord(line, lineIndex++);
      if (!record) continue;
      records.push(record);
      if (records.length > maxRecords) {
        lines.close();
        break;
      }
    }
    if (records.length > maxRecords) break;
  }
  return replayHistoryRecords(records, inputPaths.join(", "), { ...options, maxRecords });
}

if (import.meta.main) {
  const inputPaths = Bun.argv
    .map((arg, index) => arg === "--input" ? Bun.argv[index + 1] : undefined)
    .filter((arg): arg is string => Boolean(arg));
  const maxRecordsIndex = Bun.argv.indexOf("--max-records");
  if (inputPaths.length === 0) {
    console.error("Usage: bun run eval/history-replay.ts --input <history.jsonl|txt> [--input overlay.jsonl] [--max-records 10000]");
    process.exit(2);
  }
  const maxRecords = maxRecordsIndex >= 0 ? Number(Bun.argv[maxRecordsIndex + 1]) : 10_000;
  const result = await replayHistoryFiles(inputPaths, { maxRecords });
  const report = renderHistoryReplayReport(result);
  mkdirSync("eval/reports", { recursive: true });
  const outputPath = "eval/reports/history-replay.md";
  writeFileSync(outputPath, report);
  console.log(`wrote ${outputPath}`);
}

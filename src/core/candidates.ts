import { createHash } from "node:crypto";
import type { Channel, HostName, Suggestion } from "./types";

interface TemplateToken {
  kind: "constant" | "slot";
  value: string;
  slotKind?: "url" | "uuid" | "ip" | "email" | "hex" | "timestamp" | "number" | "version" | "path" | "word" | "compact";
  regex?: string;
  values: string[];
}

interface CandidateCluster {
  count: number;
  proposed: boolean;
  tokens: TemplateToken[];
  examples: string[];
  observationIds: Set<string>;
}

export interface CandidateTracker {
  clusters: Map<string, CandidateCluster[]>;
}

export interface CandidateObservation {
  host: HostName;
  sessionId: string;
  channel: Channel;
  pattern: string;
  observationId?: string;
}

export function createCandidateTracker(): CandidateTracker {
  return { clusters: new Map<string, CandidateCluster[]>() };
}

function normalizeCandidate(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[\u200B\u200C\u200D\uFEFF\u2060]/g, "")
    .replace(/https?:\/\/([^\s/?#]+)([^\s?#]*)[^\s]*/g, "https://$1$2")
    .replace(/[0-9a-f]{16,}/gi, "<hex>")
    .replace(/\b\d{4}-\d{2}-\d{2}[T ][0-9:.Z+-]+\b/g, "<timestamp>")
    .replace(/\b\d{6,}\b/g, "<number>")
    .replace(/\s+/g, " ")
    .replace(/^[\s"'`*_~:：,，。.!！?？-]+|[\s"'`*_~:：,，。.!！?？-]+$/g, "")
    .trim();
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function commonPrefix(values: string[]): string {
  if (values.length === 0) return "";
  let prefix = values[0];
  for (const value of values.slice(1)) {
    while (prefix && !value.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  return prefix;
}

function compactPrefix(values: string[]): string | null {
  const prefix = commonPrefix(values);
  if (prefix.length < 8) return null;
  if (!/[\u3400-\u9fff]/.test(prefix)) return null;
  const suffixLengths = values.map((value) => value.length - prefix.length);
  if (Math.max(...suffixLengths) > 12) return null;
  if (Math.min(...suffixLengths) < 1) return null;
  return prefix;
}

function classifyVolatileToken(token: string): TemplateToken | null {
  if (token === "<hex>") {
    return { kind: "slot", value: "hex", slotKind: "hex", regex: "[0-9a-fA-F]{16,}", values: [token] };
  }
  if (token === "<timestamp>") {
    return { kind: "slot", value: "timestamp", slotKind: "timestamp", regex: "\\d{4}-\\d{2}-\\d{2}[T ][0-9:.Z+-]+", values: [token] };
  }
  if (token === "<number>") {
    return { kind: "slot", value: "number", slotKind: "number", regex: "\\d{3,}", values: [token] };
  }

  const url = token.match(/^(https?):\/\/([^\s/?#]+)([^\s?#]*)[^\s]*$/);
  if (url) {
    const scheme = url[1];
    const host = url[2];
    const path = url[3] || "";
    return {
      kind: "slot",
      value: `url:${host}${path}`,
      slotKind: "url",
      regex: `${escapeRegex(scheme)}://${escapeRegex(host)}${escapeRegex(path)}(?:\\?\\S{1,160})?`,
      values: [token],
    };
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    return { kind: "slot", value: "uuid", slotKind: "uuid", regex: "[0-9a-fA-F-]{36}", values: [token] };
  }
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(token)) {
    return { kind: "slot", value: "ip", slotKind: "ip", regex: "(?:\\d{1,3}\\.){3}\\d{1,3}", values: [token] };
  }
  if (/^[^\s@]{1,64}@[^\s@]{1,120}$/.test(token)) {
    return { kind: "slot", value: "email", slotKind: "email", regex: "[^\\s@]{1,64}@[^\\s@]{1,120}", values: [token] };
  }
  if (/^[0-9a-f]{16,}$/i.test(token)) {
    return { kind: "slot", value: "hex", slotKind: "hex", regex: "[0-9a-fA-F]{16,}", values: [token] };
  }
  if (/^\d{4}-\d{2}-\d{2}[T ][0-9:.Z+-]+$/.test(token)) {
    return { kind: "slot", value: "timestamp", slotKind: "timestamp", regex: "\\d{4}-\\d{2}-\\d{2}[T ][0-9:.Z+-]+", values: [token] };
  }
  if (/^[vV]?\d+(?:\.\d+){1,4}$/.test(token)) {
    return { kind: "slot", value: "version", slotKind: "version", regex: "[vV]?\\d+(?:\\.\\d+){1,4}", values: [token] };
  }
  if (/^\d{3,}$/.test(token)) {
    return { kind: "slot", value: "number", slotKind: "number", regex: "\\d{3,}", values: [token] };
  }
  if (/^\/[\w./-]{2,160}$/.test(token)) {
    return { kind: "slot", value: "path", slotKind: "path", regex: "\\/[\\w./-]{2,160}", values: [token] };
  }
  return null;
}

function tokenizeTemplate(pattern: string): TemplateToken[] {
  return normalizeCandidate(pattern).split(/\s+/).filter(Boolean).map((token) => {
    const volatile = classifyVolatileToken(token);
    return volatile ?? { kind: "constant", value: token, values: [token] };
  });
}

function stableSimilarity(cluster: CandidateCluster, tokens: TemplateToken[]): number {
  if (cluster.tokens.length !== tokens.length) return 0;
  let stable = 0;
  for (let i = 0; i < tokens.length; i++) {
    const a = cluster.tokens[i];
    const b = tokens[i];
    if (a.kind === "constant" && b.kind === "constant" && a.value === b.value) stable += 1;
    if (a.kind === "slot" && b.kind === "slot" && a.value === b.value) stable += 1;
    if (compactPrefix([...a.values, ...b.values])) stable += 1;
  }
  return stable / Math.max(tokens.length, 1);
}

function hasEnoughStableShape(cluster: CandidateCluster, tokens: TemplateToken[]): boolean {
  if (
    cluster.tokens.length === 1 &&
    tokens.length === 1 &&
    cluster.tokens[0].kind === "constant" &&
    tokens[0].kind === "constant" &&
    cluster.tokens[0].value === tokens[0].value
  ) {
    return true;
  }
  if (cluster.tokens.length === 1 && tokens.length === 1 && compactPrefix([...cluster.tokens[0].values, ...tokens[0].values])) {
    return true;
  }
  let stableConstants = 0;
  let stableTypedSlots = 0;
  for (let i = 0; i < tokens.length; i++) {
    const a = cluster.tokens[i];
    const b = tokens[i];
    if (a.kind === "constant" && b.kind === "constant" && a.value === b.value) stableConstants += 1;
    if (a.kind === "slot" && b.kind === "slot" && a.value === b.value) stableTypedSlots += 1;
  }
  return stableConstants >= 2 || (stableConstants >= 1 && stableTypedSlots >= 1);
}

function mergeTokens(cluster: CandidateCluster, tokens: TemplateToken[]): void {
  cluster.tokens = cluster.tokens.map((existing, index) => {
    const next = tokens[index];
    if (existing.kind === "constant" && next.kind === "constant" && existing.value === next.value) return existing;
    if (existing.kind === "slot" && next.kind === "slot" && existing.value === next.value) {
      return { ...existing, values: [...new Set([...existing.values, ...next.values])] };
    }
    const values = [...new Set([...existing.values, ...next.values])];
    const prefix = compactPrefix(values);
    if (prefix) {
      const maxSuffix = clamp(Math.max(...values.map((x) => x.length - prefix.length)) + 4, 4, 24);
      return {
        kind: "slot",
        value: `compact:${prefix}`,
        slotKind: "compact",
        regex: `${escapeRegex(prefix)}\\S{1,${maxSuffix}}`,
        values,
      };
    }
    const maxLen = clamp(Math.max(...values.map((x) => x.length)) + 16, 8, 80);
    return { kind: "slot", value: "word", slotKind: "word", regex: `\\S{1,${maxLen}}`, values };
  });
}

function regexFromTokens(tokens: TemplateToken[]): string | null {
  const slots = tokens.filter((token) => token.kind === "slot");
  if (slots.length > 4 || slots.length > Math.ceil(tokens.length * 0.4)) return null;
  if (tokens[0]?.kind !== "constant" && tokens[0]?.slotKind !== "compact") return null;
  const weakAttributionRegex = weakAttributionBrandRegex(tokens);
  if (weakAttributionRegex !== undefined) return weakAttributionRegex;
  return tokens.map((token) => token.kind === "constant" ? escapeRegex(token.value) : token.regex ?? "\\S{1,80}").join("\\s+");
}

function looksLikeOperationalNoise(text: string): boolean {
  return [
    /^Chunk ID:/i,
    /^Wall time:/i,
    /^Process exited with code/i,
    /^Exit code:/i,
    /^Original token count:/i,
    /^Total output lines:/i,
    /^Output:/i,
    /^Success\.\s+Updated the following files/i,
    /^Plan updated/i,
    /^build passed$/i,
    /^Records:\s+\d+/i,
    /^Truncated:\s+(?:yes|no)/i,
    /^repeat-<hex>/i,
    /^Ran\s+\S+\s+tests?\s+across/i,
    /^\(pass\)\s+/i,
    /^\$\s+/,
    /^Bundled\s+\d+\s+modules?\s+in/i,
    /^wrote\s+eval\/reports\//i,
    /\(entry point\)/i,
    /^Run:\s+`?/i,
    /^Expected:/i,
    /^Task\s+\d+:/i,
    /^Step\s+\d+:/i,
    /^(?:Create|Modify):\s+`?/i,
    /^REQUIRED SUB-SKILL:/i,
    /^git\s+(?:add|commit|status|diff|show|reset|checkout)\b/i,
    /^(?:bun|npm|node|pnpm|yarn)\s+/i,
    /^return\s+null;$/,
    /;\s*$/,
    /\bskill\b/i,
    /^Fresh\s+subagent\s+per\s+task/i,
    /^If\s+they\s+agree\s+to\s+the\s+companion/i,
    /真实\s+replay/i,
    /^Instructions\s+say\s+WHAT/i,
    /^If\s+Inline\s+Execution\s+chosen/i,
    /^Batch\s+execution\s+with\s+checkpoints/i,
    /^[MADRC]\s+[\w./-]+\.(?:md|ts|tsx|js|json)$/i,
    /^[\w./-]+\.(?:md|ts|tsx|js|mjs|json)$/i,
    /^[dl-][rwx-]{9}\s+/,
    /^[│├└─\s]+[\w.-]/,
    /(?:^|\s)(?:cwd|rollout_path)=/,
    /\/home\/[\w.-]+\//,
    /\|/,
    /[`*]{2,}/,
    /`[^`]+`/,
  ].some((pattern) => pattern.test(text));
}

function variableSlotSummary(tokens: TemplateToken[]): string[] {
  return tokens
    .map((token, index) => token.kind === "slot" ? `${index}:${token.slotKind ?? "word"}:${token.regex ?? "\\S{1,80}"}` : null)
    .filter((x): x is string => Boolean(x));
}

const weakAttributionTokens = new Set([
  "powered",
  "by",
  "provided",
  "via",
  "from",
  "source",
  "generated",
  "served",
]);

function hasOnlyWeakAttributionAnchor(tokens: TemplateToken[]): boolean {
  const hasVariableWordSlot = tokens.some((token) => token.kind === "slot" && token.slotKind === "word");
  if (!hasVariableWordSlot) return false;

  const constants = tokens
    .filter((token) => token.kind === "constant")
    .map((token) => token.value.toLowerCase());
  if (constants.length === 0) return false;

  return constants.every((token) => weakAttributionTokens.has(token));
}

function canonicalBrandValue(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/(?:站点|site)$/i, "")
    .replace(/[^a-z0-9\u3400-\u9fff]+/gi, "")
    .toLowerCase();
}

function weakAttributionBrandRegex(tokens: TemplateToken[]): string | null | undefined {
  if (!hasOnlyWeakAttributionAnchor(tokens)) return undefined;

  const wordSlots = tokens.filter((token) => token.kind === "slot" && token.slotKind === "word");
  if (wordSlots.length !== 1) return null;

  const slot = wordSlots[0];
  const canonicalValues = [...new Set(slot.values.map(canonicalBrandValue).filter(Boolean))];
  if (canonicalValues.length !== 1 || canonicalValues[0].length < 3) return null;

  const variants = [...new Set(slot.values)].sort((a, b) => b.length - a.length);
  const variantRegex = variants.length === 1
    ? escapeRegex(variants[0])
    : `(?:${variants.map(escapeRegex).join("|")})`;
  return tokens.map((token) => {
    if (token === slot) return variantRegex;
    return token.kind === "constant" ? escapeRegex(token.value) : token.regex ?? "\\S{1,80}";
  }).join("\\s+");
}

export function buildFormatFingerprint(patterns: string | string[]) {
  const inputs = Array.isArray(patterns) ? patterns : [patterns];
  const cluster: CandidateCluster = {
    count: 0,
    proposed: false,
    tokens: tokenizeTemplate(inputs[0] ?? ""),
    examples: [],
    observationIds: new Set<string>(),
  };
  for (const input of inputs) {
    const tokens = tokenizeTemplate(input);
    if (tokens.length !== cluster.tokens.length) continue;
    mergeTokens(cluster, tokens);
    cluster.examples.push(normalizeCandidate(input));
    cluster.count += 1;
  }
  const regex = regexFromTokens(cluster.tokens) ?? cluster.tokens.map((token) => escapeRegex(token.values[0] ?? token.value)).join("\\s+");
  return { type: "regex" as const, pattern: regex, note: "same host/session repeated 3 times" };
}

export function extractCandidatePatterns(text: string): string[] {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const selected = lines.length <= 8 ? lines : [...lines.slice(0, 3), ...lines.slice(-5)];
  const pieces = new Set<string>(selected);

  return [...pieces]
    .map(normalizeCandidate)
    .filter((x) => x.length >= 12 && x.length <= 200)
    .filter((x) => !/^\d+$/.test(x))
    .filter((x) => !/^[{\[]/.test(x))
    .filter((x) => !/^#{1,6}\s+/.test(x))
    .filter((x) => !/^\|.*\|$/.test(x))
    .filter((x) => !/^```/.test(x))
    .filter((x) => !looksLikeOperationalNoise(x))
    .filter((x) => !/^(?:import|export|const|let|var|function|interface|type|class)\s/.test(x))
    .filter((x) => !/^(?:expect|test|describe|it)\s*\(/.test(x))
    .filter((x) => !/^<\/?[a-z][^>]*>$/i.test(x))
    .filter((x, i, arr) => arr.indexOf(x) === i);
}

function scopeFor(input: CandidateObservation): string {
  return `${input.host}:${input.sessionId}:${input.channel}`;
}

function idFor(scope: string, pattern: string): string {
  return createHash("sha256").update(`${scope}:${pattern}`).digest("hex").slice(0, 16);
}

export function observeCandidatePattern(tracker: CandidateTracker, input: CandidateObservation): Suggestion | null {
  const scope = scopeFor(input);
  const clusters = tracker.clusters.get(scope) ?? [];
  tracker.clusters.set(scope, clusters);

  const tokens = tokenizeTemplate(input.pattern);
  let cluster = clusters.find((candidate) => stableSimilarity(candidate, tokens) >= 0.6 && hasEnoughStableShape(candidate, tokens));
  if (!cluster) {
    cluster = { count: 0, proposed: false, tokens, examples: [], observationIds: new Set<string>() };
    clusters.push(cluster);
    if (clusters.length > 100) clusters.shift();
  } else {
    mergeTokens(cluster, tokens);
  }
  if (input.observationId) {
    if (!cluster.observationIds.has(input.observationId)) {
      cluster.observationIds.add(input.observationId);
      cluster.count += 1;
    }
  } else {
    cluster.count += 1;
  }
  cluster.examples.push(normalizeCandidate(input.pattern));
  if (cluster.examples.length > 10) cluster.examples.shift();

  if (cluster.count >= 3 && !cluster.proposed) {
    const regex = regexFromTokens(cluster.tokens);
    if (!regex) return null;
    cluster.proposed = true;
    return {
      pattern: { id: `repeat-${idFor(scope, regex)}`, type: "regex", pattern: regex, note: "same host/session repeated 3 times" },
      reason: "同一 host/session/channel 内重复出现 3 次",
      evidence: {
        supportingExamples: [...cluster.examples],
        variableSlots: variableSlotSummary(cluster.tokens),
      },
    };
  }

  return null;
}

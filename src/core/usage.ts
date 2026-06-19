export interface StoredUsage {
  outputTokens?: number;
  visibleTextLength: number;
}

export function rememberUsage(store: Map<string, StoredUsage>, sessionId: string, usage: StoredUsage): void {
  store.set(sessionId, usage);
}

export function takePreviousUsage(store: Map<string, StoredUsage>, sessionId: string): StoredUsage | undefined {
  const value = store.get(sessionId);
  store.delete(sessionId);
  return value;
}

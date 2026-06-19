export function decideSuggestionTarget(approved: boolean): "positives" | "negatives" {
  return approved ? "positives" : "negatives";
}

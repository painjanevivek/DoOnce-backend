import type { LocatorCandidate, LocatorSpec } from "../contracts/protocol.js";

export interface LocatorRepairPlan { locator: LocatorSpec; confidence: number; rationale: string }

export function planLocatorRepair(oldLocator: LocatorSpec, candidates: readonly LocatorCandidate[]): LocatorRepairPlan | undefined {
  const old = [oldLocator.primary, ...oldLocator.fallbacks];
  const scored = dedupe(candidates).filter((candidate) => !old.some((item) => same(item, candidate))).map((candidate) => ({ candidate, score: score(candidate, old) })).sort((left, right) => right.score - left.score);
  if (scored.length === 1) scored[0]!.score = Math.min(1, scored[0]!.score + .18);
  const best = scored[0]; const second = scored[1];
  if (!best || best.score < .72 || (second && best.score - second.score < .12)) return undefined;
  const fallbacks = dedupe([...old, ...scored.slice(1, 4).map((item) => item.candidate)]).filter((candidate) => !same(candidate, best.candidate)).slice(0, 10);
  return { locator: { schemaVersion: 1, primary: best.candidate, fallbacks }, confidence: best.score, rationale: `Matched a unique ${best.candidate.strategy} candidate against the previous semantic locator evidence.` };
}

function score(candidate: LocatorCandidate, old: readonly LocatorCandidate[]): number {
  const similarity = Math.max(...old.map((item) => textSimilarity(candidate.value, item.value)));
  const strategy = old.some((item) => item.strategy === candidate.strategy) ? .14 : 0;
  const singleton = old.length > 0 ? .04 : 0;
  return Math.min(1, candidate.confidence * .45 + similarity * .37 + strategy + singleton);
}
function textSimilarity(left: string, right: string): number {
  const a = normalize(left); const b = normalize(right); if (a === b) return 1;
  const aTokens = new Set(a.split(" ").filter(Boolean)); const bTokens = new Set(b.split(" ").filter(Boolean));
  const overlap = [...aTokens].filter((token) => bTokens.has(token)).length; const union = new Set([...aTokens, ...bTokens]).size;
  const tokenScore = union ? overlap / union : 0; const prefix = a.startsWith(b) || b.startsWith(a) ? Math.min(a.length, b.length) / Math.max(a.length, b.length) : 0;
  return Math.max(tokenScore, prefix);
}
function normalize(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function same(left: LocatorCandidate, right: LocatorCandidate): boolean { return left.strategy === right.strategy && left.value === right.value; }
function dedupe(items: readonly LocatorCandidate[]): LocatorCandidate[] { const seen = new Set<string>(); return items.filter((item) => { const key = `${item.strategy}:${item.value}`; if (seen.has(key)) return false; seen.add(key); return true; }).map((item) => structuredClone(item)); }

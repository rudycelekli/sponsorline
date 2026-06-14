import { isAllowlisted } from "./interest.js";

// A closed boolean tree over allowlisted signal atoms. These four shapes are the
// ONLY things a campaign can express — no field access, no regex, no code — so a
// predicate cannot probe or exfiltrate raw context by construction.
export type TargetPredicate =
  | { atom: string }
  | { all: TargetPredicate[] }
  | { any: TargetPredicate[] }
  | { not: TargetPredicate };

const MAX_DEPTH = 16;
const MAX_NODES = 64;

// Evaluate the predicate against the device's interest vector. Pure, deterministic.
// `all([])` is true and `any([])` is false (standard boolean identities). Assumes a
// validated tree; unknown shapes evaluate to false rather than throwing.
export function evalPredicate(p: TargetPredicate, vector: Set<string>): boolean {
  if ("atom" in p) return vector.has(p.atom);
  if ("all" in p) return p.all.every((c) => evalPredicate(c, vector));
  if ("any" in p) return p.any.some((c) => evalPredicate(c, vector));
  if ("not" in p) return !evalPredicate(p.not, vector);
  return false;
}

export interface PredicateValidation {
  ok: boolean;
  errors: string[];
}

// The trust boundary for advertiser-submitted campaigns: rejects non-allowlisted
// atoms (privacy-taxonomy guard), malformed/unknown nodes, and oversized trees
// (bounded eval — a hostile campaign can't ship a pathological tree).
export function validatePredicate(p: TargetPredicate): PredicateValidation {
  const errors: string[] = [];
  let nodes = 0;

  function walk(node: unknown, depth: number): void {
    nodes++;
    if (depth > MAX_DEPTH) {
      errors.push(`predicate exceeds max depth ${MAX_DEPTH}`);
      return;
    }
    if (nodes > MAX_NODES) {
      errors.push(`predicate exceeds max node count ${MAX_NODES}`);
      return;
    }
    if (node === null || typeof node !== "object") {
      errors.push("predicate node must be an object");
      return;
    }
    const n = node as Record<string, unknown>;
    if ("atom" in n) {
      if (typeof n.atom !== "string") errors.push("atom must be a string");
      else if (!isAllowlisted(n.atom)) errors.push(`atom '${n.atom}' is not in the allowlist`);
      return;
    }
    if ("all" in n || "any" in n) {
      const arr = ("all" in n ? n.all : n.any) as unknown;
      if (!Array.isArray(arr)) {
        errors.push("all/any must be an array");
        return;
      }
      for (const c of arr) walk(c, depth + 1);
      return;
    }
    if ("not" in n) {
      walk(n.not, depth + 1);
      return;
    }
    errors.push("unknown predicate node shape");
  }

  walk(p, 0);
  return { ok: errors.length === 0, errors };
}

export const INTEREST_SCHEMA_VERSION = 1 as const;

export const ALLOWLIST = {
  prefixes: ["lang:", "framework:", "task:"] as const,
};

const TASK_CATEGORIES = ["build", "refactor", "debug", "test", "docs", "explore"] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export interface InterestVector {
  schemaVersion: typeof INTEREST_SCHEMA_VERSION;
  signals: string[]; // sorted, allowlisted, deduped
}

export interface InterestInput {
  manifests: string[];
  taskCategory: string;
  manifestContents?: Record<string, string>;
}

export function isAllowlisted(signal: string): boolean {
  return ALLOWLIST.prefixes.some((p) => signal.startsWith(p));
}

// framework detection: coarse, keyword-only, never stores raw content
const FRAMEWORK_KEYWORDS: Array<[RegExp, string]> = [
  [/\btorch\b/i, "framework:pytorch"],
  [/\btensorflow\b/i, "framework:tensorflow"],
  [/\breact\b/i, "framework:react"],
  [/\bclap\b/i, "framework:clap"],
];

export function buildInterestVector(input: InterestInput): InterestVector {
  const out = new Set<string>();
  const m = new Set(input.manifests.map((f) => f.toLowerCase()));

  if (m.has("package.json") || m.has("tsconfig.json")) out.add("lang:ts");
  if (m.has("requirements.txt") || m.has("pyproject.toml")) out.add("lang:py");
  if (m.has("cargo.toml")) out.add("lang:rust");
  if (m.has("go.mod")) out.add("lang:go");

  for (const [, content] of Object.entries(input.manifestContents ?? {})) {
    for (const [re, sig] of FRAMEWORK_KEYWORDS) {
      if (re.test(content)) out.add(sig);
    }
  }

  const cat = (TASK_CATEGORIES as readonly string[]).includes(input.taskCategory)
    ? input.taskCategory
    : "explore";
  out.add(`task:${cat}`);

  const signals = [...out].filter(isAllowlisted).sort();
  return { schemaVersion: INTEREST_SCHEMA_VERSION, signals };
}

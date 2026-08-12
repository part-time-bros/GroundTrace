/**
 * Best-effort static scan of a project's source.
 *
 * Two things are looked for, and neither pretends to be more than a heuristic:
 *
 *  - **tracked ids** (`data-truth-id="revenue"`, `useTruthValue(x, { id: "revenue" })`)
 *    so `verify` can report on values that were declared but never reported —
 *    the UNTRACED case. Without this, an id you forgot to wire up simply
 *    wouldn't appear in the report at all, which is the failure mode this whole
 *    tool exists to prevent.
 *
 *  - **fallback literals** — numbers inside constants named like `DEMO_FALLBACK`
 *    or `MOCK_DATA`. BUILD_SPEC §4 rule 3 asks for exactly this, and calls it
 *    "best-effort static check, not required to be perfect". It only ever
 *    upgrades an already-untraceable value to SYNTHETIC.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", ".git", "coverage"]);
const MAX_FILES = 2_000;

export interface ScanResult {
  files: number;
  trackedIds: string[];
  fallbackLiterals: number[];
}

/**
 * Numbers big enough to be data rather than layout.
 *
 * Inline literals are a much noisier signal than a `DEMO_FALLBACK` constant, so
 * the bar is higher: four or more digits, no decimal point, not a year. That
 * still catches the shape that matters — a placeholder total someone typed into
 * JSX and never replaced — while ignoring `flex: 1`, `z-index: 1000`, and 2026.
 */
const INLINE_MIN_DIGITS = 4;

const DATA_TRUTH_ID = /data-truth-id\s*=\s*["'{]?\s*["']([\w:.-]+)["']/g;
const TRUTH_META_ID = /\bid\s*:\s*["']([\w:.-]+)["']/g;
const TRUTH_CALL = /\buseTruthValue\s*\(|<Truth\b/;

/** Constants whose names announce that their contents are not real data. */
const FALLBACK_CONST =
  /\b(?:const|let|var)\s+([A-Z_0-9]*(?:FALLBACK|MOCK|STUB|PLACEHOLDER|DEMO|SAMPLE|DUMMY)[A-Z_0-9]*)\s*(?::[^=]+)?=\s*(\{[^}]*\}|\[[^\]]*\]|[\d_.]+)/g;

export function scanProject(cwd: string, dirs: string[]): ScanResult {
  const ids = new Set<string>();
  const literals = new Set<number>();
  let files = 0;

  for (const dir of dirs) {
    const root = resolve(cwd, dir);
    for (const file of walk(root)) {
      if (files >= MAX_FILES) break;
      files += 1;

      let source: string;
      try {
        source = readFileSync(file, "utf-8");
      } catch {
        continue;
      }

      for (const id of extractIds(source)) ids.add(id);
      for (const literal of extractFallbackLiterals(source)) literals.add(literal);
      for (const literal of extractInlineLiterals(source)) literals.add(literal);
    }
  }

  return {
    files,
    trackedIds: [...ids].sort(),
    fallbackLiterals: [...literals].sort((a, b) => a - b),
  };
}

export function extractIds(source: string): string[] {
  const ids: string[] = [];

  for (const match of source.matchAll(DATA_TRUTH_ID)) {
    if (match[1] !== undefined) ids.push(match[1]);
  }

  // `id:` is far too common a key to harvest blindly — only trust it in files
  // that actually call the SDK.
  if (TRUTH_CALL.test(source)) {
    for (const match of source.matchAll(TRUTH_META_ID)) {
      if (match[1] !== undefined) ids.push(match[1]);
    }
  }

  return ids;
}

export function extractFallbackLiterals(source: string): number[] {
  const literals: number[] = [];

  for (const match of source.matchAll(FALLBACK_CONST)) {
    const body = match[2];
    if (body === undefined) continue;
    for (const numeric of body.matchAll(/-?\d[\d_]*(?:\.\d+)?/g)) {
      const value = Number(numeric[0].replaceAll("_", ""));
      if (Number.isFinite(value)) literals.push(value);
    }
  }

  return literals;
}

/**
 * Large bare numbers written straight into JSX.
 *
 * The constant-name heuristic above misses the laziest placeholder of all —
 * `<div className="figure">184293</div>` — which is exactly the kind of thing
 * that survives to production because nothing ever queried anything.
 */
export function extractInlineLiterals(source: string): number[] {
  const literals: number[] = [];

  // Between a `>` and a `<`, i.e. JSX text content, or inside a `{...}` expression
  // that is nothing but a number.
  for (const match of source.matchAll(/>\s*(-?\d[\d_]*)\s*</g)) {
    pushIfDataLike(literals, match[1]);
  }
  for (const match of source.matchAll(/\{\s*(-?\d[\d_]*(?:\.\d+)?)\s*\}/g)) {
    pushIfDataLike(literals, match[1]);
  }

  return literals;
}

function pushIfDataLike(into: number[], raw: string | undefined): void {
  if (raw === undefined) return;
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length < INLINE_MIN_DIGITS) return;
  // Years read as data by digit count but essentially never are.
  const value = Number(raw.replaceAll("_", ""));
  if (!Number.isFinite(value)) return;
  if (Number.isInteger(value) && value >= 1_900 && value <= 2_100) return;
  into.push(value);
}

function* walk(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // A configured scan directory that doesn't exist is not an error.
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
    const full = join(dir, entry);

    let info;
    try {
      info = statSync(full);
    } catch {
      continue;
    }

    if (info.isDirectory()) {
      yield* walk(full);
    } else if (SOURCE_EXTENSIONS.has(extname(entry))) {
      yield full;
    }
  }
}

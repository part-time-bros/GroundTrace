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

/**
 * Production-safe mode (V2_SPEC §15).
 *
 * V1's loudest non-goal was "no production-safe mode", and it was the right
 * call at the time: a debugger that ships customers' revenue figures to a
 * collector is a data-exfiltration path wearing a tool's clothes.
 *
 * What makes production defensible is that the *signal* GroundTrace cares about
 * survives redaction. "This value came out of a catch block" needs the value's
 * shape and whether it changed — not its contents. So production mode records a
 * type, a length or magnitude bucket, and a short digest, and the classifier
 * keeps working on those.
 */

export type GroundTraceMode = "dev" | "production" | "off";

export interface SafetyOptions {
  mode?: GroundTraceMode;
  /** 0–1. Deterministic per trace id, so a trace is wholly in or wholly out. */
  sampleRate?: number;
  /** Redact recorded values. Defaults to true in production, false in dev. */
  redact?: boolean;
  /** Longest string kept verbatim in dev mode. */
  maxValueLength?: number;
}

export interface ResolvedSafety {
  mode: GroundTraceMode;
  enabled: boolean;
  sampleRate: number;
  redact: boolean;
  maxValueLength: number;
}

const DEFAULT_MAX_VALUE_LENGTH = 512;

/**
 * Resolves the effective safety settings.
 *
 * Production is **off unless explicitly enabled**: reaching production with
 * tracing silently live is the failure mode worth designing against, so the
 * default there is to record nothing.
 */
export function resolveSafety(options: SafetyOptions = {}): ResolvedSafety {
  const mode = options.mode ?? "dev";

  if (mode === "off") {
    return { mode, enabled: false, sampleRate: 0, redact: true, maxValueLength: 0 };
  }

  const redact = options.redact ?? mode === "production";
  const sampleRate = clamp(options.sampleRate ?? (mode === "production" ? 0 : 1));

  return {
    mode,
    enabled: sampleRate > 0,
    sampleRate,
    redact,
    maxValueLength: options.maxValueLength ?? DEFAULT_MAX_VALUE_LENGTH,
  };
}

function clamp(rate: number): number {
  if (!Number.isFinite(rate)) return 0;
  return Math.min(1, Math.max(0, rate));
}

/**
 * Decides whether a trace is sampled.
 *
 * Deterministic on the trace id so the client and the server independently
 * reach the same answer for the same request — a half-sampled trace would
 * produce a value with no source, which the classifier would correctly but
 * uselessly report as UNTRACED.
 */
export function isSampled(traceId: string, sampleRate: number): boolean {
  if (sampleRate >= 1) return true;
  if (sampleRate <= 0) return false;
  return hash(traceId) / 0xffff_ffff < sampleRate;
}

/** FNV-1a. Small, dependency-free, and stable across processes. */
export function hash(input: string): number {
  let value = 0x811c_9dc5;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 0x0100_0193) >>> 0;
  }
  return value >>> 0;
}

/** A redacted stand-in: enough to compare two values, not enough to read one. */
export interface RedactedValue {
  redacted: true;
  type: string;
  /** Short digest — equal digests mean equal values. */
  digest: string;
  /** Magnitude bucket for numbers, length for strings and arrays. */
  size?: number;
}

export function redactValue(value: unknown): RedactedValue {
  if (value === null) return { redacted: true, type: "null", digest: "null" };
  if (value === undefined)
    return { redacted: true, type: "undefined", digest: "undefined" };

  const type = Array.isArray(value) ? "array" : typeof value;
  const serialised = safeStringify(value);
  const digest = hash(serialised).toString(36);

  const base: RedactedValue = { redacted: true, type, digest };

  if (typeof value === "number") {
    // Order of magnitude, not the figure: enough to spot a fallback constant
    // sitting where a real total should be, useless as a data leak.
    return {
      ...base,
      size: value === 0 ? 0 : Math.floor(Math.log10(Math.abs(value))),
    };
  }
  if (typeof value === "string") return { ...base, size: value.length };
  if (Array.isArray(value)) return { ...base, size: value.length };

  return base;
}

/** Applies the resolved policy to one value. */
export function applySafety(value: unknown, safety: ResolvedSafety): unknown {
  if (safety.redact) return redactValue(value);

  if (typeof value === "string" && value.length > safety.maxValueLength) {
    return `${value.slice(0, safety.maxValueLength)}…`;
  }
  return value;
}

/** Redacts a whole `values` map in place of the original. */
export function applySafetyToValues(
  values: Record<string, unknown>,
  safety: ResolvedSafety,
): Record<string, unknown> {
  if (!safety.redact) return values;
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, redactValue(value)]),
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

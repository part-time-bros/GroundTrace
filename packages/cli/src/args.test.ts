import { describe, expect, it } from "vitest";
import { flagBool, flagNumber, flagString, parseArgs } from "./args.js";

describe("parseArgs", () => {
  it("reads the subcommand first", () => {
    expect(parseArgs(["verify"]).command).toBe("verify");
    expect(parseArgs([]).command).toBeUndefined();
  });

  it("keeps everything after `--` intact, flags included", () => {
    const args = parseArgs(["verify-tests", "--", "pytest", "-q", "--tb=short"]);
    expect(args.command).toBe("verify-tests");
    expect(args.passthrough).toEqual(["pytest", "-q", "--tb=short"]);
    expect(args.flags).toEqual({});
  });

  it("supports --flag=value and --flag value", () => {
    const args = parseArgs(["run", "--port=7777", "--cwd", "./examples/demo"]);
    expect(flagNumber(args, "port", 0)).toBe(7777);
    expect(flagString(args, "cwd")).toBe("./examples/demo");
  });

  it("treats a trailing --flag as a boolean", () => {
    const args = parseArgs(["verify", "--quiet"]);
    expect(flagBool(args, "quiet")).toBe(true);
    expect(flagBool(args, "loud")).toBe(false);
  });

  it("collects positionals after the subcommand", () => {
    const args = parseArgs(["report", "revenue", "customers"]);
    expect(args.positionals).toEqual(["revenue", "customers"]);
  });

  it("falls back when a flag is missing", () => {
    const args = parseArgs(["verify"]);
    expect(flagString(args, "id", "none")).toBe("none");
    expect(flagNumber(args, "port", 7777)).toBe(7777);
  });
});

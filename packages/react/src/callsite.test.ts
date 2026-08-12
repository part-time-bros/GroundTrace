import { describe, expect, it } from "vitest";
import { captureCallSite, prettifyFrame } from "./callsite.js";

const V8_BUNDLED = `Error
    at captureCallSite (webpack-internal:///./chunks/_08osfea._.js:596:24)
    at useTruthValue (webpack-internal:///./chunks/_08osfea._.js:640:31)
    at Metric (webpack-internal:///./components/Dashboard.tsx:104:19)
    at renderWithHooks (webpack-internal:///./node_modules/react-dom/cjs/react-dom.js:11121:18)`;

const FIREFOX = `captureCallSite@http://localhost:3000/chunks/sdk.js:596:24
useTruthValue@http://localhost:3000/chunks/sdk.js:640:31
Metric@http://localhost:3000/components/Dashboard.tsx:104:19`;

describe("captureCallSite", () => {
  it("skips GroundTrace's own frames even after bundling renames the file", () => {
    // The regression this guards: a path-based filter can't recognise
    // `_08osfea._.js` as ours, so the overlay reported `captureCallSite` as the
    // source of every tracked value.
    const site = captureCallSite(V8_BUNDLED);
    expect(site).toContain("Metric");
    expect(site).toContain("Dashboard.tsx:104");
    expect(site).not.toContain("captureCallSite");
    expect(site).not.toContain("useTruthValue");
  });

  it("skips React's internals too", () => {
    expect(captureCallSite(V8_BUNDLED)).not.toContain("renderWithHooks");
  });

  it("reads engines that omit the leading message line", () => {
    const site = captureCallSite(FIREFOX);
    expect(site).toContain("Metric");
    expect(site).toContain("Dashboard.tsx:104");
  });

  it("returns undefined when there is no stack at all", () => {
    expect(captureCallSite("")).toBeUndefined();
  });

  it("falls back to a real frame rather than nothing when everything looks internal", () => {
    const onlyOurs = `Error
    at captureCallSite (sdk.js:1:1)
    at useTruthValue (sdk.js:2:2)`;
    expect(captureCallSite(onlyOurs)).toBeTruthy();
  });

  it("captures the live stack when not given one", () => {
    expect(typeof captureCallSite()).toBe("string");
  });
});

describe("prettifyFrame", () => {
  it("drops the column and the bundler URL prefix", () => {
    expect(prettifyFrame("at Metric (webpack-internal:///./app/card.tsx:42:19)")).toBe(
      "Metric (card.tsx:42)",
    );
  });

  it("handles a frame with no function name", () => {
    expect(prettifyFrame("at /srv/app/card.tsx:42:19")).toBe("card.tsx:42");
  });

  it("ignores an anonymous marker", () => {
    expect(prettifyFrame("at <anonymous> (card.tsx:42:19)")).toBe("card.tsx:42");
  });
});

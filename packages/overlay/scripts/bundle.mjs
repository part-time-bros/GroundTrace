// Bundles the overlay into a single self-contained IIFE that the CLI can inject
// into any dev server's HTML with one <script src> tag — no module loader, no
// bare-specifier resolution, nothing for the host app's bundler to know about.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");

await build({
  entryPoints: [resolve(pkgRoot, "src/global.ts")],
  outfile: resolve(pkgRoot, "dist/overlay.global.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  minify: false,
  sourcemap: false,
  banner: {
    js: "/* GroundTrace overlay — dev mode only. https://github.com/part-time-bros/groundtrace */",
  },
});

console.log("built dist/overlay.global.js");

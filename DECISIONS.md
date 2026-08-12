# Decisions

One line per call made without spec guidance, newest last.

- **Node 22, not 24.** The build container ships Node v22.22.2 and no Node 24 toolchain; 22.x is still Active LTS and provides everything §2 needs (`AsyncLocalStorage`, `node:sqlite`). `engines` is set to `>=22.6.0`.
- **TypeScript 5.9, not 7.0.** TypeScript 7.0.2 is current stable, but `typescript-eslint@8` declares `typescript >=4.8.4 <6.1.0`, so linting would break on TS 7. Pinned to the latest 5.x until the lint toolchain catches up.
- **`docs/BUILD_SPEC.md`.** The spec shipped at the repo root but `CLAUDE.md` references `docs/BUILD_SPEC.md`; moved it there rather than editing every reference.
- **`tsc` for package builds, no bundler.** Only the browser overlay needs bundling (esbuild, one IIFE); everything else ships as plain ESM from `tsc`, which keeps `pnpm build` fast and dependency-light.
- **A fifth package, `packages/overlay`.** §5's overlay is framework-free DOM code that both the demo (imported as a module) and the CLI (served as a prebuilt IIFE for injection into arbitrary apps) need. Keeping it out of `@groundtrace/react` avoids forcing a React dependency on the CLI.

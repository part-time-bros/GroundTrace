# Repo presentation — what to paste where

GitHub's repository metadata isn't in the codebase, and there's no API token here with rights
to set it. Everything below is ready to copy into the settings UI. Five minutes, and it's the
difference between a repo that looks abandoned and one that looks maintained.

---

## 1. About (top-right of the repo page → ⚙️)

**Description** — 120 chars, leads with the verb, no filler:

```
Click a number in your app and see where it really came from — component → state → API → database, with fallbacks flagged.
```

**Website:** leave blank until there's a docs site. Pointing it at the repo itself is noise.

**Topics** — GitHub caps the useful set at around 10; these are the ones people actually
search, ordered by how likely they are to bring the right person here:

```
observability
debugging
developer-tools
react
nextjs
typescript
provenance
data-lineage
ai-agents
mcp
```

**Checkboxes:** tick *Releases* and *Packages* once you publish; until then untick both so the
sidebar doesn't show empty sections. Untick *Deployments*. Leave *Issues* on.

---

## 2. Social preview

Settings → General → Social preview → **Upload an image**.

Use [`docs/media/social-preview.png`](media/social-preview.png) — 1280×640, generated from
`scratchpad/social.html` in the same terminal aesthetic as the overlay. This is what renders
when the repo is linked on Slack, X, LinkedIn, or Discord. Without it those unfurls show a
grey generic card, which is the single most visible difference between a project that looks
cared-for and one that doesn't.

---

## 3. Settings worth changing

| Setting | Value | Why |
|---|---|---|
| Default branch | `main` | already is |
| Discussions | on | questions that aren't bugs shouldn't become issues |
| Wikis | off | docs live in `docs/`, two places rot |
| Projects | off | unless you're using one |
| Allow merge commits | off | keep history linear |
| Allow squash merging | on | one commit per PR |
| Auto-delete head branches | on | stops branch clutter |
| Require status checks | `build · test · lint` | CI already runs it; make it binding |

Branch protection on `main`: require the CI check to pass, and require a PR. Given this repo
is *about* not trusting unverified claims, an unprotected main is a slightly awkward look.

---

## 4. Once published to npm

Add to the README badge row (they'll 404 until the package exists, which is why they aren't
there now):

```markdown
[![npm](https://img.shields.io/npm/v/groundtrace.svg)](https://www.npmjs.com/package/groundtrace)
[![downloads](https://img.shields.io/npm/dm/groundtrace.svg)](https://www.npmjs.com/package/groundtrace)
```

Then remove the "Not published to npm yet" callout from the README's Install section and
restore the `npx groundtrace init` instructions — the CLI already works that way, it just
isn't registered.

---

## 5. Publishing to npm

Eight packages ship: `groundtrace` (the CLI, unscoped) and seven under `@groundtrace/*`.
All eight names were unregistered as of the last check — verify again right before you publish,
since a name can be taken at any time:

```bash
for n in groundtrace @groundtrace/core @groundtrace/node @groundtrace/react \
         @groundtrace/overlay @groundtrace/auto @groundtrace/vue @groundtrace/mcp; do
  npm view "$n" version 2>/dev/null && echo "TAKEN: $n" || echo "free:  $n"
done
```

### One-time setup

1. **npm account** with 2FA on (`npmjs.com/signup`). 2FA is required for publishing under
   most modern account settings and you want it regardless.
2. **Create the `groundtrace` organisation** at `npmjs.com/org/create`, free tier. This is the
   step people miss: `@groundtrace/*` is a *scope*, and a scope maps to either your username or
   an org. Without the org, all seven scoped packages fail with `404 Not Found — PUT` (npm's
   confusingly-worded "you don't own this scope").
   The unscoped `groundtrace` doesn't need it.
3. `npm login` — then confirm with `npm whoami`.

### Publishing

```bash
pnpm install --frozen-lockfile
pnpm build && pnpm test && pnpm lint && pnpm format:check   # green before anything ships

pnpm -r publish --dry-run     # prints exactly what would go out; nothing is uploaded
pnpm -r publish --otp=123456  # your authenticator code
```

`pnpm -r publish` handles the two things that make monorepo publishing fiddly:

- **Dependency order.** `@groundtrace/core` goes first, `groundtrace` after the three it
  depends on, `@groundtrace/mcp` last. You don't sequence it by hand.
- **`workspace:*` rewriting.** Each tarball's manifest gets the real version
  (`"@groundtrace/core": "0.1.0"`), not the workspace protocol. Verified by unpacking a real
  `pnpm pack` tarball — if this went out unrewritten, every install would break.

`publishConfig.access: "public"` is already set on all eight, so scoped packages publish
publicly rather than erroring on the paid-private path. `prepublishOnly` rebuilds each package,
so a stale `dist/` cannot ship; pnpm strips that script from the published manifest.

Skipping a package: add `"private": true` to it temporarily, or publish individually with
`pnpm --filter <name> publish`.

### After publishing

1. `git tag v0.1.0 && git push origin v0.1.0`
2. Cut a GitHub release, notes from `PROGRESS.md`'s phase log
3. Remove the "Not published to npm yet" callout from the README's Install section and restore
   `npx groundtrace init` — the CLI already works that way, it just wasn't registered
4. Add the npm badges from §4
5. `npm view groundtrace` to confirm what the registry actually has, rather than assuming the
   publish did what it said

### Optional: publish from CI with provenance

`npm publish --provenance` attaches a signed attestation linking the tarball to the exact
commit and workflow run that built it, and npm shows a "Built and signed on GitHub Actions"
badge. For a project whose entire argument is *don't trust a claim you can't trace*, publishing
unattested tarballs from a laptop is a slightly awkward look.

It needs a workflow with `permissions: id-token: write`, an `NPM_TOKEN` secret (automation
token, so it bypasses the interactive OTP), and `NPM_CONFIG_PROVENANCE=true`. Worth doing on
the second release; don't let it block the first.

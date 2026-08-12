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

## 5. Release checklist

1. `pnpm build && pnpm test && pnpm lint && pnpm format:check`
2. Bump versions across `packages/*/package.json` (all currently `0.1.0`)
3. `pnpm -r publish --access public`
4. Tag `v0.1.0`, write release notes from `PROGRESS.md`'s phase log
5. Update the README install section and add the npm badges above

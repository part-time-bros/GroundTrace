# groundtrace

The [GroundTrace](https://github.com/part-time-bros/groundtrace) CLI.

```bash
npx groundtrace init                    # scaffold config into an existing project
npx groundtrace run                     # app + collector + overlay, one command
npx groundtrace verify-tests -- pytest  # run a test command, report the real evidence
npx groundtrace verify                  # build + tests + provenance scan
npx groundtrace report --id revenue     # last run's tree for one value
```

```
GROUNDTRACE VERIFICATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Build            ✓
Tests            ✓  (12/12, see verify-tests log)
Tracked values   3
  Verified     2
  Fallback     1  ⚠ revenue (see: groundtrace report --id revenue)
Confidence       67%
```

Confidence is `(verified + indirect) / tracked` — simple and explainable on purpose. When
the app can't be reached, `verify` reports `not scanned` rather than a confidence number it
cannot back up.

`init --claude-code-hook` adds a `Stop` hook so Claude Code prints this after every task.

MIT

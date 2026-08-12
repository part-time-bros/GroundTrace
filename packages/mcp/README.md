# @groundtrace/mcp

[GroundTrace](https://github.com/part-time-bros/groundtrace) as MCP tools — so an agent can
check whether the numbers it just wired up are real *before* it says "Done ✅".

```bash
npx groundtrace init --mcp     # registers it in .mcp.json
```

| Tool | Does |
|---|---|
| `verify_app` | Builds, tests, and traces the app; returns the confidence report |
| `list_tracked_values` | Every tracked value with its status and reasoning |
| `explain_value` | One value's full component → state → API → database chain |
| `verify_tests` | Runs a test command and reports the real evidence |
| `last_report` | The saved report, without re-running anything |

Every result carries the same plain-English `reason` the CLI prints. An agent handed
"confidence 67%" with no explanation is exactly the opacity this project exists to remove —
so `explain_value` returns the tree, and `verify_app` says when a scan verified only the
server side rather than a real render.

With no saved report, the read-only tools return an error telling the agent to run
`verify_app` first, rather than an empty result it could mistake for a pass.

Runs over stdio: `groundtrace-mcp --cwd /path/to/project`.

MIT

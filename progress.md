# gemma-plugin — Progress

*Generated: 2026-04-07*

**Phase:** First real use + first bug fix
**Last activity:** 2026-04-07 12:06 UTC (PR #1 merged)
**Repo:** `afarrell/gemma-plugin` (private)

## Where we are

Fresh plugin — initial commit 2026-04-05, first real usage 2026-04-07. This session's `/gemma:rescue` invocation on the plugin's own source (asking gemma4 to critique the gemma plugin) uncovered three bugs in the companion runtime plus a confabulation failure mode in gemma4:26b that has no technical fix but is now documented as a marker-test debugging pattern in the gemma-prompting skill.

The bugs were caught because the test was self-referential: using the plugin to review the plugin stressed the `--files` resolver (trying to feed the full source tree to the review), the error reporting (when things failed), and the model's tolerance for large context (~38KB on a 32K `num_ctx` window). Good first-use smoke test.

## Key decisions

### Zero-dependency stance preserved

Used Node 22+'s built-in `fs.globSync` instead of adding `globby` / `fast-glob` / `minimatch` as a dependency. Small recursive `expandBraces()` helper handles `{a,b,c}` expansion that `globSync` itself doesn't. Net: one script file, no `package.json`, no `node_modules`, same capabilities as the dep-heavy alternatives.

### Confabulation is a model limitation, not a bug to fix

gemma4:26b confabulates "no code attached" or "please paste the code" even when context IS in its prompt, especially near its effective context ceiling. Rough reliability boundaries observed on Apple Silicon M-series with 17GB MoE runner at 100% GPU:

- ~20-25KB of context: reliable
- ~30KB: still reliable
- ~32-38KB: silent fetch failures, confabulation
- ~40KB+: consistently fails

This is well below the nominal 32K `num_ctx`. Can't be patched in the companion — documented as a required marker-test step in `gemma-prompting/SKILL.md` so callers can distinguish confabulation from mechanism failure in 3 seconds.

### Fail-loud error reporting over single-line diagnostics

The previous `invokeOllama` error handler printed only `Error contacting Ollama at HOST: fetch failed`. This made every failure look identical — server down, request body too large, connection reset mid-inference, timeout all produced the same output. The new handler surfaces `err.name`, `err.message`, `err.cause.code`, and dispatches on error class:

- `ECONNREFUSED` → "server not running, try brew services start ollama"
- `ECONNRESET` → "server reset mid-request, often means Ollama crashed on a large prompt, check `ollama ps`"
- `AbortError` / `TimeoutError` → "timed out after Ns, try smaller context or faster model"
- Default → "check `brew services list`, `curl /api/tags`, `ollama ps` to triangulate"

### stderr logging on context receipt

Callers now see `--files: read N files (M bytes)` and `stdin: read N bytes of piped context` on every run. Cheap verification that the resolver saw what the caller expected without running a full marker test. Removes a whole class of "did my glob match anything?" debugging.

### The marker-test pattern is the canonical gemma debug step

Added to `gemma-prompting/SKILL.md` as a new "Verify context received" section. The pattern:

```bash
echo "MARKER_XYZZY_12345" | node gemma-companion.mjs task \
  "What EXACT string did I send? Reply with just the string, nothing else."
```

3 seconds to run, definitively isolates mechanism bugs from model confabulation. If the marker comes back, any subsequent "no code attached" is confabulation — tell gemma explicitly or ask it to quote specific lines. If the marker doesn't come back, the pipeline is genuinely broken — check `--files` glob expansion, stdin TTY detection, or the stderr `--files: read N files` diagnostic line.

## What's shipped

| PR | Commit | Description |
|---|---|---|
| [#1](https://github.com/afarrell/gemma-plugin/pull/1) | `d6d8f05` | `--files` glob rewrite with `fs.globSync` + brace expansion, stderr context-receipt logging, `invokeOllama` error reporting with `err.cause` + tailored hints, gemma-prompting "Verify context received" section |

Validated on three glob patterns against the plugin's own source:

| Pattern | Files matched | Bytes |
|---|---|---|
| `plugin.{json,md}` (brace) | 1 | 332 |
| `**/*.md` (globstar) | 8 | 20018 |
| Explicit space-separated list | 2 | 3539 |

## What's next

- **Regression test: run `/gemma:rescue` on the plugin again.** After the fix, the brace + `**` globs that failed earlier today should work. Proves the fix holds end-to-end.
- **Add basic CI to this repo.** Currently zero CI — no version-bump check, no plugin-structure validation, no semgrep. The shell-injection catch in `claude-toolkit`'s self-merge pipeline PR earlier today shows how valuable semgrep-on-PR is; gemma-plugin would benefit from the same. Scope: copy `ci.yml` from `afarrell/claude-toolkit` and adapt paths.
- **Consider a self-merge pipeline** (same pattern as `claude-toolkit` PR #6) once CI exists. Same file surface, same safety clamps, smaller repo so lower risk. Depends on the verdict-mechanism fix (`td-9df862`) landing first in claude-toolkit — the pattern's weak link right now is Claude not writing the verdict file reliably.
- **Watch for the fix's effect on gemma4 confabulation.** The marker-test pattern is a workaround, not a cure. If gemma4:26b continues confabulating even with explicit "the content IS in your context" framing, the reliable ceiling may be lower than 30KB — worth narrowing `--files` patterns aggressively.
- **Token rotation: `SUPABASE_REFRESH_TOKEN` for second-brain MCP** expired mid-session today. 3 earlier captures succeeded, 6 later captures are queued in `~/notes/sb-pending-captures.md` awaiting retry. Recovery: Apple Sign-In at the Supabase project URL, then `security add-generic-password -s "SUPABASE_REFRESH_TOKEN" -a "second-brain" -w "<token>"`. Not specific to gemma-plugin but blocks SB capture for any ongoing work.

## Related artifacts

- `recurring-errors.md` (global memory) — 3 new entries for this session: gemma-companion --files glob limits, gemma4 confabulating "no code", subagent debugging opacity
- `improvement-log.md` (global memory) — logged the rule violation (guessed glob syntax instead of grepping the source per `rules/cli-docs-chub.md`, **second violation in 4 sessions**) with review-by 2026-05-07
- `improve-runs.md` (global memory) — Reflect run logged for 2026-04-07
- `~/notes/sb-pending-captures.md` — 6 captures queued for retry on next SB contact

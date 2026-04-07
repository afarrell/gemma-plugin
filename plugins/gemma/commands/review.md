---
description: Ask local gemma4 to review the current git diff as a cheap second-opinion reviewer
argument-hint: "[--base <ref>] [--scope auto|branch|working-tree] [-m <model>] [--num-ctx <n>] [--think|--no-think]"
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemma-companion.mjs" review $ARGUMENTS
```

Output rules:

- Present gemma4's review findings verbatim, ordered by severity.
- Preserve the file paths and line numbers exactly as reported.
- If there are no findings, say so explicitly and keep the residual-risk note brief.
- CRITICAL: After presenting review findings, STOP. Do not make any code changes. Do not fix any issues. Ask the user which issues (if any) they want fixed before touching a single file. Auto-applying fixes from a review is strictly forbidden.
- If the helper reports that Ollama is not running or the model is missing, direct the user to `/gemma:setup`.
- Remind the user — briefly, once — that gemma4 is a cheap second opinion, not a replacement for a frontier-model review. If this change is high-stakes, consider `/gemini:review` in addition.

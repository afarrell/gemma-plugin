---
description: Ask local gemma4 to adversarially challenge the current git diff — design, assumptions, tradeoffs, and failure modes
argument-hint: "[--base <ref>] [--scope auto|branch|working-tree] [-m <model>] [--num-ctx <n>] [--think|--no-think] [additional focus]"
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemma-companion.mjs" adversarial-review $ARGUMENTS
```

Model selection:

- The companion auto-prefers `gemma4:31b` (dense) for `adversarial-review` when it's installed — challenging design choices benefits materially from deeper reasoning. Falls back to `gemma4:26b` (MoE) if 31b isn't pulled.
- If the diff is large and 31b feels slow, pass `-m moe` to force 26b.
- The chosen model is logged to stderr; surface it if the user asks what ran.

Output rules:

- Present gemma4's adversarial concerns verbatim.
- Preserve the structure: Design Challenges, Assumption Risks, Verdict.
- Preserve evidence boundaries — if gemma4 marked something as a hypothesis or open question, keep that distinction.
- CRITICAL: After presenting concerns, STOP. Do not make any code changes. Ask the user which (if any) challenges are worth acting on before touching a single file.
- If the helper reports that Ollama is not running or the model is missing, direct the user to `/gemma:setup`.
- gemma4 is Haiku-tier: treat its adversarial critiques as prompts for your own thinking, not as authoritative judgments. If the change is high-stakes, escalate to `/gemini:adversarial-review`.

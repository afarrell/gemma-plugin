---
description: Ask local gemma4 to adversarially challenge the current git diff — design, assumptions, tradeoffs, and failure modes
argument-hint: "[--base <ref>] [--scope auto|branch|working-tree] [-m <model>] [--num-ctx <n>] [--think|--no-think] [additional focus]"
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemma-companion.mjs" adversarial-review $ARGUMENTS
```

Output rules:

- Present gemma4's adversarial concerns verbatim.
- Preserve the structure: Design Challenges, Assumption Risks, Verdict.
- Preserve evidence boundaries — if gemma4 marked something as a hypothesis or open question, keep that distinction.
- CRITICAL: After presenting concerns, STOP. Do not make any code changes. Ask the user which (if any) challenges are worth acting on before touching a single file.
- If the helper reports that Ollama is not running or the model is missing, direct the user to `/gemma:setup`.
- gemma4 is Haiku-tier: treat its adversarial critiques as prompts for your own thinking, not as authoritative judgments. If the change is high-stakes, escalate to `/gemini:adversarial-review`.

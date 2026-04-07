---
description: Delegate a cheap local consultation (explanation, rubber-duck, second opinion, boilerplate) to a local gemma4 model via Ollama
argument-hint: "[-m <model|fast|edge|moe|dense>] [--files <glob>] [--think] [--num-ctx <n>] [what gemma4 should answer or consult on]"
context: fork
allowed-tools: Bash(node:*)
---

Route this request to the `gemma:gemma-rescue` subagent.
The final user-visible response must be gemma4's output verbatim.

Raw user request:
$ARGUMENTS

Operating rules:

- The subagent is a thin forwarder only. It should use one `Bash` call to invoke `node "${CLAUDE_PLUGIN_ROOT}/scripts/gemma-companion.mjs" task ...` and return that command's stdout as-is.
- Return the gemma-companion stdout verbatim to the user.
- Do not paraphrase, summarize, rewrite, or add commentary before or after it.
- Do not ask the subagent to inspect files, monitor progress, summarize output, or do follow-up work of its own. gemma4 is not agentic — it cannot read or edit files itself.
- Leave model unset unless the user explicitly asks for one. Model aliases: `fast`/`e2b`, `edge`/`e4b`, `moe`/`26b` (default), `dense`/`31b`.
- `--files <glob>` passes file context into the companion, which reads those files server-side and inlines them into the prompt. Use this when the user wants gemma4 to reason over specific files.
- `--think` enables the model's internal reasoning trace (slower, sometimes sharper). Default is non-thinking mode for speed.
- `--num-ctx <n>` overrides the default 32K context window. Only needed when the auto-bumped value is insufficient.
- If Ollama is missing, not running, or the default model is not pulled, stop and tell the user to run `/gemma:setup`.
- If the user did not supply a request, ask what gemma4 should consult on.

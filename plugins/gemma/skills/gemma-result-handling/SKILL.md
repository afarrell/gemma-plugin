---
name: gemma-result-handling
description: Internal guidance for presenting gemma-companion output back to the user
user-invocable: false
---

# Gemma Result Handling

When the helper returns gemma4 output:

- Preserve the helper's structure — verdict, findings, next steps — exactly as returned.
- For review output, present findings first and keep them ordered by severity.
- Use file paths and line numbers exactly as the helper reports them.
- Preserve evidence boundaries. If gemma4 marked something as an inference, uncertainty, or open question, keep that distinction. Do not upgrade a hedged statement to a confident claim.
- If gemma4 said "I'm guessing" or flagged uncertainty in a trailing line, surface that prominently — it is the most important signal for the user.
- If there are no findings, say so explicitly and keep the residual-risk note brief.

For `gemma:gemma-rescue`:
- Return gemma4's output verbatim. Do not paraphrase, summarize, or add commentary.
- If the Bash call failed or Ollama returned nothing, do NOT generate a substitute answer. Report the failure and stop.
- Never turn a failed or incomplete gemma4 run into a Claude-side implementation attempt.

For `/gemma:review` and `/gemma:adversarial-review`:
- CRITICAL: After presenting findings, STOP. Do not make any code changes. Do not fix any issues. You MUST explicitly ask the user which issues (if any) they want fixed before touching a single file. Auto-applying fixes from a review is strictly forbidden, even if the fix is obvious.
- Remind the user (briefly, once) that gemma4 is a cheap second opinion, not a replacement for a frontier-model review. If the change is high-stakes, recommend `/gemini:review` in addition.

Failure modes and remediation:

- **Server not running:** Direct the user to `/gemma:setup` and stop. Do not improvise alternate invocation paths.
- **Model not pulled:** Direct the user to `/gemma:setup` — the setup command handles pulling. Do not run `ollama pull` yourself from other commands.
- **Context exceeded:** The helper warns on stderr when estimated context is large. If gemma4's response is truncated or incoherent, suggest scoping with `--files` or switching to a different variant.
- **Malformed output:** If the helper reports a non-zero exit or the output is clearly garbage, include the most actionable stderr lines in your report to the user and stop there instead of guessing.
- **Hallucination suspected:** If gemma4's answer references code, files, or APIs that are not visible in the provided context, surface that as a warning and recommend the user verify against the actual source before acting.

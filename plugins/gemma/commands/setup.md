---
description: Check whether Ollama is ready and the default gemma4 model is pulled
argument-hint: '[--json]'
allowed-tools: Bash(node:*), Bash(brew:*), Bash(ollama:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemma-companion.mjs" setup --json $ARGUMENTS
```

Interpret the JSON and decide on follow-ups:

1. **If `available` is false** (Ollama is not installed) and `brew` is available:
   - Use `AskUserQuestion` exactly once to ask whether Claude should install Ollama now.
   - Options (install first, suffixed with `(Recommended)`):
     - `Install Ollama via Homebrew (Recommended)`
     - `Skip for now`
   - If the user chooses install, run:

```bash
brew install ollama && brew services start ollama
```

2. **If `server.alive` is false** (Ollama is installed but the server is not running):
   - Offer to start it. Run:

```bash
brew services start ollama
```

3. **If `defaultModelPulled` is false** (server is up but `gemma4:26b` is missing):
   - Use `AskUserQuestion` to ask whether Claude should pull the model now.
   - Options (default / review-heavy / lean / skip):
     - `Pull gemma4:26b (~17 GB, Recommended — balanced default for 'task')`
     - `Pull gemma4:31b (~20 GB, dense — auto-preferred for 'review' and 'adversarial-review')`
     - `Pull a smaller variant (e4b ~9.6 GB, fast but weaker)`
     - `Skip for now`
   - If they pick 26b:

```bash
ollama pull gemma4:26b
```

   - If they pick 31b:

```bash
ollama pull gemma4:31b
```

   - If they pick the smaller variant:

```bash
ollama pull gemma4:e4b
```

4. **If the default is pulled but `gemma4:31b` isn't, AND the user runs `/gemma:review` or `/gemma:adversarial-review` often:** offer to pull 31b as an upgrade. The companion will auto-pick 31b for those subcommands when installed, materially improving review quality. This is optional — 26b alone is functional.

```bash
ollama pull gemma4:31b
```

5. **After any action**, re-run the setup check:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemma-companion.mjs" setup --json
```

Output rules:

- Present the final setup output to the user.
- If any step was skipped, present the original setup output and clearly list what still needs to happen.
- Emphasize that gemma runs fully locally — no auth, no API keys, no quota.
- If the server is not running after a start attempt, direct the user to check `brew services list | grep ollama` and `~/Library/LaunchAgents/homebrew.mxcl.ollama.plist`.

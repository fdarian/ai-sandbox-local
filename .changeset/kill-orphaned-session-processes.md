---
"ai-sandbox-local": patch
---

`stop()` and `destroy()` now also kill session processes that were already orphaned (reparented to PID 1), such as `opencode serve` after the OpenCode adapter's bridge exits. Every process started through a session carries an `AI_SANDBOX_LOCAL_SESSION_ID` environment variable, which `stop()` uses to find them.

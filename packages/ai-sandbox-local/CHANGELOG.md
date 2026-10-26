# ai-sandbox-local

## 0.1.1

### Patch Changes

- b54ad07: `stop()` and `destroy()` now also kill session processes that were already orphaned (reparented to PID 1), such as `opencode serve` after the OpenCode adapter's bridge exits. Every process started through a session carries an `AI_SANDBOX_LOCAL_SESSION_ID` environment variable, which `stop()` uses to find them.

## 0.1.0

### Minor Changes

- f921058: Default the sandbox `HOME` to a directory under the OS temp dir, overridable with `homeDirectory`, so harness state no longer lands in your real home.
- 2854568: Initial release: run AI SDK harness agents against your local filesystem and processes.

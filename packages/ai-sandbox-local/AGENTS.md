# ai-sandbox-local

`HarnessV1SandboxProvider` for AI SDK's `HarnessAgent` (`@ai-sdk/harness`), implemented over `node:child_process` + `node:fs`. The shipped providers can't run a coding CLI against a real checkout: `@ai-sdk/sandbox-vercel` is remote-only and `@ai-sdk/sandbox-just-bash` is a JS bash over an in-memory filesystem. Sessions here act directly on disk, with no isolation. Mirrors the structure of `@ai-sdk/sandbox-just-bash`'s source, with real primitives swapped in.

## Stack

- ESM library built with tsdown (`dist/`, dts via rolldown-plugin-dts), `bun test`, `tsc --noEmit`, Biome
- `@ai-sdk/harness` and `@ai-sdk/provider-utils` are peer dependencies (their types cross the API); no runtime deps
- Internal imports use `#src/*` with explicit `.ts` extensions

## Dev

- `pnpm test` — `bun test` (tests live in `test/`, import from `#src/*`)
- `pnpm check:type` / `pnpm check:lint` / `pnpm build`

## Architecture

- `src/local-sandbox-session.ts` — `LocalSandboxSession`, the plain `Experimental_SandboxSession`: file I/O via `node:fs/promises`, `run`/`spawn` via `/bin/bash -c`. This is what `restricted()` returns.
- `src/local-network-sandbox-session.ts` — `LocalNetworkSandboxSession` adds `id`, `defaultWorkingDirectory`, `ports`, `getPortUrl`/`getPortEndpoint`, `stop`/`destroy`, `restricted`. `stop` kills every process in the session's `ProcessRegistry` and all of their current descendants and releases its port; it never touches the directory, which is the user's real checkout.
- `src/create-local-sandbox-session.ts` — `createLocalSandboxSession`: resolves and `mkdir -p`s `workingDirectory`, leases a port, returns a `LocalNetworkSandboxSession`. The primary entry point, for `agent.createSession({ sandboxSession })`; the agent never calls `onFirstCreate` on that path.
- `src/local-sandbox-provider.ts` — `LocalSandboxProvider` and `createLocalSandboxProvider`, for the deprecated `HarnessAgent({ sandbox })` path. `createSession` delegates to `createLocalSandboxSession`, then runs `onFirstCreate` on `restricted()` and stops the session if it throws.
- `src/port.ts` — `allocatePort`/`releasePort`: finds a free loopback port and leases it from an in-process registry so concurrent `createSession()` calls never share one.
- `src/process-registry.ts` — `ProcessRegistry`, internal. `LocalSandboxSession.startShell` registers every `run`/`spawn` child and drops it on `close`; the network session hands the same registry to each `restricted()` view, so `stop` reaches the harness's bridge (spawned through `restricted()`) and in-flight `run`s.
- `src/kill-process-tree.ts` — `SIGTERM`s a child and all its current descendants. Used by `ProcessRegistry.killAll`, `SandboxProcess.kill()` and the abort path; killing only the direct `/bin/bash -c` child would leave the bridge's CLI server running, reparented to PID 1.
- `src/sandbox-process.ts` — wraps a `ChildProcess` as `Experimental_SandboxProcess`; shared by `run` and `spawn`. Handles `abortSignal` itself (not via `spawn`'s `signal` option) so aborting kills the child's current descendants too.
- `src/stream-utils.ts` — stream/bytes glue for the stream-shaped `readFile`/`writeFile`.

## Non-obvious decisions

- **`resumeSession` is omitted.** A resumed session would have to reattach to a live bridge process, but spawned processes are ordinary children of the host and exit with it. Reattaching would hand back a session whose port nothing listens on, failing deep inside the adapter's WebSocket handshake. Omitting the method makes the framework raise `HarnessCapabilityUnsupportedError('resume')` itself.
- **`setNetworkPolicy`/`setPorts` are omitted.** No local primitive enforces outbound policy, and every port is already leased per session by `allocatePort`.
- **`getPortUrl`/`getPortEndpoint` ignore whether anything is bound.** They always resolve to `<protocol>://127.0.0.1:<port>`; the package only reserves the number, and the adapter's own spawned bridge binds it. `sandboxSession.ports` must be non-empty before the claude-code adapter starts (it reads `ports[0]`), which is why `createSession` always leases one.
- **`PATH` is inherited from `process.env` untouched.** Callers fix a bare GUI-app `PATH` through the `env` option. A terminal-launched `bun run` hides this: it prepends a `node` shim directory to children's `PATH`, a compiled binary does not. Verify `PATH`-sensitive changes under `PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`.
- **`env` precedence** is pnpm build-approval defaults, then `process.env`, then `{ HOME: homeDirectory }`, then the `env` option, then the per-call `env`. `createLocalSandboxSession` folds `HOME` into the session's `env`, so `restricted()` views carry it. `env.HOME` still beats `homeDirectory`; `homeDirectory` is the documented way.
- **`HOME` defaults to `<os.tmpdir()>/ai-sandbox-local/home`, not the real home.** The harness puts all its state under the sandbox's `$HOME` and has no other knob, so this keeps it out of the user's home. It is shared across sessions and working directories deliberately, so the ~20s first-run CLI install stays warm; the OS clearing tmpdir only costs a slow first run. The trade-off is that anything the agent runs that reads `HOME` (`~/.gitconfig`, `~/.ssh`, CLI logins) doesn't see the user's dotfiles; `homeDirectory: os.homedir()` opts out (pi keeps its session journal under `$HOME`, so hosts may want a persistent one).
- **`run`/`spawn` inject pnpm's `dangerouslyAllowAllBuilds` env override** (all three spellings, `PNPM_BUILD_APPROVAL_ENV`). pnpm ≥10 blocks dependency build scripts behind an interactive `pnpm approve-builds`, which a harness's first-run CLI install trips on with no TTY to answer. Env works regardless of the bootstrap path, which the package doesn't choose. A `pnpm-workspace.yaml`/`.npmrc` allowlist was rejected: it would need that path, and pnpm ≥11 renamed the config keys (`onlyBuiltDependencies` to `allowBuilds`), so a file would silently stop working. Applying it to every call is safe because only the framework's bootstrap and the one bridge spawn go through this session; the agent's own work happens inside that process tree.
- **No relocation, no repo symlink.** Since `@ai-sdk/harness@1.0.123`, all bootstrap state (pinned CLI installs, `.bootstrap-*.ok` markers, bridge state, skills) lives under the sandbox's `$HOME/.ai-sdk-harness` (`harnessStateDirectoryPath`, resolved by running `printf "$HOME"` in the sandbox), never under `defaultWorkingDirectory`. So pointing `workingDirectory` at the user's repo can't make a bootstrap `pnpm install` run inside their pnpm workspace, and there is nothing to relocate or clean up. The sandbox's `HOME` (`homeDirectory`) decides where that state goes.
- **Callers pass `sandboxConfig: { workDir: '.' }`** (harness ≥ 1.0.129). That makes the agent's directory `defaultWorkingDirectory` itself, i.e. `workingDirectory`. Omitting it makes the framework use `<defaultWorkingDirectory>/<harnessId>-<sessionId>`, a fresh empty subdirectory, which is not the checkout. An absolute `workDir` throws in `HarnessAgent`.

## Gotchas

- Children are deliberately not `detached`: a process group of their own would catch orphans reparented to PID 1 (e.g. the OpenCode adapter's `opencode serve` after its bridge exits), but would stop terminal Ctrl+C reaching them. Instead `killProcessTree` snapshots the process table with `ps` and collects descendants *before* signalling anything, since the first kill reparents grandchildren to PID 1 and loses them. A process already reparented before `stop` is unreachable. If `ps` fails it throws.

- `run`'s stdout/stderr must be drained through the same wrapper `spawn` uses (`toSandboxProcess` + `collectStream`). A second `'data'` listener on the raw streams races `Readable.toWeb` and starves whichever loses.
- A process killed by `kill()` or an aborted signal reports `128 + signum` as `exitCode`, the value the shell reports as `$?`.
- Cold `createSession()` for a bootstrapping harness is slow (measured ~13-28s: clone + `pnpm install` of the CLI) versus ~0.3-0.8s warm (marker present). UIs should say why it's slow rather than show a bare spinner.

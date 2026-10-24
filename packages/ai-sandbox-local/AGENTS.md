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
- `src/local-network-sandbox-session.ts` — `LocalNetworkSandboxSession` adds `id`, `defaultWorkingDirectory`, `ports`, `getPortUrl`/`getPortEndpoint`, `stop`/`destroy`, `restricted`. `stop` kills processes this session spawned and releases its port; it never touches the directory, which is the user's real checkout.
- `src/local-sandbox-provider.ts` — `LocalSandboxProvider` and `createLocalSandbox`. One provider per `defaultWorkingDirectory`.
- `src/port.ts` — `allocatePort`/`releasePort`: finds a free loopback port and leases it from an in-process registry so concurrent `createSession()` calls never share one.
- `src/sandbox-process.ts` — wraps a `ChildProcess` as `Experimental_SandboxProcess`; shared by `run` and `spawn`.
- `src/stale-bootstrap.ts` — deletes `.bootstrap-*.ok` markers whose bootstrap dir lost its `node_modules`, so the framework reinstalls instead of trusting a marker.
- `src/stream-utils.ts` — stream/bytes glue for the stream-shaped `readFile`/`writeFile`.

## Non-obvious decisions

- **`resumeSession` is omitted.** A resumed session would have to reattach to a live bridge process, but spawned processes are ordinary children of the host and exit with it. Reattaching would hand back a session whose port nothing listens on, failing deep inside the adapter's WebSocket handshake. Omitting the method makes the framework raise `HarnessCapabilityUnsupportedError('resume')` itself.
- **`setNetworkPolicy`/`setPorts` are omitted.** No local primitive enforces outbound policy, and every port is already leased per session by `allocatePort`.
- **`getPortUrl`/`getPortEndpoint` ignore whether anything is bound.** They always resolve to `<protocol>://127.0.0.1:<port>`; the package only reserves the number, and the adapter's own spawned bridge binds it. `sandboxSession.ports` must be non-empty before the claude-code adapter starts (it reads `ports[0]`), which is why `createSession` always leases one.
- **`PATH` is inherited from `process.env` untouched.** Callers fix a bare GUI-app `PATH` through `LocalSandboxSettings.env`. A terminal-launched `bun run` hides this: it prepends a `node` shim directory to children's `PATH`, a compiled binary does not. Verify `PATH`-sensitive changes under `PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`.
- **`env` precedence** is pnpm build-approval defaults, then `process.env`, then `LocalSandboxSettings.env`, then the per-call `env`. `restricted()` sessions carry it. It exists so a host can point `HOME` at persistent storage (pi keeps its session journal under `$HOME`).
- **`run`/`spawn` inject pnpm's `dangerouslyAllowAllBuilds` env override** (all three spellings, `PNPM_BUILD_APPROVAL_ENV`). pnpm ≥10 blocks dependency build scripts behind an interactive `pnpm approve-builds`, which a harness's first-run CLI install trips on with no TTY to answer. Env works regardless of the bootstrap path, which the package doesn't choose. A `pnpm-workspace.yaml`/`.npmrc` allowlist was rejected: it would need that path, and pnpm ≥11 renamed the config keys (`onlyBuiltDependencies` to `allowBuilds`), so a file would silently stop working. Applying it to every call is safe because only the framework's bootstrap and the one bridge spawn go through this session; the agent's own work happens inside that process tree.
- **Bootstrap state location.** `@ai-sdk/harness@1.0.163` puts harness state at `$HOME/.ai-sdk-harness` (`harnessStateDirectoryPath`, resolved by running `printf "$HOME"` in the sandbox), not under `defaultWorkingDirectory`. `stale-bootstrap.ts` and `relocated` mode both address `<defaultWorkingDirectory>/.harness-bootstrap/<harness>`, so they matter only for adapters that bootstrap there.

## Two sandbox modes

`createLocalSandbox` returns `{ provider, workDir }`. The two must be used together: the framework composes `<defaultWorkingDirectory>/<workDir>`, and `workDir` must be relative (an absolute one throws in `HarnessAgent`).
- **`in-place`** — `defaultWorkingDirectory` is the repo's parent and `workDir` its folder name; the framework's `mkdir -p` no-ops. The only choice for **pi**, which has no bootstrap recipe (it mirrors the workspace into an in-process VFS) and whose path-containment check canonicalizes the sandbox side but not `workDir`, so a symlinked `workDir` fails every read/write with `Pi path escapes the workspace`.
- **`relocated`** — `defaultWorkingDirectory` is a caller-supplied scratch root and `workDir` is a path-hash-keyed symlink to the repo (`ensureRepoSymlink`, idempotent, run on every `createSession()`). For claude-code/codex/opencode, whose pinned-CLI bootstrap installs into `defaultWorkingDirectory`: left in-place, that `pnpm install` runs inside whatever pnpm workspace the repo sits in, and global-virtual-store linking disagreeing with the bootstrap's `--store-dir` makes pnpm try to relink `node_modules`, which aborts without a TTY (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`). The scratch root must be outside any pnpm workspace and is meant to be shared across repos and sessions; it only holds the pinned CLI install, keyed by a content-derived marker.

## Gotchas

- `run`'s stdout/stderr must be drained through the same wrapper `spawn` uses (`toSandboxProcess` + `collectStream`). A second `'data'` listener on the raw streams races `Readable.toWeb` and starves whichever loses.
- A process killed by `kill()` or an aborted signal reports `128 + signum` as `exitCode`, the value the shell reports as `$?`.
- Cold `createSession()` for a bootstrapping harness is slow (measured ~13-28s: clone + `pnpm install` of the CLI) versus ~0.3-0.8s warm (marker present). UIs should say why it's slow rather than show a bare spinner.

# ai-sandbox-local

A sandbox for AI SDK [`HarnessAgent`](https://github.com/vercel/ai/tree/main/packages/harness) that runs on your real filesystem and processes. Point a coding agent (Claude Code, Codex, OpenCode, pi) at a repo on your machine, with no VM, container, or remote sandbox in between.

> **There is no isolation.** The agent reads, writes, and executes as your user, directly on your disk. Use it where you would otherwise run the CLI yourself.

## Install

```sh
npm i ai-sandbox-local @ai-sdk/harness @ai-sdk/provider-utils
```

`@ai-sdk/harness` (`^1.0.163`) and `@ai-sdk/provider-utils` (`^5.0.67`) are peer dependencies. POSIX only: commands run through `/bin/bash`.

The quickstart below also needs `@ai-sdk/harness-claude-code` and `zod`:

```sh
npm i @ai-sdk/harness-claude-code zod
```

> **Known issue:** Recent releases of the harness adapters (`@ai-sdk/harness-claude-code` 1.0.163–1.0.167; the upstream fix says Codex and OpenCode are affected too) were published without their bridge lockfile, so the first `createSession` fails with ENOENT on `dist/bridge/pnpm-lock.yaml`. This is an upstream packaging bug, not this library. It is fixed in [vercel/ai#23852](https://github.com/vercel/ai/pull/23852) (reported in [vercel/ai#23829](https://github.com/vercel/ai/issues/23829)) and will go away once a fixed adapter is released. Until then, copy `dist/bridge/pnpm-lock.yaml` from `@ai-sdk/harness-claude-code@1.0.162` into the installed adapter; the bridge's `package.json` is identical.

## Quickstart

```ts
import { HarnessAgent } from '@ai-sdk/harness/agent';
import { claudeCode } from '@ai-sdk/harness-claude-code';
import { createLocalSandboxSession } from 'ai-sandbox-local';

const agent = new HarnessAgent({
	harness: claudeCode,
	id: 'local-agent',
	model: 'claude-sonnet-4-5',
	sandboxConfig: { workDir: '.' },
});

const sandboxSession = await createLocalSandboxSession({
	workingDirectory: '/path/to/your/repo',
});
const session = await agent.createSession({ sandboxSession });

try {
	const result = await agent.generate({
		session,
		prompt: 'Fix the failing test in src/auth.ts',
	});
	console.log(result.text);
} finally {
	await session.destroy();
	await sandboxSession.destroy();
}
```

`workDir: '.'` makes the agent work directly in `workingDirectory`. Without it, the harness creates a fresh subdirectory inside it.

<details>
<summary>Environment, PATH and pnpm</summary>

Pass `env` to layer variables over `process.env` for every command the sandbox runs. `env.HOME` beats `homeDirectory`, and a per-call `env` beats both.

```ts
createLocalSandboxSession({
	workingDirectory,
	env: { PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
});
```

Apps launched from a GUI (a macOS `.app`, for example) often inherit a bare `PATH` that misses where `node` or `pnpm` live. Set `env.PATH` yourself in that case.

Commands also run with pnpm's `dangerouslyAllowAllBuilds` enabled, so a harness's first-run CLI install is not blocked waiting for `pnpm approve-builds` with no terminal to answer. Override it through `env` if you don't want that.

</details>

<details>
<summary>Where harness state goes</summary>

Harness bootstrap state (pinned CLI installs, bridge state, skills) lives in `$HOME/.ai-sdk-harness` of the sandbox, not in your repo. The sandbox's `HOME` defaults to `ai-sandbox-local/home` under `os.tmpdir()`, shared by every session so the roughly 20-second first-run CLI install stays warm. The OS may clear its temp dir, which only means a slow first run again.

Pass `homeDirectory` to choose another one:

```ts
import { homedir } from 'node:os';

createLocalSandboxSession({ workingDirectory, homeDirectory: homedir() });
```

Trade-off: everything the agent runs sees that `HOME`, so under the default it does not find your `~/.gitconfig` (git identity), `~/.ssh` keys, or npm/CLI logins. Use `homeDirectory: homedir()` to get them back, or pass specific variables through `env`, such as `GIT_AUTHOR_NAME` or `GIT_CONFIG_GLOBAL`.

</details>

<details>
<summary>Deprecated <code>sandbox</code> provider form</summary>

`HarnessAgent({ sandbox })` takes a provider instead of a session:

```ts
import { createLocalSandboxProvider } from 'ai-sandbox-local';

const sandbox = createLocalSandboxProvider({
	workingDirectory: '/path/to/your/repo',
});
```

Set `sandboxConfig: { workDir: '.' }` as above. If the harness's `onFirstCreate` hook throws, the session is stopped before the error propagates.

</details>

<details>
<summary>Limitations</summary>

- No `resumeSession`: spawned processes die with the host process, so there is nothing to reattach to.
- No `setNetworkPolicy` or `setPorts`: nothing local can enforce them.
- `stop()` and `destroy()` send `SIGTERM` to every process started through the session or its `restricted()` view (the harness's bridge included, and `run` calls in flight) and release its port. They never delete the directory.

</details>

Full documentation: https://ai-sandbox-local.fdarian.com

Source and issues: https://github.com/fdarian/ai-sandbox-local

## License

MIT

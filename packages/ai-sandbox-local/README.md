# ai-sandbox-local

A sandbox for AI SDK [`HarnessAgent`](https://github.com/vercel/ai/tree/main/packages/harness) that runs on your real filesystem and processes. Point a coding agent (Claude Code, Codex, OpenCode, pi) at a repo on your machine, with no VM, container, or remote sandbox in between.

> **There is no isolation.** The agent reads, writes, and executes as your user, directly on your disk. Use it where you would otherwise run the CLI yourself.

## Install

```sh
npm i ai-sandbox-local @ai-sdk/harness @ai-sdk/provider-utils
```

`@ai-sdk/harness` (`^1.0.163`) and `@ai-sdk/provider-utils` (`^5.0.67`) are peer dependencies. POSIX only: commands run through `/bin/bash`.

## Quickstart

```ts
import { HarnessAgent } from '@ai-sdk/harness/agent';
import { claudeCode } from '@ai-sdk/harness-claude-code';
import { createLocalSandbox } from 'ai-sandbox-local';

const sandbox = createLocalSandbox({
	mode: 'in-place',
	repoRoot: '/path/to/your/repo',
});

const agent = new HarnessAgent({
	harness: claudeCode,
	id: 'local-agent',
	model: 'claude-sonnet-4-5',
	sandboxConfig: { workDir: sandbox.workDir },
});

const sandboxSession = await sandbox.provider.createSession();
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

`sandbox.workDir` must be passed to `sandboxConfig.workDir`: the harness resolves the agent's directory as `<sandbox default dir>/<workDir>`, and the two only line up when they come from the same `createLocalSandbox` call.

<details>
<summary>Environment, PATH and pnpm</summary>

Pass `env` to layer variables over `process.env` for every command the sandbox runs. A per-call `env` still wins.

```ts
createLocalSandbox({
	mode: 'in-place',
	repoRoot,
	env: { PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
});
```

Apps launched from a GUI (a macOS `.app`, for example) often inherit a bare `PATH` that misses where `node` or `pnpm` live. Set `env.PATH` yourself in that case.

Commands also run with pnpm's `dangerouslyAllowAllBuilds` enabled, so a harness's first-run CLI install is not blocked waiting for `pnpm approve-builds` with no terminal to answer. Override it through `env` if you don't want that.

</details>

<details>
<summary>Sandbox modes</summary>

- `in-place`: the agent works in `repoRoot` directly.
- `relocated`: the sandbox root is a `scratchRoot` you choose, and the repo is reached through a symlink inside it. Use it for harnesses that install a CLI into the sandbox's default directory, so the install stays out of your repo's own package manager workspace.

```ts
createLocalSandbox({
	mode: 'relocated',
	repoRoot,
	scratchRoot: '/path/outside/any/workspace',
});
```

</details>

<details>
<summary>Limitations</summary>

- No `resumeSession`: spawned processes die with the host process, so there is nothing to reattach to.
- No `setNetworkPolicy` or `setPorts`: nothing local can enforce them.
- `stop()` and `destroy()` kill processes the session spawned and release its port. They never delete the directory.

</details>

Full documentation: https://github.com/fdarian/ai-sandbox-local

## License

MIT

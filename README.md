# ai-sandbox-local

Run AI SDK harness agents against your real filesystem and processes.

`ai-sandbox-local` is a sandbox for the AI SDK's `HarnessAgent` that points a coding CLI (Claude Code, Codex, OpenCode, pi) at a repo already on your machine, with no VM, container, or remote sandbox in between.

> **There is no isolation.** The agent reads, writes, and executes as your user, directly on your disk. Use it where you would otherwise run the CLI yourself.

## Get started

- [Package README](./packages/ai-sandbox-local/README.md): install and quickstart
- [Documentation](https://ai-sandbox-local.fdarian.com): guides and API reference. Run `pnpm --filter docs dev` to read the Blume site locally.
- [GitHub](https://github.com/fdarian/ai-sandbox-local): source and issues

## Development

See [AGENTS.md](./AGENTS.md) for the workspace layout and commands.

## License

[MIT](./LICENSE)

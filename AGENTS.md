# ai-sandbox-local

pnpm + Bun + Turborepo monorepo for `ai-sandbox-local`, an AI SDK harness sandbox that runs agents on the real filesystem and processes.

## Workspaces

- `packages/ai-sandbox-local` — the published npm library. See its [AGENTS.md](./packages/ai-sandbox-local/AGENTS.md) for design decisions and gotchas.

## Stack

pnpm (install, lockfile), Bun (`bun test`), Turborepo (`check` tasks), Biome (format + lint), tsdown (build), Changesets (release). TypeScript config extends `@total-typescript/tsconfig` directly in each package.

## Commands

- `pnpm install`
- `pnpm format` — `biome check --write` at the root
- `pnpm turbo run check` — type-check and lint every workspace
- `pnpm --filter ai-sandbox-local build` / `pnpm --filter ai-sandbox-local test`

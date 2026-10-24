# ai-sandbox-local

pnpm + Bun + Turborepo monorepo for `ai-sandbox-local`, an AI SDK harness sandbox that runs agents on the real filesystem and processes.

## Workspaces

- `packages/ai-sandbox-local` — the published npm library. See its [AGENTS.md](./packages/ai-sandbox-local/AGENTS.md) for design decisions and gotchas.
- `apps/docs` — private [Blume](https://www.npmjs.com/package/blume) docs site (markdown-first, Astro-based). Pages are `.mdx` files in `apps/docs/docs/`, routed from the content root, so `docs/getting-started.mdx` is `/getting-started`; order comes from each page's `sidebar.order` frontmatter. Code samples in the pages are checked by hand against `@ai-sdk/harness` and the harness adapters, not compiled by CI, so re-check them when the library's API changes.

## Stack

pnpm (install, lockfile), Bun (`bun test`), Turborepo (`check` tasks), Biome (format + lint), tsdown (build), Changesets (release). TypeScript config extends `@total-typescript/tsconfig` directly in each package.

## Commands

- `pnpm install`
- `pnpm format` — `biome check --write` at the root
- `pnpm turbo run check` — type-check and lint every workspace
- `pnpm --filter ai-sandbox-local build` / `pnpm --filter ai-sandbox-local test`
- `pnpm --filter docs dev` / `pnpm --filter docs build` — docs site (build output is `apps/docs/dist`)

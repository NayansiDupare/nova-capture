# 0001. Toolchain versions and lint plugin choice

- Status: Accepted
- Date: 2026-10-11

## Context

Phase 1 sets up the pnpm monorepo. Several of the newest tool releases do not yet work with each other:

| Package | Newest | Blocker |
|---|---|---|
| TypeScript | 7.0.2 | typescript-eslint 8.71 supports `typescript >=4.8.4 <6.1.0` |
| ESLint | 10.12 | eslint-plugin-react 7.37 supports ESLint up to 9.7+ |
| Vite | 8.3 | electron-vite 5.0 supports Vite `^5 \|\| ^6 \|\| ^7` |
| @vitejs/plugin-react | 6.1 | Must match Vite 7 |
| Prettier | 3.9.10 | Published less than a day before setup; pnpm's minimum release age blocks it |

CODE_STYLE.md names "ESLint import" for import order and boundary rules. The original `eslint-plugin-import` does not support ESLint 10 and has no flat-config resolver support for our setup.

## Decision

- Pin exact versions (SECURITY.md §8): TypeScript **6.0.3**, ESLint **9.39.5**, Vite **7.3.7**, @vitejs/plugin-react **5.2.0**, Prettier **3.9.9**. Everything else uses its newest release, including Electron 44.7.0, electron-vite 5.0.0, React 19.3, Vitest 5.0.3, zod 4.6.5.
- Use **eslint-plugin-import-x** (a maintained fork with the same rule names under `import-x/`) for `order`, `no-default-export`, `no-nodejs-modules` and `no-restricted-paths`.
- `pnpm-workspace.yaml` `allowBuilds` lists the only packages allowed to run install scripts: electron, esbuild, unrs-resolver.
- Prettier does not format Markdown. The docs are hand-formatted, and Prettier would realign every table.

## Consequences

- Revisit when typescript-eslint supports TypeScript 7, eslint-plugin-react supports ESLint 10, and electron-vite supports Vite 8. Bump them together and rerun typecheck, lint and tests.
- Rule names in CODE_STYLE.md use the `import-x/` prefix.

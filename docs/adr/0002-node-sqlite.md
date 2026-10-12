# 0002. Use built-in node:sqlite instead of better-sqlite3

- Status: Accepted
- Date: 2026-10-12

## Context

ARCHITECTURE §10 planned `better-sqlite3`. It is a native module: one build for Node (Vitest) and another for Electron's ABI. Switching between them needs a rebuild step locally (`pnpm rebuild:native`) and in CI, and a wrong build fails at runtime.

Node 24 ships `node:sqlite` (`DatabaseSync`), a synchronous API close to better-sqlite3. We checked both runtimes on 12 Oct 2026:

| Runtime | Node | SQLite | FTS5 with `porter unicode61` |
|---|---|---|---|
| Node (tests) | 24.13.0 | 3.50.4 | works |
| Electron 44.7.0 (main) | 24.21.0 | 3.53.4 | works |

## Decision

Use `node:sqlite` in the main process. Repositories take a `DatabaseSync`. Tests use `:memory:` databases with the same code the app runs.

- Migrations: `.sql` files imported with Vite's `?raw`, applied in order and tracked in `PRAGMA user_version`, each in its own transaction with the version bump.
- Transactions: a small `inTransaction(db, fn)` helper (`BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`), since `node:sqlite` has none.
- Pragmas: WAL, `synchronous = FULL` (a committed session transition must survive a power cut), `foreign_keys = ON`.

## Consequences

- No new dependency and no native rebuild. The `rebuild:native` command is dropped.
- `node:sqlite` is still marked experimental. It prints an `ExperimentalWarning` once per process, and its API may change between Node versions. Electron pins the Node version, so changes arrive only with an Electron upgrade; rerun the repository tests when bumping Electron.
- Tests run on the system Node's SQLite (3.50) while the app runs Electron's (3.53). Avoid features newer than the older of the two.
- `sqlite-vec` (ARCHITECTURE §22) needs `loadExtension`, which `node:sqlite` supports with `allowExtension: true`. Verify when that work starts.
- If `node:sqlite` becomes a blocker, the repository layer is the only code to change; better-sqlite3 has a near-identical synchronous API.

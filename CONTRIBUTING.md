# Contributing

```sh
bun install
bun test          # all tests; uses PGlite and an in-process MCP server, no services needed
bun run typecheck
bun run lint      # Biome; `bun run format` to fix
```

- Keep `packages/core` free of database, HTTP and framework code. It talks to the outside
  world through `RunStore` and `EventSink`.
- New tools declare an honest `effect` and set `untrustedOutput` when their output can carry
  third-party text.
- Changes to the runtime or policy need tests. Scripted models (`@synapse/core/testing`)
  make most runtime behaviour testable without an API key.
- Schema changes: edit `packages/db/src/schema.ts`, then `bun run db:generate`.
- Dependencies are pinned to exact versions at least two weeks old.
- One logical change per commit, with a message that says why.

# Integration tests

Tests that touch a real dependency: a database, a queue, an external API, the filesystem.
They need something running — start it with `docker compose up -d` (or testcontainers) before
`npm run test:integration`.

This template ships no external dependency, so the folder is empty on purpose and the project
is configured with `passWithNoTests`. Add files here the moment a module stops using the
in-memory `Map`, for example:

```ts
// test/integration/todo-repository.test.ts
// - connect to the database from the test env
// - run the migrations
// - exercise the repository against real SQL
// - truncate between tests
```

Branch coverage does not belong here: keep it in `test/unit`. Route wiring over a real socket
belongs in `test/e2e`.

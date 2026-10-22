# Releasing

This package depends on `typespec-http-zod` **through the registry**, by version range. So the pair a
consumer actually gets -- `npm install typespec-http-mcp` pulling the library transitively -- is a
resolution this repository's suite never performs.

## Rehearse against a local registry, not against tarballs

`pnpm pack` plus a `file:` override is quicker and is **not** the same test: it skips version-range
resolution entirely, so it cannot tell you that `^0.24.0` actually reaches the library.

```bash
mkdir -p /tmp/rehearsal/storage && cd /tmp/rehearsal
cat > config.yaml <<'YAML'
storage: ./storage
uplinks: { npmjs: { url: https://registry.npmjs.org/ } }
packages:
  'typespec-http-mcp': { access: $all, publish: $anonymous }
  '@*/*':              { access: $all, proxy: npmjs }
  '**':                { access: $all, proxy: npmjs }
log: { type: stdout, format: pretty, level: warn }
YAML
printf 'registry=http://localhost:4873/\n//localhost:4873/:_authToken=rehearsal\n' > npmrc
npx --yes verdaccio@6 --config ./config.yaml --listen 4873 &

# `--provenance=false` because provenance needs a CI OIDC identity; the real publish keeps it on.
cd <this package> && NPM_CONFIG_USERCONFIG=/tmp/rehearsal/npmrc \
  npm publish --registry http://localhost:4873 --provenance=false

mkdir -p /tmp/cleanroom && cd /tmp/cleanroom
printf 'registry=http://localhost:4873/\n' > .npmrc
npm install --save-dev typespec-http-mcp @typespec/compiler @typespec/http typescript
npm install @modelcontextprotocol/server zod
```

**Check what the registry resolved, not what you asked for.** The transitive edge is the point:

```bash
node -e "for (const p of ['typespec-http-mcp','typespec-http-zod','zod','@modelcontextprotocol/server'])
  console.log(p, require('./node_modules/'+p+'/package.json').version)"
```

## The proof this package has actually passed

Recorded so a future one can be compared against it rather than merely repeated.

Resolved from the rehearsal registry: `typespec-http-mcp@0.1.0`, `typespec-http-zod@0.24.0`,
`zod@4.5.4`, `@modelcontextprotocol/server@2.0.0`, `@typespec/compiler@1.15.0`. Note that `zod`
resolved **newer** than the version this repository develops against, which is what a stranger gets.

| step                                                                                           | result                                                            |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `tsp compile spec/main.tsp`                                                                    | exit 0, three files emitted                                       |
| `tsc` over a hand-written consumer, `strict` + `exactOptionalPropertyTypes` + `noUnusedLocals` | exit 0, no cast anywhere                                          |
| `tools/list`                                                                                   | 200, three tools, sorted by name                                  |
| `Widgets_read.annotations`                                                                     | `{"readOnlyHint":true,"idempotentHint":true}`                     |
| `Widgets_remove.annotations`                                                                   | `{"idempotentHint":true,"destructiveHint":true}`                  |
| `Widgets_create.inputSchema.required`                                                          | `["id","name"]` -- `colour` is defaulted, so a caller may omit it |
| `tools/call` `Widgets_read`                                                                    | 200, `structuredContent` carrying the widget                      |
| `tools/call` `Widgets_create` omitting `colour`                                                | 200, the default applied by the validator                         |
| a wrongly typed argument                                                                       | 200 with `isError: true`, the callback never ran                  |

**And its control**, because a clean install with no failing counterpart proves the harness runs
rather than that the emitter works: renaming one property in the consumer's handler input -- a
property the contract does not publish -- fails with `TS2322`. Restored from a byte copy, `cmp`
clean, green again.

### `0.4.0`, rehearsed with the library and the server

Published to the rehearsal registry at their release versions and real ranges:
`typespec-http-zod@0.30.0`, `typespec-hono@0.27.0` and `typespec-http-mcp@0.4.0`, each manifest naming
`"typespec-http-zod": "^0.30.0"`. Resolved in a clean room: one `typespec-http-zod@0.30.0` under both,
`zod@4.6.7` (newer than this repository develops against), `@modelcontextprotocol/server@2.3.1`,
`hono@4.13.13`, `@hono/zod-validator@0.9.1`, `@typespec/compiler@1.17.0`. The spec declared an
`@encode`d list in each parameter location, a discriminated base, a `void` failure and an operation
two of whose inputs share one key, compiled by both emitters into separate directories.

| step                                                                                | result                                                                                  |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `tsp compile`, both emitters                                                        | exit 0; `shared-input-key` once each from the library, the server and this emitter      |
| the `@encode` cycle, compiled alone                                                 | exit 1, one `encode-cycle` error, no crash                                              |
| `tsc` over a hand-written consumer, `strict` + `exactOptionalPropertyTypes`         | exit 0; each handler input annotated with its decoded type, `Things_get` in neither set |
| `GET /q?ids=1%7C2`, `/p/a,b`, `/h` with `x-tags: a,b`, `/c?tags=a,b`, `/s?tags=a,b` | 200 each; `[1, 2]`, `"a,b"`, `"a,b"`, `"a,b"`, `["a", "b"]` handed over                 |
| `GET /dog`, the handler returning `kind: "wrongKind"`                               | 200                                                                                     |
| `GET /t`, the handler returning the `void` 409                                      | 409, no `Content-Type`, empty body                                                      |
| `GET /shared`                                                                       | 404: not mounted                                                                        |
| `tools/list`                                                                        | seven tools, `Things_get` not among them; `P_read`'s `ids` is `{ "type": "string" }`    |
| `tools/call` `P_read` with `"a,b"`, `Q_read` with `[1, 2]`, `getDog`                | each answered, the handler handed the value as sent, `getDog`'s unknown kind returned   |

**And its control:** renaming the property in `Q_read`'s handler input fails with `TS2322`. Restored
from a byte copy, `cmp` clean, green again.

### `0.5.0`, rehearsed against the published library and server

`typespec-http-zod@0.31.0` and `typespec-hono@0.28.0` were on npm; `typespec-http-mcp@0.5.0` was
published to the rehearsal registry, which proxied the rest, its manifest naming
`"typespec-http-zod": "^0.31.0"`. Resolved in a clean room: one `typespec-http-zod@0.31.0`, deduped
under both emitters, `zod@4.6.7`, `@modelcontextprotocol/server@2.3.1`, `hono@4.13.13`,
`@typespec/compiler@1.17.0`. The spec was the `0.4.0` rehearsal's, with the discriminated base
`Dog { kind; weight }` and a `Golden` subtype requiring `coat`, sent as the property `dog` of a body,
compiled by both emitters into separate directories.

| step                                                                                                        | result                                                                               |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `tsp compile`, both emitters                                                                                | exit 0; `shared-input-key` once each from the library, the server and this emitter   |
| a request body declared `never`, compiled alone                                                             | exit 1, one `never-body` error naming `void`                                         |
| `tsc` over ONE handler object for both surfaces, `strict` + `exactOptionalPropertyTypes` + `noUnusedLocals` | exit 0, no cast                                                                      |
| `tools/list`                                                                                                | seven tools, `Things_get` not among them; `P_read`'s `ids` is `{ "type": "string" }` |
| `tools/call` `Q_read` `[1, 2]`, `P_read`/`H_read`/`C_read` `"a,b"`, `S_read` `["a", "b"]`                   | each answered, the handler handed the value as sent                                  |
| `putDog` `{ kind: "golden", weight: 8 }`, `coat` missing                                                    | accepted, as the base; Ajv on the published `inputSchema` accepts it too             |
| `putDog` `{ kind: "golden", weight: 8, coat: "red" }`, and `kind: "wrongKind"`                              | accepted; the `inputSchema` accepts both                                             |
| `putDog` `{ kind: "golden" }`                                                                               | refused, the handler never ran; the `inputSchema` refuses it too                     |
| `GET /t`, the handler returning the `void` 409                                                              | 409, no `Content-Type`, empty body                                                   |
| `GET /things`                                                                                               | 404: not mounted                                                                     |

**And its control:** misspelling `weight` in the handler's read of `input.dog` fails with `TS2551`.
Restored from a byte copy, `cmp` clean, green again.

### `0.6.0`, rehearsed with the library, the server and the collection

`typespec-http-zod@0.32.0`, `typespec-hono@0.29.0`, `typespec-http-mcp@0.6.0` and
`typespec-postman@0.4.0` were published to the rehearsal registry at their release versions and
real ranges, each manifest naming `"typespec-http-zod": "^0.32.0"`. Resolved in a clean room: one
`typespec-http-zod@0.32.0`, deduped under both emitters, `zod@4.6.7`,
`@modelcontextprotocol/server@2.3.1`, `hono@4.13.13`, `@typespec/compiler@1.17.0`. The spec: a
`Widget` whose server-assigned read-only `id` a create body leaves out, nested in its `Item`s too,
compiled by all three emitters at each OpenAPI version openapi3 can be set to publish.

| step                                                                     | result                                                                    |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `tsp compile`, openapi3's default (3.0)                                  | exit 0                                                                    |
| `tsp compile`, `openapi-versions: ["3.1.0"]`                             | exit 0                                                                    |
| `tsp compile`, `["3.0.0", "3.1.0"]`                                      | exit 1, one `ambiguous-read-only` naming `Rehearsal.Widget.id`            |
| `tsc` over ONE handler object for both surfaces, per version             | exit 0 each                                                               |
| 3.0: `create`'s `inputSchema.required`, and `tools/call` without the ids | `["name", "items"]`; answered                                             |
| 3.1: the same                                                            | `["id", "name", "items"]`; refused                                        |
| the server beside it, `POST /widgets` without the ids                    | 201 at 3.0, 400 at 3.1                                                    |
| `Inner \| null` compiled at 3.0, and at 3.1                              | exit 1, `unpublishable-null` naming `openapi-versions: ["3.1.0"]`; exit 0 |

### `0.7.0`, rehearsed with the library and the server

`typespec-http-zod@0.33.0`, `typespec-hono@0.30.0` and `typespec-http-mcp@0.7.0` were published to
the rehearsal registry at their release versions, each manifest naming
`"typespec-http-zod": "^0.33.0"`. Resolved in a clean room: one `typespec-http-zod@0.33.0`, deduped
under both emitters, `zod@4.6.7`. The spec: the discriminated bases `typespec-http-graphql` resolves,
`Dog`/`Golden`, `Pet`/`Puppy` and the nested `Fish`/`Shark`/`SawShark`, compiled by both emitters
and a third built on the library that reads `EmittedService.typeSchemaNames`.

| step                                                                          | result                                                                  |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `tsp compile`, the three emitters                                             | exit 0; `typespec-http-zod/shared-input-key` once                       |
| the same beside `typespec-hono@0.29.0`, two copies of the library             | `typespec-http-zod/shared-input-key` twice                              |
| the third emitter's lookup of each model a response reaches, and each subtype | an identifier for all seven, `sawSharkSchema` included                  |
| each value through those validators, base first, then each subtype            | `Dog`, `Golden`, `Pet`, `Puppy`, `Shark`, `SawShark`, as the document's |
| this package's suite against the rehearsal packages                           | 280 passed                                                              |

### `0.8.0`, rehearsed with the library, the server, the collection and the GraphQL surface

`typespec-http-zod@0.34.0`, `typespec-hono@0.31.0`, `typespec-http-mcp@0.8.0`,
`typespec-postman@0.5.0` and `typespec-http-graphql@0.2.0` were published to the rehearsal registry
at their release versions, each manifest naming `"typespec-http-zod": "^0.34.0"` where it depends on
it. Resolved in a clean room installing all four emitters: one `typespec-http-zod@0.34.0`, deduped
under each, `zod@4.6.5`.

| step                                                                  | result                                        |
| --------------------------------------------------------------------- | --------------------------------------------- |
| this package's suite against the rehearsal packages                   | 281 passed                                    |
| `typespec-hono`'s, `typespec-postman`'s and `typespec-http-graphql`'s | 460, 253 and 1,280 passed                     |
| `typespec-hono-example`'s generate, typecheck, bundle and smoke       | exit 0; its server byte-identical to 0.30.0's |

## The cross-package rehearsal, when the library moves too

`typespec-http-mcp@0.1.0` needs `typespec-http-zod@0.25.0`, which introduced
`EmittedRoute.security`. Neither is published, so the pair is rehearsed together: publish the
library first, then this package **at its release version with the real dependency range**, then
install into an empty directory.

Verify the published manifest names a RANGE and not the local link:

```bash
curl -s http://localhost:4873/typespec-http-mcp | node -e "..."   # -> {"typespec-http-zod":"^0.25.0"}
```

Resolved in a clean room: `typespec-http-mcp@0.1.0`, `typespec-http-zod@0.25.0`, `zod@4.5.4`,
`@modelcontextprotocol/server@2.0.0`. A spec declaring `@useAuth(BearerAuth | Scoped)` compiled to:

```ts
deps.permits([{ "BearerAuth": [] }, { "OAuth2Auth": ["widgets.read", "widgets.write"] }])
annotations: { readOnlyHint: true, idempotentHint: true }      // GET
annotations: { idempotentHint: true, destructiveHint: true }   // DELETE
```

`"BearerAuth": []` is the point: a scheme demanding no scopes. Under the library's previous IR that
reached an emitter as an empty scope list, indistinguishable from an operation declaring no
authentication at all.

**While `overrides` in `pnpm-workspace.yaml` redirects the library to a local path, the release
workflow refuses to publish.** `--frozen-lockfile` exits 0 on a dangling link, so a release checkout
with no sibling on disk would install happily and fail four steps later as a wall of `TS2307`
naming the module but not the cause.

## Release sequence

1. Four gates, each checked by **exit code**, never by piping to `tail`.
2. `CHANGELOG.md` entry.
3. Commit, `git tag vX.Y.Z`, `git push origin main`.
4. Push the tag **separately**: a lightweight tag does not travel with `--follow-tags`.
5. Confirm by SHA with `gh run list --json headSha,conclusion`, then by `npm view typespec-http-mcp version`.
   The registry lags the workflow by a minute; that is not a failure.
6. **Name the exact version wherever the release is announced.** pnpm 11 holds back a version newer
   than its minimum release age, so on the day of a release `pnpm add -D typespec-http-mcp` quietly
   installs the one before it. `pnpm add -D typespec-http-mcp@X.Y.Z` installs the release and lists
   it in `minimumReleaseAgeExclude`, with the `typespec-hono` and `typespec-http-zod` it needs.

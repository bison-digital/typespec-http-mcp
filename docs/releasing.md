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

## Release sequence

1. Four gates, each checked by **exit code**, never by piping to `tail`.
2. `CHANGELOG.md` entry.
3. Commit, `git tag vX.Y.Z`, `git push origin main`.
4. Push the tag **separately**: a lightweight tag does not travel with `--follow-tags`.
5. Confirm by SHA with `gh run list --json headSha,conclusion`, then by `npm view typespec-http-mcp version`.
   The registry lags the workflow by a minute; that is not a failure.

**Only Zach authorises a release, directly.**

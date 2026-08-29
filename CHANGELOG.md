# Changelog

## 0.1.0

Unreleased.

- The emitter skeleton: options derived from `typespec-http-zod`'s published schema at both levels,
  never restated.
- Tool selection by `@tag`, read with `getAllTags` so a tag on an interface or namespace reaches the
  operations inside it.
- Tool naming from the operation id, refused rather than re-spelled when MCP cannot carry it.
- Diagnostics: `no-tools-selected`, `unrepresentable-tool-name`, `tool-name-collision`.

The `./runtime` entry point and the tool surface itself are not in this list yet; they arrive with
the stages that write them, and `test/packaging.test.ts` refuses an export that resolves to nothing.

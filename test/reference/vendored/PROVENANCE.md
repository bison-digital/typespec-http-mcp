# Vendored reference data

Third-party files, copied verbatim and pinned by digest. `test/vendored.test.ts` recomputes each
digest, so a file edited in place fails rather than quietly changing what an oracle grades.

## `methods.csv`

The IANA HTTP Method Registry: the authoritative published form of the method properties RFC 9110
defines.

- Source: `https://www.iana.org/assignments/http-methods/methods.csv`
- Retrieved: 2026-08-29
- sha256: `9142d088def4062d43a3359c63667602106cfebf62889efaa3cd737e5e42d65c`

**Why it is here rather than derived.** `src/annotations.ts` holds its own table of which methods are
safe and which are idempotent. An arm that recomputed that rule from the same table would agree with
any mistake in it. This file is the independent statement of the same facts, published by a third
party, so the two can genuinely disagree -- which is the only thing that makes the comparison an
oracle rather than a restatement.

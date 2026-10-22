import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **Vendored third-party data, pinned by digest.**
 *
 * A file copied from elsewhere and then edited in place changes what an oracle grades, silently and
 * in the direction that makes the oracle agree. Recomputing the digest is what turns "copied
 * verbatim" into a claim that can fail.
 */

const vendored = fileURLToPath(new URL("./reference/vendored/", import.meta.url));
const provenance = readFileSync(join(vendored, "PROVENANCE.md"), "utf8");

describe("every vendored file matches the digest recorded for it", () => {
	const files = readdirSync(vendored).filter((name) => name !== "PROVENANCE.md");

	it("has vendored files to check at all", () => {
		expect(files.length).toBeGreaterThanOrEqual(1);
	});

	it("records a digest for every file, and every digest matches", () => {
		for (const name of files) {
			const digest = createHash("sha256")
				.update(readFileSync(join(vendored, name)))
				.digest("hex");
			expect(provenance, `no section for ${name}`).toContain(`## \`${name}\``);
			expect(provenance, `digest changed for ${name}`).toContain(digest);
		}
	});

	it("names a source for every file, so a stale copy can be refreshed", () => {
		for (const name of files) {
			expect(provenance).toContain(`## \`${name}\``);
		}
		expect(provenance).toMatch(/Source: `https:\/\//);
	});
});

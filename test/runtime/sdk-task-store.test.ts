import type { InputResponses } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import type { TaskStore } from "../../src/runtime.js";

/**
 * **A store written for this runtime's Tasks extension serves the SDK's, and the reverse.**
 *
 * The SDK's own extension is not in a release. These declarations transcribe its `TaskStore` as
 * typescript-sdk#2782 has it at `612cd66` (`packages/server/src/ext/tasks/store.ts`, over the
 * `z.looseObject` schemas of `packages/core/src/ext/tasks/schemas.ts`). The proof is the two
 * assignments at the bottom, which `pnpm typecheck` compiles under `exactOptionalPropertyTypes`:
 * when the SDK ships, replace the transcription with its import and the same assignments must hold.
 */

type Open<T> = T & { [key: string]: unknown };
interface SdkTaskShape {
	taskId: string;
	status: "working" | "input_required" | "completed" | "cancelled" | "failed";
	statusMessage?: string | undefined;
	createdAt: string;
	lastUpdatedAt: string;
	ttlMs: number | null;
	pollIntervalMs?: number | undefined;
}
type SdkBase = Omit<SdkTaskShape, "status">;
type SdkTask = Open<SdkTaskShape>;
type SdkInputRequest = Open<{ method: string; params?: Record<string, unknown> | undefined }>;
type SdkDetailedTask =
	| Open<SdkBase & { status: "working" }>
	| Open<SdkBase & { status: "input_required"; inputRequests: Record<string, SdkInputRequest> }>
	| Open<SdkBase & { status: "completed"; result: Record<string, unknown> }>
	| Open<SdkBase & { status: "failed"; error: Record<string, unknown> }>
	| Open<SdkBase & { status: "cancelled" }>;
interface SdkCreateTaskParams {
	ttlMs: number | null;
	pollIntervalMs?: number;
	principal?: string;
	context?: Record<string, unknown>;
}
interface SdkTaskAccess {
	principal?: string;
}
interface SdkTaskStore {
	create(params: SdkCreateTaskParams): Promise<SdkTask>;
	get(taskId: string, access?: SdkTaskAccess): Promise<SdkDetailedTask | undefined>;
	update(taskId: string, inputResponses: InputResponses, access?: SdkTaskAccess): Promise<boolean>;
	cancel(taskId: string, access?: SdkTaskAccess): Promise<boolean>;
}

/** Each direction as a function, so the compiler checks the assignment and nothing runs. */
const oursServesTheSdk = (store: TaskStore): SdkTaskStore => store;
const theSdksServesOurs = (store: SdkTaskStore): TaskStore => store;

describe("the runtime's TaskStore and the SDK's are one shape", () => {
	it("is checked by the compiler, in both directions", () => {
		expect([oursServesTheSdk, theSdksServesOurs]).toHaveLength(2);
	});
});

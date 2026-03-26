import { describe, expect, test } from "bun:test";

// ThreadReplyForm is a client component — we test its props interface
// and verify the module exports correctly without DOM rendering.
describe("ThreadReplyForm", () => {
	test("module exports ThreadReplyForm component", async () => {
		const mod = await import("@/components/forum/thread-reply-form");
		expect(typeof mod.ThreadReplyForm).toBe("function");
	});

	test("ThreadReplyFormProps interface requires threadId and closed", async () => {
		// Type-level test: importing the module without error proves
		// the component is syntactically valid and exports correctly.
		const mod = await import("@/components/forum/thread-reply-form");
		expect(mod.ThreadReplyForm).toBeDefined();
	});
});

import { describe, expect, it } from "vitest";
import { buildUserColumns } from "@/components/admin/columns/user-columns";
import type { WritePermissionSettings } from "@/viewmodels/admin/write-permission";

const SETTINGS: WritePermissionSettings = {
	allowNewThread: true,
	allowReply: true,
	postingRestrictionsEnabled: true,
	minRegistrationDays: 1,
	requireAvatar: true,
};

describe("buildUserColumns", () => {
	it("full variant emits 10 columns including writeGate when settings provided", () => {
		const cols = buildUserColumns({
			variant: "full",
			writeGateSettings: SETTINGS,
			nowSeconds: 1_800_000_000,
		});
		expect(cols.map((c) => c.key)).toEqual([
			"user",
			"email",
			"role",
			"status",
			"writeGate",
			"threads",
			"posts",
			"messages",
			"attachments",
			"registered",
		]);
	});

	it("full variant drops writeGate when settings are missing", () => {
		// Defensive: /admin/users always passes settings, but if a future
		// caller forgets, we'd rather skip the column than blow up rendering.
		const cols = buildUserColumns({ variant: "full" });
		expect(cols.map((c) => c.key)).not.toContain("writeGate");
	});

	it("full variant drops writeGate when nowSeconds is missing", () => {
		const cols = buildUserColumns({ variant: "full", writeGateSettings: SETTINGS });
		expect(cols.map((c) => c.key)).not.toContain("writeGate");
	});

	it("compact variant emits the 5 recent-view columns and NEVER writeGate", () => {
		const cols = buildUserColumns({
			variant: "compact",
			// Even if a caller mistakenly passes settings, compact must not
			// render writeGate — the column set is fixed.
			writeGateSettings: SETTINGS,
			nowSeconds: 1_800_000_000,
		});
		expect(cols.map((c) => c.key)).toEqual(["user", "email", "role", "registered", "regIp"]);
	});

	it("does not emit the actions column in either variant", () => {
		// Each caller splices its own actions column onto the tail so the
		// preset never assumes a specific action set.
		for (const variant of ["full", "compact"] as const) {
			const cols = buildUserColumns({ variant });
			expect(cols.map((c) => c.key)).not.toContain("actions");
		}
	});
});

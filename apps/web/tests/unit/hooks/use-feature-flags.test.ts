import { beforeEach, describe, expect, it, vi } from "vitest";

// We need to control the module-level cache variables
// Strategy: test the hook's return value logic by controlling useState initial values

let useStateCallIndex = 0;
const stateValues: any[] = [null, true]; // [data, isLoading]

vi.mock("react", () => ({
	useState: (init: any) => {
		const idx = useStateCallIndex++;
		const val = stateValues[idx] !== undefined ? stateValues[idx] : init;
		return [val, vi.fn()];
	},
	useEffect: (_fn: () => void) => {
		/* don't run effect in tests */
	},
}));

import { useFeatureFlags } from "@/hooks/use-feature-flags";

describe("useFeatureFlags", () => {
	beforeEach(() => {
		useStateCallIndex = 0;
		stateValues[0] = null;
		stateValues[1] = true;
	});

	it("returns defaults when data is null (loading)", () => {
		const flags = useFeatureFlags();
		expect(flags.canCreateThread).toBe(true);
		expect(flags.canReply).toBe(true);
		expect(flags.isMaintenanceMode).toBe(false);
		expect(flags.maintenanceMessage).toBe("系统正在维护中，请稍后再试");
		expect(flags.requireLogin).toBe(false);
		expect(flags.isLoading).toBe(true);
	});

	it("returns values from fetched data", () => {
		stateValues[0] = {
			"features.content.allow_new_thread": "false",
			"features.content.allow_reply": "false",
			"features.access.maintenance_mode": "true",
			"features.access.maintenance_message": "停机维护",
			"features.access.require_login": "true",
		};
		stateValues[1] = false;

		const flags = useFeatureFlags();
		expect(flags.canCreateThread).toBe(false);
		expect(flags.canReply).toBe(false);
		expect(flags.isMaintenanceMode).toBe(true);
		expect(flags.maintenanceMessage).toBe("停机维护");
		expect(flags.requireLogin).toBe(true);
		expect(flags.isLoading).toBe(false);
	});

	it("handles partial data (missing keys use defaults)", () => {
		stateValues[0] = { "features.content.allow_new_thread": "true" };
		stateValues[1] = false;

		const flags = useFeatureFlags();
		expect(flags.canCreateThread).toBe(true);
		expect(flags.canReply).toBe(true); // default
		expect(flags.isMaintenanceMode).toBe(false); // default
		expect(flags.isLoading).toBe(false);
	});

	it("treats non-false values as truthy for boolean flags", () => {
		stateValues[0] = {
			"features.content.allow_new_thread": "true",
			"features.content.allow_reply": "yes",
		};
		stateValues[1] = false;

		const flags = useFeatureFlags();
		expect(flags.canCreateThread).toBe(true);
		expect(flags.canReply).toBe(true); // "yes" !== "false"
	});
});

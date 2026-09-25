import { afterEach, expect, it, vi } from "vitest";

const { start, statisticsStart } = vi.hoisted(() => ({
	start: vi.fn(),
	statisticsStart: vi.fn(),
}));
vi.mock("@/lib/memory-runtime", () => ({ getMemoryRuntime: () => ({ start }) }));
vi.mock("@/lib/daily-statistics", () => ({
	getDailyStatistics: () => ({ start: statisticsStart }),
}));

import { register } from "../../../src/instrumentation";

afterEach(() => {
	vi.unstubAllEnvs();
	start.mockClear();
	statisticsStart.mockClear();
});

it("starts the runtime only in a running Node server", async () => {
	vi.stubEnv("NEXT_RUNTIME", "edge");
	await register();
	vi.stubEnv("NEXT_RUNTIME", "nodejs");
	vi.stubEnv("NEXT_PHASE", "phase-production-build");
	await register();
	expect(start).not.toHaveBeenCalled();
	expect(statisticsStart).not.toHaveBeenCalled();
	vi.stubEnv("NEXT_PHASE", "phase-production-server");
	await register();
	expect(start).toHaveBeenCalledOnce();
	expect(statisticsStart).toHaveBeenCalledOnce();
});

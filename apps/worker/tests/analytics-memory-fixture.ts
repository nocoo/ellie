import { vi } from "vitest";
import { TodayVisitsMemory } from "../src/lib/analytics/memory";
import { makeEnv } from "./helpers";

export function memoryFixture() {
	const instances = new Map<string, TodayVisitsMemory>();
	const env = makeEnv();
	const storage = { put: vi.fn(), sql: { exec: vi.fn() } };
	const getByName = vi.fn((name: string) => {
		let instance = instances.get(name);
		if (!instance) {
			instance = new TodayVisitsMemory({ storage } as unknown as DurableObjectState, env);
			instances.set(name, instance);
		}
		return instance;
	});
	env.TODAY_VISITS = { getByName } as unknown as NonNullable<typeof env.TODAY_VISITS>;
	return { env, instances, getByName, storage };
}

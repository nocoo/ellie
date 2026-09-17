import type { CacheDescriptor } from "@ellie/types";
import type { Env } from "../env";
import { fetchAllSettingsFromDb, isValidSettingsMap } from "../settings";
import { isUserMiniProfile, loadUserMiniProfilesFromDb, userMiniCacheKey } from "../user-cache";
import { isPublicStats, loadPublicStats } from "./public-stats-read";

/** Small static loaders shared by live reads and management; no request identity or effects. */
function validatedKey(descriptor: CacheDescriptor): string {
	const { family, params, scope } = descriptor;
	if (scope !== "public") throw new TypeError("Invalid peripheral cache scope");
	if (family === "user:mini:v1") {
		if (
			Object.keys(params).join(",") !== "id" ||
			!Number.isSafeInteger(params.id) ||
			Number(params.id) <= 0
		)
			throw new TypeError("Invalid mini profile descriptor");
		return userMiniCacheKey(Number(params.id));
	}
	if (Object.keys(params).length !== 0 || (family !== "settings:all" && family !== "public-stats"))
		throw new TypeError("Invalid peripheral cache descriptor");
	return family;
}
export async function peripheralCacheKey(_env: Env, descriptor: CacheDescriptor): Promise<string> {
	return validatedKey(descriptor);
}
export function isPeripheralCacheData(descriptor: CacheDescriptor, value: unknown): boolean {
	try {
		validatedKey(descriptor);
	} catch {
		return false;
	}
	if (descriptor.family === "settings:all") return isValidSettingsMap(value);
	if (descriptor.family === "public-stats") return isPublicStats(value);
	return value === null || (isUserMiniProfile(value) && value.id === descriptor.params.id);
}
export async function rebuildPeripheralCache(
	env: Env,
	_ctx: ExecutionContext | undefined,
	descriptor: CacheDescriptor,
): Promise<unknown> {
	await peripheralCacheKey(env, descriptor);
	if (descriptor.family === "settings:all") return fetchAllSettingsFromDb(env);
	if (descriptor.family === "public-stats") return loadPublicStats(env);
	return (
		(await loadUserMiniProfilesFromDb(env, [Number(descriptor.params.id)])).get(
			Number(descriptor.params.id),
		) ?? null
	);
}

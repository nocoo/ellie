/** Business cache lifetimes. Runtime state (sessions, locks, counters) is separate. */
export const CACHE_TTL_SECONDS = {
	SHORT: 60,
	MEDIUM: 1800,
	HOUR: 3600,
	LONG: 86400,
} as const;

export type CacheTier = keyof typeof CACHE_TTL_SECONDS;
export type CacheParams = Record<string, string | number | boolean | null>;

export const CACHE_SCHEMA_VERSION = 3;

export interface CacheDescriptor {
	family: string;
	params: CacheParams;
	scope: string;
}

export interface CacheEnvelope<T = unknown> extends CacheDescriptor {
	schemaVersion: typeof CACHE_SCHEMA_VERSION;
	tier: CacheTier;
	loadedAt: number;
	expiresAt: number;
	data: T;
}

export function getCacheTTL(tier: CacheTier): number {
	if (!Object.hasOwn(CACHE_TTL_SECONDS, tier)) {
		throw new RangeError("Business cache tier must be SHORT, MEDIUM, HOUR, or LONG");
	}
	return CACHE_TTL_SECONDS[tier];
}

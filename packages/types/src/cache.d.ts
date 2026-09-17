/** Business cache lifetimes. Runtime state (sessions, locks, counters) is separate. */
export declare const CACHE_TTL_SECONDS: {
    readonly SHORT: 60;
    readonly MEDIUM: 1800;
    readonly LONG: 86400;
};
export type CacheTier = keyof typeof CACHE_TTL_SECONDS;
export type CacheParams = Record<string, string | number | boolean | null>;
export declare const CACHE_SCHEMA_VERSION = 3;
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
export declare function getCacheTTL(tier: CacheTier): number;

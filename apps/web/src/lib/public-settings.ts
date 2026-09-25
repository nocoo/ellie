import "server-only";

import { forumApi } from "./forum-api";
import { createTtlCache, type TtlCache } from "./ttl-cache";

export type SettingsMap = Record<string, string | number | boolean | object>;

const processState = globalThis as typeof globalThis & {
	__elliePublicSettings?: TtlCache<SettingsMap>;
};
const publicSettings =
	processState.__elliePublicSettings ??
	createTtlCache({
		expirationMs: 5 * 60_000,
		load: async () => (await forumApi.get<SettingsMap>("/api/v1/settings")).data,
	});
processState.__elliePublicSettings = publicSettings;

export async function getPublicSettings(): Promise<SettingsMap> {
	return structuredClone(await publicSettings.get());
}

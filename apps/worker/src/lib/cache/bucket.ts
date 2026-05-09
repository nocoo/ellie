// Bucket builders for cache keys.
//
// See docs/19 §2.2 (visibility bucket) and §2.3 (viewer bucket).
//
// CRITICAL: `UserRole` is non-monotonic (`User=0, Admin=1, SuperMod=2,
// Mod=3`). All comparisons MUST be `===` enumerations, never `<=`. `admin`
// is independent from `staff` — folding Admin into `staff` would leak
// admin-only forums to mods.

import type { VisibilityContext } from "@ellie/types";
import { UserRole } from "@ellie/types";
import type { ViewerBucket, VisibilityBucket } from "./keys";

/**
 * Compute the four-tier visibility bucket used by forum / thread / post /
 * digest cache keys.
 */
export function computeVisibilityBucket(visCtx: VisibilityContext): VisibilityBucket {
	if (!visCtx.isLoggedIn) return "anon";
	if (visCtx.role === UserRole.Admin) return "admin";
	if (visCtx.role === UserRole.Mod || visCtx.role === UserRole.SuperMod) return "staff";
	// UserRole.User and any unknown role default to `member` for logged-in users.
	return "member";
}

/**
 * Compute the two-tier viewer bucket used by `user:public:v2` cache keys.
 * `staff` covers Mod / SuperMod / Admin (those who see `regIp` / `lastIp`);
 * `public` covers anon and ordinary members.
 */
export function computeViewerBucket(visCtx: VisibilityContext): ViewerBucket {
	if (!visCtx.isLoggedIn) return "public";
	if (
		visCtx.role === UserRole.Mod ||
		visCtx.role === UserRole.SuperMod ||
		visCtx.role === UserRole.Admin
	) {
		return "staff";
	}
	return "public";
}

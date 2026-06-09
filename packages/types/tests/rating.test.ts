import {
	canRateDimension,
	canRevokeRating,
	EMPTY_RATING_AGGREGATE,
	getRatingPerDayCap,
	getRatingPerVoteBounds,
	RATING_DIMENSION_KEYS,
	RATING_LIMITS,
	RATING_QUOTA_WINDOW_SECONDS,
	RATING_REASON_MAX_LENGTH,
	RatingDimension,
	ratingDimensionToKey,
	ratingKeyToDimension,
	UserRole,
} from "@ellie/types";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// RATING_LIMITS — the hardcoded MVP caps per §1 decision #1 of docs/22.
// These are the entire contract surface between Worker handlers (quota
// enforcement) and the Web dialog (input bounds + UI hint text), so pin
// the exact numbers in a test — any future tweak should land here and
// in the doc together.
// ---------------------------------------------------------------------------

describe("RATING_LIMITS — hardcoded MVP constants", () => {
	it("coins: 5200/day unified across roles, 1..100 per vote", () => {
		expect(RATING_LIMITS.coins.perDay).toBe(5200);
		expect(RATING_LIMITS.coins.perVoteMax).toBe(100);
		expect(RATING_LIMITS.coins.perVoteMin).toBe(1);
	});

	it("credits: per-role daily caps (Mod 100 / SuperMod 200 / Admin 200)", () => {
		expect(RATING_LIMITS.credits.perDay[UserRole.Mod]).toBe(100);
		expect(RATING_LIMITS.credits.perDay[UserRole.SuperMod]).toBe(200);
		expect(RATING_LIMITS.credits.perDay[UserRole.Admin]).toBe(200);
	});

	it("credits per-vote bounds 1..50", () => {
		expect(RATING_LIMITS.credits.perVoteMax).toBe(50);
		expect(RATING_LIMITS.credits.perVoteMin).toBe(1);
	});

	it("reason cap matches legacy char(40)", () => {
		expect(RATING_REASON_MAX_LENGTH).toBe(40);
	});

	it("quota window is exactly 24h in seconds", () => {
		expect(RATING_QUOTA_WINDOW_SECONDS).toBe(86_400);
	});
});

// ---------------------------------------------------------------------------
// Lookup helpers — boundary behaviour. These are called from the Worker
// hot path on every rate POST.
// ---------------------------------------------------------------------------

describe("getRatingPerDayCap", () => {
	it("coins cap is role-independent and matches RATING_LIMITS.coins.perDay", () => {
		for (const role of [UserRole.User, UserRole.Mod, UserRole.SuperMod, UserRole.Admin]) {
			expect(getRatingPerDayCap(role, RatingDimension.Coins)).toBe(5200);
		}
	});

	it("credits cap follows the role table; User → 0 (no permission, defensive)", () => {
		expect(getRatingPerDayCap(UserRole.User, RatingDimension.Credits)).toBe(0);
		expect(getRatingPerDayCap(UserRole.Mod, RatingDimension.Credits)).toBe(100);
		expect(getRatingPerDayCap(UserRole.SuperMod, RatingDimension.Credits)).toBe(200);
		expect(getRatingPerDayCap(UserRole.Admin, RatingDimension.Credits)).toBe(200);
	});
});

describe("getRatingPerVoteBounds", () => {
	it("coins → 1..100", () => {
		expect(getRatingPerVoteBounds(RatingDimension.Coins)).toEqual({ min: 1, max: 100 });
	});
	it("credits → 1..50", () => {
		expect(getRatingPerVoteBounds(RatingDimension.Credits)).toEqual({ min: 1, max: 50 });
	});
});

// ---------------------------------------------------------------------------
// Permission helpers — mirror §3 matrix.
// ---------------------------------------------------------------------------

describe("canRateDimension", () => {
	it("User can rate coins but not credits", () => {
		expect(canRateDimension(UserRole.User, RatingDimension.Coins)).toBe(true);
		expect(canRateDimension(UserRole.User, RatingDimension.Credits)).toBe(false);
	});
	it("Mod / SuperMod / Admin can rate both", () => {
		for (const role of [UserRole.Mod, UserRole.SuperMod, UserRole.Admin]) {
			expect(canRateDimension(role, RatingDimension.Coins)).toBe(true);
			expect(canRateDimension(role, RatingDimension.Credits)).toBe(true);
		}
	});
});

describe("canRevokeRating", () => {
	it("only Admin and SuperMod can revoke", () => {
		expect(canRevokeRating(UserRole.User)).toBe(false);
		expect(canRevokeRating(UserRole.Mod)).toBe(false);
		expect(canRevokeRating(UserRole.SuperMod)).toBe(true);
		expect(canRevokeRating(UserRole.Admin)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Dimension key codec — round-trips both ways. The wire payload uses the
// string keys; storage/SQL uses the integer enum.
// ---------------------------------------------------------------------------

describe("dimension codec", () => {
	it("round-trips key → enum → key", () => {
		for (const key of RATING_DIMENSION_KEYS) {
			expect(ratingDimensionToKey(ratingKeyToDimension(key))).toBe(key);
		}
	});
	it("enum 1 ↔ credits, enum 2 ↔ coins", () => {
		expect(ratingDimensionToKey(RatingDimension.Credits)).toBe("credits");
		expect(ratingDimensionToKey(RatingDimension.Coins)).toBe("coins");
		expect(ratingKeyToDimension("credits")).toBe(RatingDimension.Credits);
		expect(ratingKeyToDimension("coins")).toBe(RatingDimension.Coins);
	});
});

// ---------------------------------------------------------------------------
// Zero-state aggregate is immutable & shape-stable.
// ---------------------------------------------------------------------------

describe("EMPTY_RATING_AGGREGATE", () => {
	it("matches the per-dimension zero shape", () => {
		expect(EMPTY_RATING_AGGREGATE).toEqual({
			total: 0,
			credits: { count: 0, sum: 0 },
			coins: { count: 0, sum: 0 },
		});
	});
});

// models/thread.ts — Thread model pure functions
// Ref: 04d §ThreadBadge + §highlight, 04e §special badges

import type { Thread } from "./types";
import { StickyLevel } from "./types";

// ─── ThreadBadge ────────────────────────────────────────

export interface ThreadBadge {
	type: string;
	label: string;
	variant: "destructive" | "warning" | "default" | "success" | "secondary";
}

/**
 * Minimal structural input for `getThreadBadges`.
 *
 * Anything carrying these five fields can produce display badges, so both the
 * full `Thread` and the trimmer `PostThreadSummary` (used by the user profile
 * "回复" tab) flow through the same helper without union types or casts at the
 * call site.
 */
export type ThreadBadgeSource = Pick<
	Thread,
	"typeName" | "sticky" | "digest" | "closed" | "special"
>;

/** Special type badge mapping (04e §1) */
const SPECIAL_BADGES: Record<number, { label: string; variant: ThreadBadge["variant"] }> = {
	1: { label: "投票", variant: "default" },
	2: { label: "交易", variant: "warning" },
	3: { label: "悬赏", variant: "warning" },
	4: { label: "活动", variant: "default" },
	5: { label: "辩论", variant: "default" },
};

/**
 * Optional knobs for `getThreadBadges`.
 *
 * `includeTypeNameBadge` defaults to `true` so the helper's historical
 * behavior is unchanged for every caller that doesn't opt in. Forum-list
 * callers that know the forum's `thread_types_prefix` switch can pass
 * `false` to suppress the prefix badge without touching the denorm
 * `thread.typeName` field — that way historical disabled/tombstone
 * categories still surface on forums that keep the prefix toggle on
 * (reviewer msg 94b13fd4: required-vs-prefix is an explicit caller
 * decision, not a default change in this helper).
 */
export interface GetThreadBadgesOptions {
	/** When `false`, omit the leading `typeName` (prefix) badge. Default `true`. */
	includeTypeNameBadge?: boolean;
}

/** Compute display badges for a thread (typeName, sticky, digest, closed, special). */
export function getThreadBadges(
	thread: ThreadBadgeSource,
	options: GetThreadBadgesOptions = {},
): ThreadBadge[] {
	const { includeTypeNameBadge = true } = options;
	const badges: ThreadBadge[] = [];

	// Type classification badge (shown first, before sticky/digest).
	// Suppressed when the forum has `thread_types_prefix=false` — caller
	// passes `includeTypeNameBadge: false` for those forums.
	if (includeTypeNameBadge && thread.typeName) {
		badges.push({
			type: "typeName",
			label: thread.typeName,
			variant: "secondary",
		});
	}

	// Sticky badges (mutually exclusive levels)
	if (thread.sticky === StickyLevel.Global)
		badges.push({
			type: "sticky",
			label: "全局置顶",
			variant: "destructive",
		});
	if (thread.sticky === StickyLevel.Category)
		badges.push({ type: "sticky", label: "分类置顶", variant: "warning" });
	if (thread.sticky === StickyLevel.Forum)
		badges.push({ type: "sticky", label: "置顶", variant: "default" });

	// Digest badge (1~3 levels)
	if (thread.digest > 0) {
		const level = thread.digest > 1 ? ` ${"I".repeat(thread.digest)}` : "";
		badges.push({
			type: "digest",
			label: `精华${level}`,
			variant: "success",
		});
	}

	// Closed badge
	if (thread.closed === 1) badges.push({ type: "closed", label: "锁定", variant: "secondary" });

	// Special type badges (04e)
	if (thread.special > 0 && SPECIAL_BADGES[thread.special]) {
		const badge = SPECIAL_BADGES[thread.special];
		badges.push({
			type: "special",
			label: badge.label,
			variant: badge.variant,
		});
	}

	return badges;
}

// ─── Highlight Decode ───────────────────────────────────

export interface HighlightStyle {
	color: string | null;
	bold: boolean;
	italic: boolean;
	underline: boolean;
}

/**
 * Decode DZ highlight field into style object.
 *
 * DZ encoding (from function_forum.php):
 * - Bits 0-23: RGB color (0xRRGGBB)
 * - Bit 24: bold
 * - Bit 25: italic
 * - Bit 26: underline
 *
 * Returns null for highlight === 0 (no styling).
 */
export function decodeHighlight(highlight: number): HighlightStyle | null {
	if (highlight === 0) return null;

	const colorBits = highlight & 0xffffff;
	const color = colorBits > 0 ? `#${colorBits.toString(16).padStart(6, "0")}` : null;

	const bold = (highlight & (1 << 24)) !== 0;
	const italic = (highlight & (1 << 25)) !== 0;
	const underline = (highlight & (1 << 26)) !== 0;

	return { color, bold, italic, underline };
}

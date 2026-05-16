import type { Thread } from "./types";
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
export type ThreadBadgeSource = Pick<Thread, "typeName" | "sticky" | "digest" | "closed" | "special">;
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
export declare function getThreadBadges(thread: ThreadBadgeSource, options?: GetThreadBadgesOptions): ThreadBadge[];
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
export declare function decodeHighlight(highlight: number): HighlightStyle | null;

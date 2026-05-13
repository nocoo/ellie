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
/** Compute display badges for a thread (typeName, sticky, digest, closed, special). */
export declare function getThreadBadges(thread: ThreadBadgeSource): ThreadBadge[];
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

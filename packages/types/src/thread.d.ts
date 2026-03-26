import type { Thread } from "./types";
export interface ThreadBadge {
	type: string;
	label: string;
	variant: "destructive" | "warning" | "default" | "success" | "secondary";
}
/** Compute display badges for a thread (sticky, digest, closed, special). */
export declare function getThreadBadges(thread: Thread): ThreadBadge[];
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

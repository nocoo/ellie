// components/forum/smiley-image.tsx — Smiley image compatibility renderer
// Ref: 04e §表情系统 — renders /smileys/ images safely in post content

import { SMILEY_SIZE, isSmileyUrl, smileyClassName } from "@/viewmodels/forum/smiley";

interface SmileyImageProps {
	/** Image source path, must start with /smileys/ */
	src: string;
	/** Alt text for accessibility (typically the original smiley code) */
	alt?: string;
}

/**
 * Renders a smiley image with consistent sizing and validation.
 *
 * In practice, post HTML already contains <img class="smiley"> tags from
 * migration (Doc03), rendered via dangerouslySetInnerHTML in PostContent.
 * This component is for cases where smileys need to be rendered individually
 * (e.g. smiley picker preview, debug views).
 */
export function SmileyImage({ src, alt = "" }: SmileyImageProps) {
	if (!isSmileyUrl(src)) {
		return null;
	}

	return (
		<img
			src={src}
			alt={alt}
			width={SMILEY_SIZE.width}
			height={SMILEY_SIZE.height}
			className={smileyClassName()}
			loading="lazy"
			decoding="async"
		/>
	);
}

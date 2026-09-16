import { FORUM_LOGOS, resolveSiteAsset, SITE_ASSET_BASE } from "@ellie/shared";

interface ForumLogoProps {
	/** Height in pixels. Width scales proportionally via w-auto. */
	height: number;
	className?: string;
	/** Rendered width for responsive source selection. */
	sizes?: string;
	/** Force a specific variant instead of auto-detecting from theme */
	variant?: "auto" | "light" | "dark";
	/** Override light-theme logo URL */
	lightSrc?: string;
	/** Override dark-theme logo URL */
	darkSrc?: string;
	/** Override alt text */
	alt?: string;
}

export function ForumLogo({
	height,
	className = "",
	sizes = `${height * 3}px`,
	variant = "auto",
	lightSrc = FORUM_LOGOS.light,
	darkSrc = FORUM_LOGOS.dark,
	alt = "Ellie",
}: ForumLogoProps) {
	return (variant === "auto" ? ["light", "dark"] : [variant]).map((theme) => {
		const src = resolveSiteAsset(theme === "light" ? lightSrc : darkSrc);
		if (!src) return null;
		const optimized = src === FORUM_LOGOS.light || src === FORUM_LOGOS.dark;
		const sourceTheme = src === FORUM_LOGOS.light ? "light" : "dark";
		return (
			<img
				key={theme}
				src={src}
				srcSet={
					optimized
						? [120, 240, 360, 600]
								.map(
									(width) => `${SITE_ASSET_BASE}/forum-logo-${sourceTheme}-${width}.webp ${width}w`,
								)
								.join(", ")
						: undefined
				}
				sizes={optimized ? sizes : undefined}
				width={optimized ? 600 : undefined}
				height={optimized ? 200 : height}
				alt={alt}
				decoding="async"
				style={{ height }}
				className={`w-auto ${variant === "auto" ? (theme === "light" ? "dark:hidden" : "hidden dark:block") : ""} ${className}`}
			/>
		);
	});
}

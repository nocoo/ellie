// components/forum/forum-logo.tsx — Shared forum logo with light/dark mode support
// Uses two external images that swap via CSS dark: variant.

const DEFAULT_LOGO_LIGHT = "https://t.no.mt/ellie/Logo-light-2.png";
const DEFAULT_LOGO_DARK = "https://t.no.mt/ellie/Logo-dark-2.png";

interface ForumLogoProps {
	/** Height in pixels. Width scales proportionally via w-auto. */
	height: number;
	className?: string;
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
	variant = "auto",
	lightSrc = DEFAULT_LOGO_LIGHT,
	darkSrc = DEFAULT_LOGO_DARK,
	alt = "Ellie",
}: ForumLogoProps) {
	// Force light variant (dark logo for light backgrounds)
	if (variant === "light") {
		return <img src={lightSrc} alt={alt} style={{ height }} className={`w-auto ${className}`} />;
	}

	// Force dark variant (light logo for dark backgrounds)
	if (variant === "dark") {
		return <img src={darkSrc} alt={alt} style={{ height }} className={`w-auto ${className}`} />;
	}

	// Auto: swap based on theme
	return (
		<>
			<img
				src={lightSrc}
				alt={alt}
				style={{ height }}
				className={`w-auto dark:hidden ${className}`}
			/>
			<img
				src={darkSrc}
				alt={alt}
				style={{ height }}
				className={`hidden w-auto dark:block ${className}`}
			/>
		</>
	);
}

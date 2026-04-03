// components/forum/forum-logo.tsx — Shared forum logo with light/dark mode support
// Uses two external images that swap via CSS dark: variant.

interface ForumLogoProps {
	/** Height in pixels. Width scales proportionally via w-auto. */
	height: number;
	className?: string;
	/** Force a specific variant instead of auto-detecting from theme */
	variant?: "auto" | "light" | "dark";
}

const LOGO_LIGHT = "https://t.no.mt/ellie/Logo-light.jpg";
const LOGO_DARK = "https://t.no.mt/ellie/Logo-dark.jpg";

export function ForumLogo({ height, className = "", variant = "auto" }: ForumLogoProps) {
	// Force light variant (dark logo for light backgrounds)
	if (variant === "light") {
		return (
			<img src={LOGO_LIGHT} alt="Ellie" style={{ height }} className={`w-auto ${className}`} />
		);
	}

	// Force dark variant (light logo for dark backgrounds)
	if (variant === "dark") {
		return <img src={LOGO_DARK} alt="Ellie" style={{ height }} className={`w-auto ${className}`} />;
	}

	// Auto: swap based on theme
	return (
		<>
			<img
				src={LOGO_LIGHT}
				alt="Ellie"
				style={{ height }}
				className={`w-auto dark:hidden ${className}`}
			/>
			<img
				src={LOGO_DARK}
				alt="Ellie"
				style={{ height }}
				className={`hidden w-auto dark:block ${className}`}
			/>
		</>
	);
}

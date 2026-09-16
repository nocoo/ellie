/** Immutable, pre-optimized R2 assets. Manifests and source credits live in assets/site/. */
export const SITE_ASSET_BASE = "https://t.no.mt/ellie/site/1.10.1";
export const FORUM_ART_BASE = "https://t.no.mt/ellie/site/1.10.2";

export const FORUM_LOGOS = {
	light: `${SITE_ASSET_BASE}/forum-logo-light-600.webp`,
	dark: `${SITE_ASSET_BASE}/forum-logo-dark-600.webp`,
};

export const ADMIN_LOGO = {
	src: `${SITE_ASSET_BASE}/admin-logo-192.webp`,
	srcSet: [24, 48, 96, 192, 384, 768]
		.map((width) => `${SITE_ASSET_BASE}/admin-logo-${width}.webp ${width}w`)
		.join(", "),
};

function artwork(name: string, width: number, base = SITE_ASSET_BASE) {
	const src = `${base}/${name}-${width}.webp`;
	return {
		src,
		imageSet: `image-set(url("${src}") 1x, url("${base}/${name}-${width * 2}.webp") 2x)`,
	};
}

export const SITE_ART = {
	// Keep the immutable R2 filenames while placing campus above the Shanghai panorama.
	header: {
		light: artwork("footer-light", 768, FORUM_ART_BASE),
		dark: artwork("footer-dark", 768, FORUM_ART_BASE),
	},
	footer: {
		light: artwork("header-light", 768, FORUM_ART_BASE),
		dark: artwork("header-dark", 768, FORUM_ART_BASE),
	},
	admin: { light: artwork("admin-light", 384), dark: artwork("admin-dark", 384) },
};

const LEGACY_ASSETS = new Map([
	["https://t.no.mt/ellie/Logo-light-2.png", FORUM_LOGOS.light],
	["https://t.no.mt/ellie/Logo-dark-2.png", FORUM_LOGOS.dark],
	["https://t.no.mt/ellie/Logo-light.jpg", FORUM_LOGOS.light],
	["https://t.no.mt/ellie/Logo-dark.jpg", FORUM_LOGOS.dark],
	["https://t.no.mt/ellie/Bg-shanghai-light.png", SITE_ART.footer.light.src],
	["https://t.no.mt/ellie/Bg-shanghai-dark.png", SITE_ART.footer.dark.src],
	["https://t.no.mt/ellie/bg_footer_light_01.jpg", SITE_ART.footer.light.src],
	["https://t.no.mt/ellie/bg_footer_dark_01.jpg", SITE_ART.footer.dark.src],
	...(["light", "dark"] as const).flatMap((theme) =>
		[384, 768, 1536].map(
			(width) =>
				[`${SITE_ASSET_BASE}/footer-${theme}-${width}.webp`, SITE_ART.footer[theme].src] as const,
		),
	),
]);

/** Upgrade only the shipped assets; preserve custom URLs and deliberately empty settings. */
export function resolveSiteAsset(src: string): string {
	return LEGACY_ASSETS.get(src) ?? src;
}

const ARTWORK_BACKGROUNDS = new Map(
	Object.values(SITE_ART).flatMap((themes) =>
		Object.values(themes).map((art) => [art.src, art.imageSet] as const),
	),
);

export function siteArtworkBackground(src: string): string {
	const resolved = resolveSiteAsset(src);
	return (
		ARTWORK_BACKGROUNDS.get(resolved) ?? (resolved ? `url(${JSON.stringify(resolved)})` : "none")
	);
}

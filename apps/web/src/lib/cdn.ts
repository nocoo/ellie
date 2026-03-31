// CDN helpers for Discuz static assets hosted on R2.

const CDN_BASE = "https://t.no.mt";

/** Static image URL under /static/image/common/ */
export function getStaticImageUrl(filename: string): string {
	return `${CDN_BASE}/static/image/common/${filename}`;
}

/** Smiley image URL under /static/image/smiley/{directory}/{filename} */
export function getSmileyUrl(directory: string, filename: string): string {
	return `${CDN_BASE}/static/image/smiley/${directory}/${filename}`;
}

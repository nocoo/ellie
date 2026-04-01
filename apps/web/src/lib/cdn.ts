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

/** Attachment URL — filePath is the relative path stored in DB */
export function getAttachmentUrl(filePath: string): string {
	// filePath might already be absolute or relative
	if (filePath.startsWith("http://") || filePath.startsWith("https://")) {
		return filePath;
	}
	// Ensure leading slash
	const path = filePath.startsWith("/") ? filePath : `/${filePath}`;
	return `${CDN_BASE}${path}`;
}

/** Attachment thumbnail URL */
export function getAttachmentThumbUrl(filePath: string): string {
	const url = getAttachmentUrl(filePath);
	return `${url}.thumb.jpg`;
}

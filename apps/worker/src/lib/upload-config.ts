// Upload configuration — defines constraints per upload purpose
// Extensible for future use cases (e.g., post attachments)

export interface UploadConfig {
	/** Maximum file size in bytes */
	maxSize: number;
	/** Allowed MIME types */
	allowedMimeTypes: string[];
	/** Human-readable list of accepted formats, used in error messages */
	formatsLabel: string;
}

export const UPLOAD_CONFIGS: Record<string, UploadConfig> = {
	avatar: {
		maxSize: 200 * 1024, // 200 KB
		allowedMimeTypes: ["image/jpeg", "image/png"],
		formatsLabel: "JPG, PNG",
	},
	"post-image": {
		// 5 MB — large enough for typical screenshots/photos, small enough
		// to keep R2 + edge bandwidth predictable.
		maxSize: 5 * 1024 * 1024,
		allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
		formatsLabel: "JPG, PNG, WebP, GIF",
	},
};

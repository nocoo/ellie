// Upload configuration — defines constraints per upload purpose
// Extensible for future use cases (e.g., post attachments)

export interface UploadConfig {
	/** Maximum file size in bytes */
	maxSize: number;
	/** Allowed MIME types */
	allowedMimeTypes: string[];
}

export const UPLOAD_CONFIGS: Record<string, UploadConfig> = {
	avatar: {
		maxSize: 200 * 1024, // 200 KB
		allowedMimeTypes: ["image/jpeg", "image/png"],
	},
	// Future: add attachment config with different limits
};

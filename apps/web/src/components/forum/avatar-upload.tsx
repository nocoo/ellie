"use client";

// Avatar upload component with drag-and-drop support
// Validates client-side then uploads to /api/v1/upload with purpose=avatar

import { cn } from "@/lib/utils";
import { parseAvatarUploadResponse } from "@/viewmodels/forum/avatar-upload";
import { dispatchEmailNotVerified } from "@/viewmodels/forum/email-not-verified-dispatch";
import { Loader2, Upload } from "lucide-react";
import { type DragEvent, useCallback, useState } from "react";

interface AvatarUploadProps {
	currentUrl: string;
	onUploadComplete: (newUrl: string) => void;
	disabled?: boolean;
}

const MAX_SIZE_KB = 200;
const ALLOWED_TYPES = ["image/jpeg", "image/png"];

export function AvatarUpload({ currentUrl, onUploadComplete, disabled }: AvatarUploadProps) {
	const [isDragging, setIsDragging] = useState(false);
	const [isUploading, setIsUploading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [previewUrl, setPreviewUrl] = useState(currentUrl);

	const validateFile = useCallback((file: File): string | null => {
		if (!ALLOWED_TYPES.includes(file.type)) {
			return "仅支持 JPG 和 PNG 格式";
		}
		if (file.size > MAX_SIZE_KB * 1024) {
			return `文件大小不能超过 ${MAX_SIZE_KB} KB`;
		}
		return null;
	}, []);

	const uploadFile = useCallback(
		async (file: File) => {
			// Client-side validation
			const validationError = validateFile(file);
			if (validationError) {
				setError(validationError);
				return;
			}

			setIsUploading(true);
			setError(null);

			const formData = new FormData();
			formData.append("file", file);
			formData.append("purpose", "avatar");

			try {
				const res = await fetch("/api/v1/upload", {
					method: "POST",
					body: formData,
				});
				let json: unknown;
				try {
					json = await res.json();
				} catch {
					json = null;
				}

				const parsed = parseAvatarUploadResponse(res.status, json);
				if (parsed.kind === "success") {
					// Add cache-busting timestamp for immediate refresh
					const newUrl = `${parsed.url}?v=${Date.now()}`;
					setPreviewUrl(newUrl);
					onUploadComplete(newUrl);
				} else if (parsed.kind === "email-not-verified") {
					// Hand off to the global verification dialog (same path as
					// the api-client interceptor uses for JSON responses).
					dispatchEmailNotVerified(parsed.detail);
					setError("请先验证邮箱后再上传头像");
				} else {
					setError(parsed.message);
				}
			} catch {
				setError("上传失败，请重试");
			} finally {
				setIsUploading(false);
			}
		},
		[onUploadComplete, validateFile],
	);

	const handleDrop = (e: DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		setIsDragging(false);

		if (disabled || isUploading) return;

		const file = e.dataTransfer.files[0];
		if (file) uploadFile(file);
	};

	const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		if (!disabled && !isUploading) {
			setIsDragging(true);
		}
	};

	const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		setIsDragging(false);
	};

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file) uploadFile(file);
		// Reset input so same file can be selected again
		e.target.value = "";
	};

	const isDisabled = disabled || isUploading;

	return (
		<div className="space-y-3">
			<div
				onDrop={handleDrop}
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
				className={cn(
					"relative rounded-lg border-2 border-dashed p-4 transition-colors",
					isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25",
					isDisabled && "pointer-events-none opacity-50",
				)}
			>
				<div className="flex flex-col items-center gap-3">
					{/* Preview */}
					<div className="relative">
						<img
							src={previewUrl}
							alt="头像预览"
							className="h-20 w-20 rounded-full object-cover border-2 border-background shadow-sm"
						/>
						{isUploading && (
							<div className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70">
								<Loader2 className="h-6 w-6 animate-spin text-primary" />
							</div>
						)}
					</div>

					{/* Instructions */}
					<div className="text-center">
						<div className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
							<Upload className="h-4 w-4" />
							<span>拖拽图片到此处，或点击上传</span>
						</div>
						<p className="text-xs text-muted-foreground/70 mt-1">
							JPG / PNG，最大 {MAX_SIZE_KB} KB
						</p>
					</div>
				</div>

				{/* Invisible file input */}
				<input
					type="file"
					accept={ALLOWED_TYPES.join(",")}
					className="absolute inset-0 cursor-pointer opacity-0"
					onChange={handleFileChange}
					disabled={isDisabled}
					aria-label="上传头像"
				/>
			</div>

			{/* Error message */}
			{error && <p className="text-sm text-destructive text-center">{error}</p>}
		</div>
	);
}

"use client";

// Avatar upload component with drag-and-drop support
// Validates client-side then uploads to /api/v1/upload with purpose=avatar

import { useForumToast } from "@/components/forum/forum-toast";
import { uploadAvatar } from "@/lib/forum-browser-api";
import { cn } from "@/lib/utils";
import { invalidateWriteGateCache } from "@/viewmodels/forum/write-gate";
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
	const toast = useForumToast();
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
				toast.error({ title: "头像上传失败", description: validationError });
				return;
			}

			setIsUploading(true);
			setError(null);

			try {
				const parsed = await uploadAvatar(file);
				if (parsed.kind === "success") {
					// Add cache-busting timestamp for immediate refresh
					const newUrl = `${parsed.url}?v=${Date.now()}`;
					setPreviewUrl(newUrl);
					onUploadComplete(newUrl);
					invalidateWriteGateCache();
					toast.success("头像已上传");
				} else if (parsed.kind === "email-not-verified") {
					// `apiClient.upload` already dispatched the global §5.4 event
					// (single source of truth). Component only renders inline
					// error + toast; do NOT re-dispatch here.
					setError("请先验证邮箱后再上传头像");
					toast.error({ title: "头像上传失败", description: "请先验证邮箱后再上传头像" });
				} else {
					setError(parsed.message);
					toast.error({ title: "头像上传失败", description: parsed.message });
				}
			} catch {
				setError("上传失败，请重试");
				toast.error({ title: "头像上传失败", description: "上传失败，请重试" });
			} finally {
				setIsUploading(false);
			}
		},
		[onUploadComplete, validateFile, toast],
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

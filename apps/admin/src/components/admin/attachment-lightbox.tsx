"use client";

import { Button, Dialog, DialogClose, DialogTitle, LayerCard, Separator } from "@nocoo/basalt";
import { ChevronLeft, ChevronRight, Download, Loader2, X, ZoomIn, ZoomOut } from "lucide-react";
import { useState } from "react";
import { AdminDialogContent } from "./admin-dialog-content";
import { AdminInlineMessage } from "./admin-inline-message";

export interface AttachmentPreviewImage {
	src: string;
	alt?: string;
	title?: string;
}

interface AttachmentLightboxProps {
	images: AttachmentPreviewImage[];
	initialIndex?: number;
	open: boolean;
	onClose: () => void;
}

export function AttachmentLightbox({
	images,
	initialIndex = 0,
	open,
	onClose,
}: AttachmentLightboxProps) {
	return (
		<Dialog
			open={open && images.length > 0}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			{open && images.length > 0 && (
				<AttachmentViewer key={initialIndex} images={images} initialIndex={initialIndex} />
			)}
		</Dialog>
	);
}

function AttachmentViewer({
	images,
	initialIndex,
}: {
	images: AttachmentPreviewImage[];
	initialIndex: number;
}) {
	const [index, setIndex] = useState(() => Math.max(0, Math.min(initialIndex, images.length - 1)));
	const [scale, setScale] = useState(1);
	const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
	const [failedSrc, setFailedSrc] = useState<string | null>(null);
	const currentIndex = Math.min(index, images.length - 1);
	const current = images[currentIndex];
	if (!current) return null;

	const select = (next: number) => {
		setIndex((next + images.length) % images.length);
		setScale(1);
	};
	const zoom = (delta: number) => setScale((value) => Math.max(0.5, Math.min(4, value + delta)));
	const loading = loadedSrc !== current.src && failedSrc !== current.src;

	return (
		<AdminDialogContent
			closeControl={false}
			aria-describedby={undefined}
			className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[1440px] flex-col gap-3 overflow-hidden p-3 sm:w-[calc(100vw-2rem)] md:p-5"
			onKeyDown={(event) => {
				if (event.altKey || event.ctrlKey || event.metaKey) return;
				switch (event.key) {
					case "ArrowLeft":
						select(currentIndex - 1);
						break;
					case "ArrowRight":
						select(currentIndex + 1);
						break;
					case "+":
					case "=":
						zoom(0.5);
						break;
					case "-":
						zoom(-0.5);
						break;
					default:
						return;
				}
				event.preventDefault();
			}}
		>
			<DialogTitle className="sr-only">图片预览</DialogTitle>
			<div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
				<p className="min-w-0 flex-1 truncate text-sm">
					{currentIndex + 1} / {images.length} · {current.title || current.alt || "图片"}
				</p>
				<div className="flex items-center gap-1">
					<Button
						variant="ghost"
						size="icon"
						aria-label="缩小图片"
						onClick={() => zoom(-0.5)}
						disabled={scale <= 0.5}
					>
						<ZoomOut />
					</Button>
					<output aria-label="缩放比例" className="w-12 text-center text-sm tabular-nums">
						{Math.round(scale * 100)}%
					</output>
					<Button
						variant="ghost"
						size="icon"
						aria-label="放大图片"
						onClick={() => zoom(0.5)}
						disabled={scale >= 4}
					>
						<ZoomIn />
					</Button>
					<Separator orientation="vertical" className="mx-1 h-5" />
					<Button variant="ghost" size="icon" asChild>
						<a
							href={current.src}
							download={current.title || `image-${currentIndex + 1}`}
							target="_blank"
							rel="noopener noreferrer"
							aria-label="下载图片"
						>
							<Download />
						</a>
					</Button>
					<DialogClose asChild>
						<Button variant="ghost" size="icon" aria-label="关闭图片预览">
							<X />
						</Button>
					</DialogClose>
				</div>
			</div>

			{failedSrc === current.src && (
				<AdminInlineMessage variant="error" text="图片加载失败，可通过下载按钮打开原图。" dense />
			)}
			<LayerCard padding="none" className="relative min-h-0 flex-1">
				<div className="absolute inset-0 overflow-auto">
					<div
						className="relative mx-auto"
						style={{
							width: `${scale * 100}%`,
							height: `${scale * 100}%`,
							top: scale < 1 ? `${(1 - scale) * 50}%` : 0,
						}}
					>
						<img
							key={current.src}
							src={current.src}
							alt={current.alt || current.title || "附件图片"}
							className="h-full w-full max-w-none object-contain"
							onLoad={() => {
								setLoadedSrc(current.src);
								setFailedSrc(null);
							}}
							onError={() => setFailedSrc(current.src)}
							draggable={false}
						/>
					</div>
				</div>
				{loading && (
					<div
						role="status"
						aria-label="加载图片"
						className="pointer-events-none absolute inset-0 flex items-center justify-center"
					>
						<Loader2 className="h-8 w-8 animate-spin" />
					</div>
				)}
				{images.length > 1 && (
					<>
						<Button
							variant="secondary"
							size="icon"
							className="absolute left-2 top-1/2 -translate-y-1/2"
							aria-label="上一张图片"
							onClick={() => select(currentIndex - 1)}
						>
							<ChevronLeft />
						</Button>
						<Button
							variant="secondary"
							size="icon"
							className="absolute right-2 top-1/2 -translate-y-1/2"
							aria-label="下一张图片"
							onClick={() => select(currentIndex + 1)}
						>
							<ChevronRight />
						</Button>
					</>
				)}
			</LayerCard>
			{images.length > 1 && (
				<fieldset className="flex shrink-0 gap-2 overflow-x-auto py-1" aria-label="图片缩略图">
					{images.map((image, i) => (
						<Button
							key={image.src}
							variant="ghost"
							className={`h-14 w-14 shrink-0 overflow-hidden p-0 ${i === currentIndex ? "ring-2 ring-basalt-primary" : ""}`}
							aria-label={`查看第 ${i + 1} 张图片`}
							aria-pressed={i === currentIndex}
							onClick={() => select(i)}
						>
							<img src={image.src} alt="" className="h-full w-full object-cover" />
						</Button>
					))}
				</fieldset>
			)}
		</AdminDialogContent>
	);
}

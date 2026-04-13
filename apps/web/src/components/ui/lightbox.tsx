"use client";

import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Download, X, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

export interface LightboxImage {
	src: string;
	alt?: string;
	title?: string;
}

interface LightboxProps {
	images: LightboxImage[];
	initialIndex?: number;
	open: boolean;
	onClose: () => void;
}

export function Lightbox({ images, initialIndex = 0, open, onClose }: LightboxProps) {
	const [currentIndex, setCurrentIndex] = useState(initialIndex);
	const [scale, setScale] = useState(1);
	const [loading, setLoading] = useState(true);

	// Reset state when opening
	useEffect(() => {
		if (open) {
			setCurrentIndex(initialIndex);
			setScale(1);
			setLoading(true);
		}
	}, [open, initialIndex]);

	// Keyboard navigation
	// biome-ignore lint/correctness/useExhaustiveDependencies: handlers use refs internally and are stable
	useEffect(() => {
		if (!open) return;

		const handleKeyDown = (e: KeyboardEvent) => {
			switch (e.key) {
				case "Escape":
					onClose();
					break;
				case "ArrowLeft":
					goToPrev();
					break;
				case "ArrowRight":
					goToNext();
					break;
				case "+":
				case "=":
					zoomIn();
					break;
				case "-":
					zoomOut();
					break;
			}
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [open]);

	// Prevent body scroll when open
	useEffect(() => {
		if (open) {
			document.body.style.overflow = "hidden";
		} else {
			document.body.style.overflow = "";
		}
		return () => {
			document.body.style.overflow = "";
		};
	}, [open]);

	const goToPrev = useCallback(() => {
		setCurrentIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
		setScale(1);
		setLoading(true);
	}, [images.length]);

	const goToNext = useCallback(() => {
		setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
		setScale(1);
		setLoading(true);
	}, [images.length]);

	const zoomIn = useCallback(() => {
		setScale((prev) => Math.min(prev + 0.5, 4));
	}, []);

	const zoomOut = useCallback(() => {
		setScale((prev) => Math.max(prev - 0.5, 0.5));
	}, []);

	const handleDownload = useCallback(() => {
		const image = images[currentIndex];
		if (!image) return;
		const link = document.createElement("a");
		link.href = image.src;
		link.download = image.title || `image-${currentIndex + 1}`;
		link.target = "_blank";
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
	}, [currentIndex, images]);

	if (!open || images.length === 0) return null;

	const currentImage = images[currentIndex];

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center"
			onClick={onClose}
			role="dialog"
			aria-modal="true"
		>
			{/* Backdrop */}
			<div className="absolute inset-0 bg-black/90 backdrop-blur-sm" />

			{/* Toolbar */}
			<div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/50 to-transparent">
				<div className="text-white text-sm">
					{images.length > 1 && (
						<span>
							{currentIndex + 1} / {images.length}
						</span>
					)}
					{currentImage?.title && <span className="ml-3 text-white/70">{currentImage.title}</span>}
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							zoomOut();
						}}
						className="p-2 text-white/70 hover:text-white transition-colors"
						title="Zoom out (-)"
					>
						<ZoomOut className="h-5 w-5" />
					</button>
					<span className="text-white/50 text-sm min-w-[3rem] text-center">
						{Math.round(scale * 100)}%
					</span>
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							zoomIn();
						}}
						className="p-2 text-white/70 hover:text-white transition-colors"
						title="Zoom in (+)"
					>
						<ZoomIn className="h-5 w-5" />
					</button>
					<div className="w-px h-5 bg-white/20 mx-2" />
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							handleDownload();
						}}
						className="p-2 text-white/70 hover:text-white transition-colors"
						title="Download"
					>
						<Download className="h-5 w-5" />
					</button>
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onClose();
						}}
						className="p-2 text-white/70 hover:text-white transition-colors"
						title="Close (Esc)"
					>
						<X className="h-5 w-5" />
					</button>
				</div>
			</div>

			{/* Navigation buttons */}
			{images.length > 1 && (
				<>
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							goToPrev();
						}}
						className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-black/30 text-white/70 hover:bg-black/50 hover:text-white transition-colors"
						title="Previous (←)"
					>
						<ChevronLeft className="h-6 w-6" />
					</button>
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							goToNext();
						}}
						className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-black/30 text-white/70 hover:bg-black/50 hover:text-white transition-colors"
						title="Next (→)"
					>
						<ChevronRight className="h-6 w-6" />
					</button>
				</>
			)}

			{/* Image */}
			<div
				className="relative max-w-[90vw] max-h-[85vh] overflow-auto"
				onClick={(e) => e.stopPropagation()}
			>
				{loading && (
					<div className="absolute inset-0 flex items-center justify-center">
						<div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
					</div>
				)}
				<img
					src={currentImage?.src}
					alt={currentImage?.alt || ""}
					className={cn(
						"max-w-none transition-transform duration-200 cursor-zoom-in",
						loading && "opacity-0",
					)}
					style={{ transform: `scale(${scale})` }}
					onLoad={() => setLoading(false)}
					onError={() => setLoading(false)}
					draggable={false}
				/>
			</div>

			{/* Thumbnails (for multiple images) */}
			{images.length > 1 && (
				<div className="absolute bottom-0 left-0 right-0 z-10 flex justify-center py-4 px-4 bg-gradient-to-t from-black/50 to-transparent">
					<div className="flex gap-2 max-w-full overflow-x-auto pb-2">
						{images.map((img, idx) => (
							<button
								key={img.src}
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									setCurrentIndex(idx);
									setScale(1);
									setLoading(true);
								}}
								className={cn(
									"flex-shrink-0 w-16 h-16 rounded overflow-hidden border-2 transition-colors",
									idx === currentIndex
										? "border-white"
										: "border-transparent hover:border-white/50",
								)}
							>
								<img src={img.src} alt="" className="w-full h-full object-cover" />
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

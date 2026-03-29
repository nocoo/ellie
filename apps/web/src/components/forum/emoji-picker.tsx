"use client";

// components/forum/emoji-picker.tsx — Emoji picker in a Popover
// Ref: 04e §EmojiPicker — emoji-mart Unicode emoji picker

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";

interface EmojiPickerProps {
	onSelect: (emoji: string) => void;
}

export function EmojiPicker({ onSelect }: EmojiPickerProps) {
	return (
		<Popover>
			<PopoverTrigger className="inline-flex h-7 w-7 items-center justify-center rounded text-sm hover:bg-muted transition-colors">
				😀
			</PopoverTrigger>
			<PopoverContent className="w-auto p-0" align="end" sideOffset={8}>
				<Picker
					data={data}
					onEmojiSelect={(emoji: { native: string }) => onSelect(emoji.native)}
					locale="zh"
					theme="auto"
				/>
			</PopoverContent>
		</Popover>
	);
}

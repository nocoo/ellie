"use client";

// components/forum/emoji-picker.tsx — Emoji picker in a Popover
// Ref: 04e §EmojiPicker — emoji-mart Unicode emoji picker
//
// Two UX fixes here (req msg=c3dceecc):
//   1. The popover used to mount with `w-auto`, which collapsed to ~0
//      width during emoji-mart's internal async data init and then
//      jumped open. We now pin the popup to emoji-mart's intrinsic
//      352px column width and reserve a minimum height so the panel
//      paints at its final size from the first frame.
//   2. The popover was uncontrolled, so picking an emoji left it open
//      on top of the inserted character. It is now a controlled
//      popover that closes immediately after `onSelect`.

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import { useState } from "react";

interface EmojiPickerProps {
	onSelect: (emoji: string) => void;
}

export function EmojiPicker({ onSelect }: EmojiPickerProps) {
	const [open, setOpen] = useState(false);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger className="inline-flex h-7 w-7 items-center justify-center rounded text-sm hover:bg-muted transition-colors">
				😀
			</PopoverTrigger>
			<PopoverContent
				className="w-[352px] min-h-[435px] p-0"
				align="end"
				sideOffset={8}
				data-testid="emoji-picker-popover"
			>
				<Picker
					data={data}
					onEmojiSelect={(emoji: { native: string }) => {
						onSelect(emoji.native);
						setOpen(false);
					}}
					locale="zh"
					theme="auto"
				/>
			</PopoverContent>
		</Popover>
	);
}

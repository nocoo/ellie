"use client";

// components/forum/user-report-button.tsx — User-facing "举报用户" entry on profile hero.

import { ReportDialog } from "@/components/forum/report-dialog";
import { Button } from "@/components/ui/button";
import { writeGatePreflight } from "@/viewmodels/forum/write-gate";
import { Flag } from "lucide-react";
import { useState } from "react";

interface UserReportButtonProps {
	userId: number;
	/** True when the viewer is the profile owner — entry is hidden in that case. */
	isOwnProfile: boolean;
	/** True when a viewer is logged in. Anonymous users see no entry. */
	isLoggedIn: boolean;
}

export function UserReportButton({ userId, isOwnProfile, isLoggedIn }: UserReportButtonProps) {
	const [open, setOpen] = useState(false);

	// UI hides self-report and anonymous entries; Worker remains the final guard.
	if (!isLoggedIn || isOwnProfile) {
		return null;
	}

	return (
		<>
			<Button
				variant="outline"
				size="sm"
				className="gap-1.5"
				aria-label="举报用户"
				onClick={async () => {
					if (await writeGatePreflight(null, "report")) return;
					setOpen(true);
				}}
			>
				<Flag className="h-3.5 w-3.5" />
				<span className="hidden sm:inline">举报用户</span>
			</Button>
			<ReportDialog open={open} onOpenChange={setOpen} targetType="user" targetId={userId} />
		</>
	);
}

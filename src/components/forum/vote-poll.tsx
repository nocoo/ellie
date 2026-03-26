// components/forum/vote-poll.tsx — Vote poll UI component
// Ref: 04e §投票帖 — mock poll display with vote interaction

"use client";

import { Button } from "@/components/ui/button";
import {
	type PollData,
	applyVote,
	formatPollExpiry,
	formatVoterCount,
	isPollExpired,
	isValidSelection,
} from "@/viewmodels/forum/vote-poll";
import { BarChart3 } from "lucide-react";
import { useState } from "react";

interface VotePollProps {
	poll: PollData;
	hasVoted?: boolean;
	onVote?: (optionIds: number[]) => void;
}

/**
 * Vote poll component — displays poll options with vote/results toggle.
 */
export function VotePoll({ poll: initialPoll, hasVoted = false, onVote }: VotePollProps) {
	const [poll, setPoll] = useState(initialPoll);
	const [voted, setVoted] = useState(hasVoted);
	const [showResults, setShowResults] = useState(hasVoted);
	const [selected, setSelected] = useState<number[]>([]);

	const expired = isPollExpired(poll.expiresAt);
	const canVote = !voted && !expired;

	const handleToggleOption = (optionId: number) => {
		if (!canVote) return;
		if (poll.maxChoices === 1) {
			setSelected([optionId]);
		} else {
			setSelected((prev) =>
				prev.includes(optionId) ? prev.filter((id) => id !== optionId) : [...prev, optionId],
			);
		}
	};

	const handleVote = () => {
		if (!isValidSelection(selected, poll.maxChoices)) return;
		const updated = applyVote(poll, selected);
		setPoll(updated);
		setVoted(true);
		setShowResults(true);
		onVote?.(selected);
	};

	return (
		<div className="rounded-[14px] border bg-card p-4">
			<div className="mb-3 flex items-center gap-2">
				<BarChart3 className="h-4 w-4 text-primary" />
				<span className="font-semibold">{poll.question}</span>
			</div>

			<div className="space-y-2">
				{poll.options.map((option) => (
					<div key={option.id} className="relative">
						{showResults || expired ? (
							<div className="rounded-md border p-2">
								<div className="flex justify-between text-sm">
									<span>{option.text}</span>
									<span className="text-muted-foreground">
										{option.percentage}% ({option.votes})
									</span>
								</div>
								<div className="mt-1 h-2 rounded-full bg-muted">
									<div
										className="h-full rounded-full bg-primary"
										style={{ width: `${option.percentage}%` }}
									/>
								</div>
							</div>
						) : (
							<button
								type="button"
								onClick={() => handleToggleOption(option.id)}
								className={`w-full rounded-md border p-2 text-left text-sm transition-colors ${
									selected.includes(option.id)
										? "border-primary bg-primary/10"
										: "hover:bg-muted/50"
								}`}
							>
								{option.text}
							</button>
						)}
					</div>
				))}
			</div>

			<div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
				<span>
					{formatVoterCount(poll.voterCount)} · Max {poll.maxChoices} choice
					{poll.maxChoices > 1 ? "s" : ""}
				</span>
				<span>{formatPollExpiry(poll.expiresAt)}</span>
			</div>

			{canVote && !showResults && (
				<div className="mt-3 flex gap-2">
					<Button
						size="sm"
						disabled={!isValidSelection(selected, poll.maxChoices)}
						onClick={handleVote}
					>
						Vote
					</Button>
					<Button size="sm" variant="outline" onClick={() => setShowResults(true)}>
						View Results
					</Button>
				</div>
			)}

			{showResults && !voted && canVote && (
				<div className="mt-3">
					<Button size="sm" variant="outline" onClick={() => setShowResults(false)}>
						Back to Vote
					</Button>
				</div>
			)}
		</div>
	);
}

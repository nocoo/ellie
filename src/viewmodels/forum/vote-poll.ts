// viewmodels/forum/vote-poll.ts — Vote poll ViewModel
// Ref: 04e §投票帖 — mock poll data and vote state

/**
 * Poll option.
 */
export interface PollOption {
	id: number;
	text: string;
	votes: number;
	percentage: number;
}

/**
 * Poll data structure.
 */
export interface PollData {
	question: string;
	options: PollOption[];
	maxChoices: number;
	expiresAt: number;
	voterCount: number;
}

/**
 * Vote poll state.
 */
export interface VotePollState {
	poll: PollData;
	hasVoted: boolean;
	selectedOptions: number[];
	showResults: boolean;
}

/**
 * Check if a poll has expired.
 * Pure function, exported for testing.
 */
export function isPollExpired(expiresAt: number, now: number = Date.now() / 1000): boolean {
	return now >= expiresAt;
}

/**
 * Check if a vote selection is valid.
 * Pure function, exported for testing.
 */
export function isValidSelection(selectedOptions: number[], maxChoices: number): boolean {
	return selectedOptions.length > 0 && selectedOptions.length <= maxChoices;
}

/**
 * Calculate updated poll after a vote.
 * Pure function, exported for testing.
 */
export function applyVote(poll: PollData, selectedOptionIds: number[]): PollData {
	const newVoterCount = poll.voterCount + 1;
	const newOptions = poll.options.map((opt) => {
		const isSelected = selectedOptionIds.includes(opt.id);
		const newVotes = isSelected ? opt.votes + 1 : opt.votes;
		return { ...opt, votes: newVotes };
	});

	// Recalculate percentages
	const totalVotes = newOptions.reduce((sum, opt) => sum + opt.votes, 0);
	const withPercentages = newOptions.map((opt) => ({
		...opt,
		percentage: totalVotes > 0 ? Math.round((opt.votes / totalVotes) * 100) : 0,
	}));

	return {
		...poll,
		options: withPercentages,
		voterCount: newVoterCount,
	};
}

/**
 * Format voter count display text.
 * Pure function, exported for testing.
 */
export function formatVoterCount(count: number): string {
	if (count === 0) return "No votes yet";
	if (count === 1) return "1 person voted";
	return `${count} people voted`;
}

/**
 * Format poll expiry display text.
 * Pure function, exported for testing.
 */
export function formatPollExpiry(expiresAt: number, now: number = Date.now() / 1000): string {
	if (isPollExpired(expiresAt, now)) return "Poll ended";
	const remaining = expiresAt - now;
	const days = Math.floor(remaining / 86400);
	if (days > 0) return `${days} day${days > 1 ? "s" : ""} left`;
	const hours = Math.floor(remaining / 3600);
	if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} left`;
	return "Ending soon";
}

/**
 * Mock poll data for testing and display.
 */
export const MOCK_POLLS: Record<number, PollData> = {
	1001: {
		question: "食堂最佳窗口评选",
		options: [
			{ id: 1, text: "一食堂 3 楼", votes: 156, percentage: 62 },
			{ id: 2, text: "二食堂 2 楼", votes: 70, percentage: 28 },
			{ id: 3, text: "学苑食堂", votes: 25, percentage: 10 },
		],
		maxChoices: 1,
		expiresAt: 1727740800,
		voterCount: 251,
	},
};

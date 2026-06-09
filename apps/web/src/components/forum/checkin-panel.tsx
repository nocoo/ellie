"use client";

import { CHECKIN_MOODS, type CheckinLevel, type CheckinMood, type UserCheckin } from "@ellie/types";
import Image from "next/image";
import { useCallback, useState } from "react";
import { useForumToast } from "@/components/forum/forum-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, apiClient } from "@/lib/api-client";

// ─── Types ─────────────────────────────────────────────────

interface CheckinStatus {
	checkin: UserCheckin | null;
	checkedInToday: boolean;
	level: CheckinLevel | null;
	withinWindow: boolean;
}

interface CheckinResult {
	checkin: UserCheckin;
	reward: number;
	level: CheckinLevel | null;
}

// ─── Props ─────────────────────────────────────────────────

interface CheckinPanelProps {
	initial: CheckinStatus;
}

// ─── Mood Grid ─────────────────────────────────────────────

const MOOD_CODES = Object.keys(CHECKIN_MOODS) as CheckinMood[];

function MoodButton({
	code,
	label,
	selected,
	onSelect,
}: {
	code: CheckinMood;
	label: string;
	selected: boolean;
	onSelect: (code: CheckinMood) => void;
}) {
	return (
		<button
			type="button"
			onClick={() => onSelect(code)}
			className={`flex flex-col items-center gap-1 rounded-lg border-2 p-2 transition-colors ${
				selected
					? "border-primary bg-primary/10"
					: "border-transparent hover:border-muted-foreground/30 hover:bg-muted/50"
			}`}
		>
			<Image src={`/emot/${code}.gif`} alt={label} width={48} height={48} unoptimized />
			<span className="text-xs text-muted-foreground">{label}</span>
		</button>
	);
}

// ─── Component ─────────────────────────────────────────────

export function CheckinPanel({ initial }: CheckinPanelProps) {
	const toast = useForumToast();

	const [status, setStatus] = useState<CheckinStatus>(initial);
	const [selectedMood, setSelectedMood] = useState<CheckinMood | null>(null);
	const [message, setMessage] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [result, setResult] = useState<CheckinResult | null>(null);

	const handleCheckin = useCallback(async () => {
		if (!selectedMood || submitting) return;

		setSubmitting(true);
		try {
			const res = await apiClient.post<CheckinResult>("/api/v1/checkin", {
				mood: selectedMood,
				message: message.trim(),
			});
			setResult(res.data);
			setStatus((prev) => ({
				...prev,
				checkin: res.data.checkin,
				checkedInToday: true,
				level: res.data.level,
			}));
			toast.success("签到成功！");
		} catch (err) {
			const code = err instanceof ApiError ? err.code : undefined;
			const msg =
				code === "CHECKIN_ALREADY_DONE"
					? "今天已经签到过了"
					: code === "CHECKIN_OUTSIDE_WINDOW"
						? "当前不在签到时间段内"
						: code === "CHECKIN_INVALID_MOOD"
							? "请选择一个心情"
							: "签到失败，请稍后重试";
			toast.error({ title: "签到失败", description: msg });
		} finally {
			setSubmitting(false);
		}
	}, [selectedMood, message, submitting, toast]);

	// ── Already checked in today ────────────────────────────
	if (status.checkedInToday) {
		const checkin = result?.checkin ?? status.checkin;
		const level = result?.level ?? status.level;
		const moodLabel = checkin?.mood ? CHECKIN_MOODS[checkin.mood as CheckinMood] : undefined;

		return (
			<Card>
				<CardHeader>
					<CardTitle>今日签到</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="flex flex-col items-center gap-4 py-4">
						{checkin?.mood && (
							<Image
								src={`/emot/${checkin.mood}.gif`}
								alt={moodLabel ?? ""}
								width={64}
								height={64}
								unoptimized
							/>
						)}
						<p className="text-lg font-medium text-green-600">今天已签到 ✓</p>
						{result && (
							<p className="text-sm text-muted-foreground">
								获得 <span className="font-medium text-amber-600">{result.reward}</span> 同钱
							</p>
						)}
						{checkin?.message && (
							<p className="text-sm text-muted-foreground italic">"{checkin.message}"</p>
						)}
					</div>

					{/* Stats */}
					{checkin && (
						<div className="mt-4 grid grid-cols-2 gap-3 border-t pt-4 sm:grid-cols-4">
							<StatItem label="累计签到" value={`${checkin.totalDays} 天`} />
							<StatItem label="连续签到" value={`${checkin.streakDays} 天`} />
							<StatItem label="本月签到" value={`${checkin.monthDays} 天`} />
							<StatItem label="累计奖励" value={`${checkin.rewardTotal} 同钱`} />
						</div>
					)}

					{level && (
						<div className="mt-3 text-center text-sm text-muted-foreground">
							签到等级：
							<span className="font-medium text-foreground">
								LV.{level.level} {level.label}
							</span>
						</div>
					)}
				</CardContent>
			</Card>
		);
	}

	// ── Outside checkin window ───────────────────────────────
	if (!status.withinWindow) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>每日签到</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="flex flex-col items-center gap-3 py-6">
						<p className="text-muted-foreground">签到时间为每天 04:00 — 23:00</p>
						<p className="text-sm text-muted-foreground">当前不在签到时段内，请稍后再来</p>
					</div>

					{/* Still show stats if user has history */}
					{status.checkin && (
						<div className="mt-4 grid grid-cols-2 gap-3 border-t pt-4 sm:grid-cols-4">
							<StatItem label="累计签到" value={`${status.checkin.totalDays} 天`} />
							<StatItem label="连续签到" value={`${status.checkin.streakDays} 天`} />
							<StatItem label="本月签到" value={`${status.checkin.monthDays} 天`} />
							<StatItem label="累计奖励" value={`${status.checkin.rewardTotal} 同钱`} />
						</div>
					)}

					{status.level && (
						<div className="mt-3 text-center text-sm text-muted-foreground">
							签到等级：
							<span className="font-medium text-foreground">
								LV.{status.level.level} {status.level.label}
							</span>
						</div>
					)}
				</CardContent>
			</Card>
		);
	}

	// ── Ready to check in ───────────────────────────────────
	return (
		<Card>
			<CardHeader>
				<CardTitle>每日签到</CardTitle>
			</CardHeader>
			<CardContent>
				{/* Mood selection */}
				<div className="mb-4">
					<p className="mb-2 text-sm font-medium">今天的心情</p>
					<div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-9">
						{MOOD_CODES.map((code) => (
							<MoodButton
								key={code}
								code={code}
								label={CHECKIN_MOODS[code]}
								selected={selectedMood === code}
								onSelect={setSelectedMood}
							/>
						))}
					</div>
				</div>

				{/* Message input */}
				<div className="mb-4">
					<label htmlFor="checkin-message" className="mb-1 block text-sm font-medium">
						想说的话 <span className="font-normal text-muted-foreground">(可选, 最多 100 字)</span>
					</label>
					<input
						id="checkin-message"
						type="text"
						maxLength={100}
						value={message}
						onChange={(e) => setMessage(e.target.value)}
						placeholder="分享一下今天的心情..."
						className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>

				{/* Submit */}
				<Button onClick={handleCheckin} disabled={!selectedMood || submitting} className="w-full">
					{submitting ? "签到中..." : "签到"}
				</Button>

				{/* Existing stats */}
				{status.checkin && (
					<div className="mt-4 grid grid-cols-2 gap-3 border-t pt-4 sm:grid-cols-4">
						<StatItem label="累计签到" value={`${status.checkin.totalDays} 天`} />
						<StatItem label="连续签到" value={`${status.checkin.streakDays} 天`} />
						<StatItem label="本月签到" value={`${status.checkin.monthDays} 天`} />
						<StatItem label="累计奖励" value={`${status.checkin.rewardTotal} 同钱`} />
					</div>
				)}

				{status.level && (
					<div className="mt-3 text-center text-sm text-muted-foreground">
						签到等级：
						<span className="font-medium text-foreground">
							LV.{status.level.level} {status.level.label}
						</span>
					</div>
				)}
			</CardContent>
		</Card>
	);
}

// ─── Stat Item ──────────────────────────────────────────────

function StatItem({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex flex-col items-center rounded-md bg-muted/50 p-2">
			<span className="text-xs text-muted-foreground">{label}</span>
			<span className="text-sm font-medium">{value}</span>
		</div>
	);
}

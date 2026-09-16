"use client";

import { CHECKIN_MOODS, type CheckinLevel, type CheckinMood, type UserCheckin } from "@ellie/types";
import {
	Award,
	CalendarCheck2,
	CalendarDays,
	CircleCheck,
	Clock3,
	Coins,
	Flame,
	Loader2,
	Smile,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useRef, useState } from "react";
import { ForumPageHeader } from "@/components/forum/forum-page-header";
import { useForumToast } from "@/components/forum/forum-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
			aria-pressed={selected}
			className={`flex flex-col items-center gap-2 rounded-xl border p-3 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
				selected
					? "border-primary bg-primary/10"
					: "border-border bg-card hover:border-primary/40 hover:bg-muted/50"
			}`}
		>
			<Image src={`/emot/${code}.gif`} alt="" width={48} height={48} unoptimized />
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
	const submittingRef = useRef(false);

	const handleCheckin = useCallback(async () => {
		if (!selectedMood || submittingRef.current) return;
		submittingRef.current = true;
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
			submittingRef.current = false;
			setSubmitting(false);
		}
	}, [selectedMood, message, toast]);

	const checkin = result?.checkin ?? status.checkin;
	const level = result?.level ?? status.level;
	const moodLabel = checkin?.mood ? CHECKIN_MOODS[checkin.mood as CheckinMood] : undefined;
	const stats = [
		{ label: "累计签到", value: `${checkin?.totalDays ?? 0} 天`, icon: CalendarDays },
		{ label: "连续签到", value: `${checkin?.streakDays ?? 0} 天`, icon: Flame },
		{ label: "本月签到", value: `${checkin?.monthDays ?? 0} 天`, icon: CalendarCheck2 },
		{ label: "累计奖励", value: `${checkin?.rewardTotal ?? 0} 同钱`, icon: Coins },
	];

	return (
		<div className="space-y-4">
			<ForumPageHeader
				icon={<CalendarCheck2 />}
				title="每日签到"
				description="每天 04:00 — 23:00（北京时间），记录心情，领取签到奖励。"
				actions={
					level && (
						<Badge variant="outline" className="gap-1.5 py-1.5">
							<Award className="size-4 text-primary" aria-hidden="true" />
							LV.{level.level} {level.label}
						</Badge>
					)
				}
			>
				<dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
					{stats.map(({ label, value, icon: Icon }) => (
						<div key={label} className="min-w-0">
							<dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
								<Icon className="size-3.5" aria-hidden="true" />
								{label}
							</dt>
							<dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</dd>
						</div>
					))}
				</dl>
			</ForumPageHeader>
			<Card className="rounded-2xl">
				<CardContent className="p-4 sm:px-5">
					{status.checkedInToday ? (
						<div className="flex flex-col items-center gap-4 py-6 text-center">
							{checkin?.mood && (
								<Image
									src={`/emot/${checkin.mood}.gif`}
									alt={moodLabel ?? ""}
									width={64}
									height={64}
									unoptimized
								/>
							)}
							<h2 className="flex items-center gap-2 text-lg font-semibold text-success">
								<CircleCheck className="size-5" aria-hidden="true" />
								今天已签到
							</h2>
							{result && (
								<p className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 text-sm">
									<Coins className="size-4 text-primary" aria-hidden="true" />
									获得 <strong className="font-semibold text-primary">{result.reward}</strong> 同钱
								</p>
							)}
							{checkin?.message && (
								<p className="max-w-xl break-words text-sm leading-relaxed text-muted-foreground">
									“{checkin.message}”
								</p>
							)}
						</div>
					) : !status.withinWindow ? (
						<div className="flex flex-col items-center gap-3 py-8 text-center">
							<Clock3 className="size-10 text-primary/60" aria-hidden="true" />
							<h2 className="text-lg font-semibold">签到尚未开放</h2>
							<p className="text-sm text-muted-foreground">当前不在签到时段内，请稍后再来</p>
						</div>
					) : (
						<form
							className="space-y-6"
							onSubmit={(event) => {
								event.preventDefault();
								handleCheckin();
							}}
						>
							<fieldset disabled={submitting}>
								<legend className="mb-3 flex items-center gap-2 text-sm font-semibold">
									<Smile className="size-4 text-primary" aria-hidden="true" />
									今天的心情
								</legend>
								<div className="grid grid-cols-3 gap-2 lg:grid-cols-9">
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
							</fieldset>
							<div className="space-y-2">
								<label
									htmlFor="checkin-message"
									className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium"
								>
									想说的话{" "}
									<span className="text-xs font-normal text-muted-foreground">
										可选 · {message.length}/100 字
									</span>
								</label>
								<Input
									id="checkin-message"
									type="text"
									maxLength={100}
									value={message}
									disabled={submitting}
									onChange={(event) => setMessage(event.target.value)}
									placeholder="分享一下今天的心情..."
									className="h-11"
								/>
							</div>
							<div className="flex justify-end border-t border-border pt-4">
								<Button
									type="submit"
									disabled={!selectedMood || submitting}
									className="h-11 w-full sm:w-auto sm:min-w-36"
								>
									{submitting ? (
										<Loader2 className="size-4 animate-spin" aria-hidden="true" />
									) : (
										<CalendarCheck2 className="size-4" aria-hidden="true" />
									)}
									{submitting ? "签到中..." : "签到"}
								</Button>
							</div>
						</form>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

"use client";

// user-checkin-panel.tsx — Phase F admin user-detail check-in panel.
//
// Shows the rolling aggregate (total/month/streak/reward) plus a per-day
// grid of the most recent N days (default 35 = 5 weeks). Clicking a day
// toggles the checkedIn state via PATCH /checkins/:dateLocal; the response
// carries the recompute result so the aggregate refreshes without an extra
// fetch.
//
// Streak override: a small inline form lets the admin set streak_days
// directly. The control's helper text states the override will be wiped
// the next time a date toggle triggers history-based recompute — per
// reviewer msg=75a7ce99 ("UI 记得把'手动连续天数会被下一次按历史重算覆盖'的语义放到控件附近").
//
// Scope is intentionally narrow: this panel only edits one user's
// checkin state from inside the user-detail page. There is no global
// dashboard.

import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@ellie/ui";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminInlineMessage } from "@/components/admin/admin-inline-message";
import { extractErrorMessage } from "@/lib/admin-error";
import {
	fetchUserCheckins,
	setCheckinDay,
	setUserStreak,
	type UserCheckinDetail,
} from "@/viewmodels/admin/user-checkin";

// Number of trailing days rendered in the day grid. 35 = 5 weeks.
const GRID_DAYS = 35;

// Asia/Shanghai today as YYYY-MM-DD. Mirrors apps/worker/src/lib/shanghaiTime.ts
// — duplicated here so the panel does not need to round-trip the worker
// just to render an empty grid.
function shanghaiTodayLocal(): string {
	const fmt = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	});
	return fmt.format(new Date());
}

function shanghaiPrevDay(dateLocal: string): string {
	const t = new Date(`${dateLocal}T00:00:00Z`);
	t.setUTCDate(t.getUTCDate() - 1);
	return t.toISOString().slice(0, 10);
}

function buildGridDates(today: string, count: number): string[] {
	const dates: string[] = [today];
	let cursor = today;
	for (let i = 1; i < count; i += 1) {
		cursor = shanghaiPrevDay(cursor);
		dates.push(cursor);
	}
	return dates;
}

function fmtTimestamp(seconds: number): string {
	if (!seconds) return "—";
	return new Date(seconds * 1000).toLocaleString();
}

interface Props {
	userId: number;
}

export function UserCheckinPanel({ userId }: Props) {
	const [detail, setDetail] = useState<UserCheckinDetail | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [busyDate, setBusyDate] = useState<string | null>(null);
	const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

	const [streakInput, setStreakInput] = useState("");
	const [streakSaving, setStreakSaving] = useState(false);
	const [streakError, setStreakError] = useState<string | null>(null);

	const today = useMemo(() => shanghaiTodayLocal(), []);
	const gridDates = useMemo(() => buildGridDates(today, GRID_DAYS), [today]);
	const fromDate = gridDates[gridDates.length - 1];

	const reload = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const next = await fetchUserCheckins(userId, { from: fromDate, to: today });
			setDetail(next);
			setStreakInput(String(next.checkin?.streakDays ?? 0));
		} catch (err) {
			setError(extractErrorMessage(err, "加载签到记录失败"));
		} finally {
			setLoading(false);
		}
	}, [userId, fromDate, today]);

	useEffect(() => {
		void reload();
	}, [reload]);

	const checkedSet = useMemo(() => {
		const s = new Set<string>();
		if (detail) {
			for (const h of detail.history) s.add(h.dateLocal);
		}
		return s;
	}, [detail]);

	const handleToggleDay = async (dateLocal: string) => {
		if (!detail || busyDate) return;
		const wasChecked = checkedSet.has(dateLocal);
		setBusyDate(dateLocal);
		setMessage(null);
		try {
			const result = await setCheckinDay(userId, dateLocal, !wasChecked);
			// Patch local state from response: refresh history and aggregate
			// without a full reload. Easier to just reload — keeps history
			// rows fully consistent with the server (e.g. created_at).
			await reload();
			setMessage({
				type: "success",
				text: `${dateLocal} ${result.checkedIn ? "已补签" : "已取消签到"}（连续 ${result.recompute.streakDays} 天，累计 ${result.recompute.totalDays} 天）`,
			});
		} catch (err) {
			setMessage({ type: "error", text: extractErrorMessage(err, "更新签到失败") });
		} finally {
			setBusyDate(null);
		}
	};

	const handleSaveStreak = async (e: React.FormEvent) => {
		e.preventDefault();
		const n = Number(streakInput);
		if (!Number.isInteger(n) || n < 0) {
			setStreakError("连续天数必须是非负整数");
			return;
		}
		setStreakSaving(true);
		setStreakError(null);
		try {
			await setUserStreak(userId, n);
			await reload();
			setMessage({
				type: "success",
				text: `已设置连续签到天数为 ${n}（下次按历史重算时会被覆盖）`,
			});
		} catch (err) {
			setStreakError(extractErrorMessage(err, "更新连续天数失败"));
		} finally {
			setStreakSaving(false);
		}
	};

	if (loading && !detail) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>签到</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="flex items-center justify-center py-10">
						<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
					</div>
				</CardContent>
			</Card>
		);
	}

	if (error) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>签到</CardTitle>
				</CardHeader>
				<CardContent>
					<AdminInlineMessage variant="error" text={error} />
				</CardContent>
			</Card>
		);
	}

	const aggregate = detail?.checkin ?? null;

	return (
		<Card>
			<CardHeader>
				<CardTitle>签到</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				{message && <AdminInlineMessage variant={message.type} text={message.text} />}

				{/* Aggregate */}
				<dl className="grid grid-cols-2 gap-y-2 text-sm md:grid-cols-4">
					<dt className="text-muted-foreground">累计天数</dt>
					<dd>{aggregate?.totalDays ?? 0}</dd>
					<dt className="text-muted-foreground">本月</dt>
					<dd>{aggregate?.monthDays ?? 0}</dd>
					<dt className="text-muted-foreground">连续</dt>
					<dd>{aggregate?.streakDays ?? 0}</dd>
					<dt className="text-muted-foreground">累计奖励</dt>
					<dd>{aggregate?.rewardTotal ?? 0}</dd>
					<dt className="text-muted-foreground">最后签到</dt>
					<dd className="col-span-3">{fmtTimestamp(aggregate?.lastCheckinAt ?? 0)}</dd>
				</dl>

				{/* Day grid */}
				<div>
					<p className="mb-2 text-sm text-muted-foreground">
						最近 {GRID_DAYS} 天（点击单元格可补签或取消签到）
					</p>
					<div className="grid grid-cols-7 gap-1">
						{gridDates
							.slice()
							.reverse()
							.map((date) => {
								const checked = checkedSet.has(date);
								const isToday = date === today;
								const isBusy = busyDate === date;
								return (
									<button
										key={date}
										type="button"
										onClick={() => handleToggleDay(date)}
										disabled={isBusy || busyDate !== null}
										title={`${date}${checked ? "（已签到）" : ""}`}
										data-testid={`checkin-day-${date}`}
										className={[
											"flex h-10 flex-col items-center justify-center rounded border text-[10px] transition",
											checked
												? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
												: "border-border bg-background text-muted-foreground",
											isToday ? "ring-1 ring-primary" : "",
											isBusy ? "opacity-50" : "hover:border-primary",
										].join(" ")}
									>
										<span>{date.slice(5)}</span>
										<span className="font-medium">{checked ? "✓" : "·"}</span>
									</button>
								);
							})}
					</div>
					{detail?.truncated && (
						<p className="mt-2 text-xs text-muted-foreground">
							历史记录较多，仅显示前 {detail.history.length} 行。
						</p>
					)}
				</div>

				{/* Streak override */}
				<form onSubmit={handleSaveStreak} className="space-y-2 border-t pt-4">
					<Label htmlFor={`streak-input-${userId}`}>手动设置连续天数</Label>
					<div className="flex items-center gap-2">
						<Input
							id={`streak-input-${userId}`}
							type="number"
							min={0}
							value={streakInput}
							onChange={(e) => setStreakInput(e.target.value)}
							className="max-w-[10rem]"
							disabled={!aggregate || streakSaving}
						/>
						<Button type="submit" size="sm" variant="outline" disabled={!aggregate || streakSaving}>
							{streakSaving ? "保存中..." : "保存"}
						</Button>
					</div>
					{streakError && <AdminInlineMessage variant="error" text={streakError} />}
					{!aggregate && (
						<p className="text-xs text-muted-foreground">
							该用户尚无签到记录，请先在上方补签任意一天后再设置连续天数。
						</p>
					)}
					<p className="text-xs text-muted-foreground">
						⚠️ 手动设置的连续天数会在下一次「按日补签 / 取消签到」时被基于历史的自动重算覆盖。
					</p>
				</form>
			</CardContent>
		</Card>
	);
}

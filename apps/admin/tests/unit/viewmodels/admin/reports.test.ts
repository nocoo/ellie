import {
	REPORT_STATUS_OPTIONS,
	REPORT_TYPE_OPTIONS,
	type Report,
	STATUS_LABELS,
	TYPE_LABELS,
	buildReportSearchParams,
	getReportTargetAdminLink,
	getReportTargetLabel,
} from "@/viewmodels/admin/reports";
import { describe, expect, it } from "vitest";

function makeReport(overrides: Partial<Report> = {}): Report {
	return {
		id: 1,
		type: "post",
		targetId: 100,
		reporterId: 5,
		reporterName: "alice",
		reason: "spam",
		status: "pending",
		handlerId: null,
		handlerName: "",
		handledAt: null,
		createdAt: 0,
		threadId: null,
		targetTitle: null,
		targetName: null,
		...overrides,
	};
}

describe("reports", () => {
	describe("buildReportSearchParams", () => {
		it("includes page and limit", () => {
			const params = buildReportSearchParams({ page: 2, limit: 10 });
			expect(params.page).toBe(2);
			expect(params.limit).toBe(10);
		});

		it("includes status when set", () => {
			const params = buildReportSearchParams({ status: "pending" });
			expect(params.status).toBe("pending");
		});

		it("omits empty status", () => {
			const params = buildReportSearchParams({});
			expect(params.status).toBeUndefined();
		});

		it("includes reporterId", () => {
			const params = buildReportSearchParams({ reporterId: 42 });
			expect(params.reporterId).toBe(42);
		});

		it("forwards type filter", () => {
			expect(buildReportSearchParams({ type: "thread" }).type).toBe("thread");
			expect(buildReportSearchParams({ type: "user" }).type).toBe("user");
		});

		it("omits type when undefined", () => {
			expect(buildReportSearchParams({}).type).toBeUndefined();
		});
	});

	describe("REPORT_STATUS_OPTIONS", () => {
		it("has 4 options", () => {
			expect(REPORT_STATUS_OPTIONS).toHaveLength(4);
		});

		it("first option is 全部状态 with empty value", () => {
			expect(REPORT_STATUS_OPTIONS[0]).toEqual({ value: "", label: "全部状态" });
		});
	});

	describe("REPORT_TYPE_OPTIONS", () => {
		it("includes empty + 3 types", () => {
			expect(REPORT_TYPE_OPTIONS).toHaveLength(4);
			expect(REPORT_TYPE_OPTIONS[0]).toEqual({ value: "", label: "全部类型" });
			expect(REPORT_TYPE_OPTIONS.map((o) => o.value)).toEqual(["", "thread", "post", "user"]);
		});
	});

	describe("STATUS_LABELS", () => {
		it("maps pending to 待处理", () => {
			expect(STATUS_LABELS.pending).toBe("待处理");
		});

		it("maps resolved to 已处理", () => {
			expect(STATUS_LABELS.resolved).toBe("已处理");
		});

		it("maps dismissed to 已驳回", () => {
			expect(STATUS_LABELS.dismissed).toBe("已驳回");
		});
	});

	describe("TYPE_LABELS", () => {
		it("maps each report type to its Chinese label", () => {
			expect(TYPE_LABELS.thread).toBe("主题");
			expect(TYPE_LABELS.post).toBe("回帖");
			expect(TYPE_LABELS.user).toBe("用户");
		});
	});

	describe("getReportTargetAdminLink", () => {
		it("thread → /admin/threads/:id when threadId present", () => {
			const r = makeReport({ type: "thread", targetId: 7, threadId: 7 });
			expect(getReportTargetAdminLink(r)).toBe("/admin/threads/7");
		});

		it("thread → null when threadId missing (deleted)", () => {
			const r = makeReport({ type: "thread", targetId: 7, threadId: null });
			expect(getReportTargetAdminLink(r)).toBeNull();
		});

		it("post → /admin/threads/:threadId (parent thread, no per-post anchor)", () => {
			const r = makeReport({ type: "post", targetId: 100, threadId: 9 });
			expect(getReportTargetAdminLink(r)).toBe("/admin/threads/9");
		});

		it("post → null when parent thread missing", () => {
			const r = makeReport({ type: "post", targetId: 100, threadId: null });
			expect(getReportTargetAdminLink(r)).toBeNull();
		});

		it("user → /admin/users/:id when targetName present", () => {
			const r = makeReport({ type: "user", targetId: 12, targetName: "bob" });
			expect(getReportTargetAdminLink(r)).toBe("/admin/users/12");
		});

		it("user → null when target user is missing/tombstoned (no targetName)", () => {
			const r = makeReport({ type: "user", targetId: 12, targetName: null });
			expect(getReportTargetAdminLink(r)).toBeNull();
		});
	});

	describe("getReportTargetLabel", () => {
		it("thread/post → targetTitle when present", () => {
			expect(getReportTargetLabel(makeReport({ type: "thread", targetTitle: "T" }))).toBe("T");
			expect(getReportTargetLabel(makeReport({ type: "post", targetTitle: "T" }))).toBe("T");
		});

		it("thread/post → #targetId fallback when title missing", () => {
			expect(getReportTargetLabel(makeReport({ type: "thread", targetId: 5 }))).toBe("#5");
			expect(getReportTargetLabel(makeReport({ type: "post", targetId: 8 }))).toBe("#8");
		});

		it("user → @username when present", () => {
			expect(
				getReportTargetLabel(makeReport({ type: "user", targetId: 9, targetName: "alice" })),
			).toBe("@alice");
		});

		it("user → #targetId fallback when targetName missing", () => {
			expect(getReportTargetLabel(makeReport({ type: "user", targetId: 9 }))).toBe("#9");
		});
	});
});

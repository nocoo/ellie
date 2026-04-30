import {
	REPORT_STATUS_OPTIONS,
	STATUS_LABELS,
	buildReportSearchParams,
} from "@/viewmodels/admin/reports";
import { describe, expect, it } from "vitest";

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
	});

	describe("REPORT_STATUS_OPTIONS", () => {
		it("has 4 options", () => {
			expect(REPORT_STATUS_OPTIONS).toHaveLength(4);
		});

		it("first option is 全部状态 with empty value", () => {
			expect(REPORT_STATUS_OPTIONS[0]).toEqual({ value: "", label: "全部状态" });
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
});

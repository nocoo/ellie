import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({
	apiClient: {
		get: vi.fn(),
		getList: vi.fn(),
		post: vi.fn(),
		patch: vi.fn(),
		delete: vi.fn(),
	},
}));

import { apiClient } from "@/lib/api-client";
import {
	batchDeleteIpBans,
	checkIp,
	createIpBan,
	deleteIpBan,
	fetchIpBan,
	fetchIpBans,
	updateIpBan,
} from "@/viewmodels/admin/ip-bans";
import {
	batchDeleteReports,
	deleteReport,
	fetchReport,
	fetchReports,
	updateReportStatus,
} from "@/viewmodels/admin/reports";

const mockGet = apiClient.get as ReturnType<typeof vi.fn>;
const mockGetList = apiClient.getList as ReturnType<typeof vi.fn>;
const mockPost = apiClient.post as ReturnType<typeof vi.fn>;
const mockPatch = apiClient.patch as ReturnType<typeof vi.fn>;
const mockDelete = apiClient.delete as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe("ip-bans API", () => {
	it("fetchIpBans calls getList", async () => {
		mockGetList.mockResolvedValue({ data: [], meta: {} });
		await fetchIpBans({ page: 1, ip: "1.2.3.4" });
		expect(mockGetList).toHaveBeenCalledWith(
			"/api/admin/ip-bans",
			expect.objectContaining({ ip: "1.2.3.4" }),
		);
	});

	it("fetchIpBan calls get by id", async () => {
		mockGet.mockResolvedValue({ data: { id: 1 } });
		const ban = await fetchIpBan(1);
		expect(ban.id).toBe(1);
	});

	it("createIpBan calls post", async () => {
		mockPost.mockResolvedValue({ data: { id: 1, ip: "1.2.3.4" } });
		const ban = await createIpBan({ ip: "1.2.3.4", reason: "spam" });
		expect(mockPost).toHaveBeenCalledWith("/api/admin/ip-bans", { ip: "1.2.3.4", reason: "spam" });
		expect(ban.ip).toBe("1.2.3.4");
	});

	it("updateIpBan calls patch", async () => {
		mockPatch.mockResolvedValue({ data: { id: 1 } });
		await updateIpBan(1, { reason: "updated" });
		expect(mockPatch).toHaveBeenCalledWith("/api/admin/ip-bans/1", { reason: "updated" });
	});

	it("deleteIpBan calls delete", async () => {
		mockDelete.mockResolvedValue({ data: { deleted: true } });
		const r = await deleteIpBan(1);
		expect(r.deleted).toBe(true);
	});

	it("batchDeleteIpBans calls post", async () => {
		mockPost.mockResolvedValue({ data: { affected: 2 } });
		const r = await batchDeleteIpBans([1, 2]);
		expect(mockPost).toHaveBeenCalledWith("/api/admin/ip-bans/batch-delete", { ids: [1, 2] });
		expect(r.affected).toBe(2);
	});

	it("checkIp calls get", async () => {
		mockGet.mockResolvedValue({ data: { banned: false } });
		const r = await checkIp("192.168.1.1");
		expect(mockGet).toHaveBeenCalledWith("/api/admin/ip-bans/check-ip", { ip: "192.168.1.1" });
		expect(r.banned).toBe(false);
	});
});

describe("reports API", () => {
	it("fetchReports calls getList", async () => {
		mockGetList.mockResolvedValue({ data: [], meta: {} });
		await fetchReports({ status: "pending", page: 1 });
		expect(mockGetList).toHaveBeenCalled();
	});

	it("fetchReport calls get by id", async () => {
		mockGet.mockResolvedValue({ data: { id: 5 } });
		const r = await fetchReport(5);
		expect(r.id).toBe(5);
	});

	it("updateReportStatus calls patch", async () => {
		mockPatch.mockResolvedValue({ data: { id: 1, status: "resolved" } });
		const r = await updateReportStatus(1, "resolved");
		expect(mockPatch).toHaveBeenCalledWith("/api/admin/reports/1", { status: "resolved" });
		expect(r.status).toBe("resolved");
	});

	it("batchDeleteReports calls post", async () => {
		mockPost.mockResolvedValue({ data: { affected: 2, skipped: 0 } });
		const r = await batchDeleteReports([1, 2]);
		expect(mockPost).toHaveBeenCalledWith("/api/admin/reports/batch-delete", { ids: [1, 2] });
		expect(r.affected).toBe(2);
	});

	it("deleteReport delegates to batchDeleteReports", async () => {
		mockPost.mockResolvedValue({ data: { affected: 1, skipped: 0 } });
		const r = await deleteReport(99);
		expect(mockPost).toHaveBeenCalledWith("/api/admin/reports/batch-delete", { ids: [99] });
		expect(r.affected).toBe(1);
	});
});

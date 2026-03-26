import { describe, expect, test } from "bun:test";
import { classifyRoute, isAdminRoute, isAuthRoute, isPublicRoute } from "@/proxy";

describe("proxy route guard", () => {
	describe("classifyRoute", () => {
		// --- Public exact routes ---
		test("/ is public", () => {
			expect(classifyRoute("/")).toBe("public");
		});

		test("/digest is public", () => {
			expect(classifyRoute("/digest")).toBe("public");
		});

		test("/login is public", () => {
			expect(classifyRoute("/login")).toBe("public");
		});

		// --- Public prefix routes ---
		test("/forums/1 is public", () => {
			expect(classifyRoute("/forums/1")).toBe("public");
		});

		test("/forums/ is public", () => {
			expect(classifyRoute("/forums/")).toBe("public");
		});

		test("/threads/123 is public", () => {
			expect(classifyRoute("/threads/123")).toBe("public");
		});

		test("/users/42 is public", () => {
			expect(classifyRoute("/users/42")).toBe("public");
		});

		test("/search is public", () => {
			expect(classifyRoute("/search")).toBe("public");
		});

		test("/search?q=test is public", () => {
			expect(classifyRoute("/search?q=test")).toBe("public");
		});

		// --- API v1 public routes ---
		test("/api/v1/forums is public", () => {
			expect(classifyRoute("/api/v1/forums")).toBe("public");
		});

		test("/api/v1/threads/1 is public", () => {
			expect(classifyRoute("/api/v1/threads/1")).toBe("public");
		});

		test("/api/v1/users/1 is public", () => {
			expect(classifyRoute("/api/v1/users/1")).toBe("public");
		});

		// --- Auth routes ---
		test("/threads/new requires auth", () => {
			expect(classifyRoute("/threads/new")).toBe("auth");
		});

		// --- Admin routes ---
		test("/admin is admin", () => {
			expect(classifyRoute("/admin")).toBe("admin");
		});

		test("/admin/ is admin", () => {
			expect(classifyRoute("/admin/")).toBe("admin");
		});

		test("/admin/users is admin", () => {
			expect(classifyRoute("/admin/users")).toBe("admin");
		});

		test("/admin/dashboard is admin", () => {
			expect(classifyRoute("/admin/dashboard")).toBe("admin");
		});

		test("/api/admin/ is admin", () => {
			expect(classifyRoute("/api/admin/")).toBe("admin");
		});

		test("/api/admin/users is admin", () => {
			expect(classifyRoute("/api/admin/users")).toBe("admin");
		});

		// --- Default fallback (deny by default) ---
		test("unknown route defaults to auth", () => {
			expect(classifyRoute("/unknown")).toBe("auth");
		});

		test("/settings defaults to auth", () => {
			expect(classifyRoute("/settings")).toBe("auth");
		});

		// --- Edge: /threads/new must be auth, not public (prefix check order) ---
		test("/threads/new is auth despite /threads/ being public prefix", () => {
			expect(classifyRoute("/threads/new")).toBe("auth");
		});
	});

	describe("isPublicRoute", () => {
		test("returns true for public routes", () => {
			expect(isPublicRoute("/")).toBe(true);
			expect(isPublicRoute("/forums/1")).toBe(true);
			expect(isPublicRoute("/digest")).toBe(true);
		});

		test("returns false for auth routes", () => {
			expect(isPublicRoute("/threads/new")).toBe(false);
		});

		test("returns false for admin routes", () => {
			expect(isPublicRoute("/admin")).toBe(false);
		});
	});

	describe("isAdminRoute", () => {
		test("returns true for admin routes", () => {
			expect(isAdminRoute("/admin")).toBe(true);
			expect(isAdminRoute("/admin/users")).toBe(true);
			expect(isAdminRoute("/api/admin/users")).toBe(true);
		});

		test("returns false for public routes", () => {
			expect(isAdminRoute("/")).toBe(false);
		});

		test("returns false for auth routes", () => {
			expect(isAdminRoute("/threads/new")).toBe(false);
		});
	});

	describe("isAuthRoute", () => {
		test("returns true for auth routes", () => {
			expect(isAuthRoute("/threads/new")).toBe(true);
			expect(isAuthRoute("/unknown")).toBe(true);
		});

		test("returns false for public routes", () => {
			expect(isAuthRoute("/")).toBe(false);
		});

		test("returns false for admin routes", () => {
			expect(isAuthRoute("/admin")).toBe(false);
		});
	});
});

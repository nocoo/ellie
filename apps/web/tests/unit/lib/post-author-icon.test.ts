import { getStaticImageUrl } from "@/lib/cdn";
import {
	POST_AUTHOR_ICON,
	getPostAuthorIconAlt,
	getPostAuthorIconName,
} from "@/lib/post-author-icon";
import { UserRole } from "@ellie/types";
import { describe, expect, it } from "vitest";

describe("getPostAuthorIconName", () => {
	it("returns ico_lz.png for the thread author regardless of role", () => {
		for (const role of [UserRole.User, UserRole.Mod, UserRole.SuperMod, UserRole.Admin]) {
			expect(getPostAuthorIconName({ role, isThreadAuthor: true })).toBe(
				POST_AUTHOR_ICON.threadAuthor,
			);
		}
	});

	it("returns online_admin.gif for Admin", () => {
		expect(getPostAuthorIconName({ role: UserRole.Admin, isThreadAuthor: false })).toBe(
			POST_AUTHOR_ICON.admin,
		);
	});

	it("returns online_supermod.gif for SuperMod", () => {
		expect(getPostAuthorIconName({ role: UserRole.SuperMod, isThreadAuthor: false })).toBe(
			POST_AUTHOR_ICON.superMod,
		);
	});

	it("returns online_moderator.gif for Mod", () => {
		expect(getPostAuthorIconName({ role: UserRole.Mod, isThreadAuthor: false })).toBe(
			POST_AUTHOR_ICON.mod,
		);
	});

	it("returns online_member.gif for User", () => {
		expect(getPostAuthorIconName({ role: UserRole.User, isThreadAuthor: false })).toBe(
			POST_AUTHOR_ICON.member,
		);
	});

	it("falls back to online_member.gif when role is undefined", () => {
		expect(getPostAuthorIconName({ isThreadAuthor: false })).toBe(POST_AUTHOR_ICON.member);
	});

	it("falls back to online_member.gif for unknown DZ legacy role values", () => {
		expect(getPostAuthorIconName({ role: -1, isThreadAuthor: false })).toBe(
			POST_AUTHOR_ICON.member,
		);
		expect(getPostAuthorIconName({ role: 7, isThreadAuthor: false })).toBe(POST_AUTHOR_ICON.member);
	});

	it("anonymous fallback also goes to普通会员 (thread-author=false, role missing)", () => {
		expect(getPostAuthorIconName({ isThreadAuthor: false })).toBe(POST_AUTHOR_ICON.member);
	});
});

describe("getStaticImageUrl + POST_AUTHOR_ICON path locking", () => {
	it("threadAuthor maps to /static/image/common/ico_lz.png", () => {
		expect(getStaticImageUrl(POST_AUTHOR_ICON.threadAuthor)).toBe(
			"https://t.no.mt/static/image/common/ico_lz.png",
		);
	});

	it("admin maps to /static/image/common/online_admin.gif", () => {
		expect(getStaticImageUrl(POST_AUTHOR_ICON.admin)).toBe(
			"https://t.no.mt/static/image/common/online_admin.gif",
		);
	});

	it("superMod maps to /static/image/common/online_supermod.gif", () => {
		expect(getStaticImageUrl(POST_AUTHOR_ICON.superMod)).toBe(
			"https://t.no.mt/static/image/common/online_supermod.gif",
		);
	});

	it("mod maps to /static/image/common/online_moderator.gif", () => {
		expect(getStaticImageUrl(POST_AUTHOR_ICON.mod)).toBe(
			"https://t.no.mt/static/image/common/online_moderator.gif",
		);
	});

	it("member maps to /static/image/common/online_member.gif", () => {
		expect(getStaticImageUrl(POST_AUTHOR_ICON.member)).toBe(
			"https://t.no.mt/static/image/common/online_member.gif",
		);
	});
});

describe("getPostAuthorIconAlt", () => {
	it("returns Chinese label per icon", () => {
		expect(getPostAuthorIconAlt(POST_AUTHOR_ICON.threadAuthor)).toBe("楼主");
		expect(getPostAuthorIconAlt(POST_AUTHOR_ICON.admin)).toBe("管理员");
		expect(getPostAuthorIconAlt(POST_AUTHOR_ICON.superMod)).toBe("超级版主");
		expect(getPostAuthorIconAlt(POST_AUTHOR_ICON.mod)).toBe("版主");
		expect(getPostAuthorIconAlt(POST_AUTHOR_ICON.member)).toBe("会员");
	});
});

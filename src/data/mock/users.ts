// data/mock/users.ts — Mock user data for UI development
// Ref: 04a §User interface

import type { User } from "@/models/types";
import { UserRole, UserStatus } from "@/models/types";

export const MOCK_USERS: User[] = [
	{
		id: 1,
		username: "admin",
		email: "admin@tongji.net",
		avatar: "avatars/1.jpg",
		status: UserStatus.Active,
		role: UserRole.Admin,
		regDate: 1072915200, // 2004-01-01
		lastLogin: 1711612800, // 2024-03-28
		threads: 1250,
		posts: 8900,
		credits: 99999,
	},
	{
		id: 2,
		username: "supermod",
		email: "supermod@tongji.net",
		avatar: "avatars/2.jpg",
		status: UserStatus.Active,
		role: UserRole.SuperMod,
		regDate: 1104537600, // 2005-01-01
		lastLogin: 1711526400, // 2024-03-27
		threads: 890,
		posts: 6700,
		credits: 50000,
	},
	{
		id: 3,
		username: "mod_tech",
		email: "mod@tongji.net",
		avatar: "",
		status: UserStatus.Active,
		role: UserRole.Mod,
		regDate: 1136073600, // 2006-01-01
		lastLogin: 1711440000, // 2024-03-26
		threads: 450,
		posts: 3200,
		credits: 25000,
	},
	{
		id: 10,
		username: "zhangsan",
		email: "zhangsan@example.com",
		avatar: "avatars/10.jpg",
		status: UserStatus.Active,
		role: UserRole.User,
		regDate: 1262304000, // 2010-01-01
		lastLogin: 1711353600, // 2024-03-25
		threads: 120,
		posts: 890,
		credits: 5000,
	},
	{
		id: 11,
		username: "lisi",
		email: "lisi@example.com",
		avatar: "avatars/11.jpg",
		status: UserStatus.Active,
		role: UserRole.User,
		regDate: 1388534400, // 2014-01-01
		lastLogin: 1711267200, // 2024-03-24
		threads: 45,
		posts: 320,
		credits: 1500,
	},
	{
		id: 12,
		username: "wangwu",
		email: "wangwu@example.com",
		avatar: "",
		status: UserStatus.Banned,
		role: UserRole.User,
		regDate: 1420070400, // 2015-01-01
		lastLogin: 1609459200, // 2021-01-01
		threads: 5,
		posts: 12,
		credits: 100,
	},
	{
		id: 13,
		username: "olduser",
		email: "old@example.com",
		avatar: "",
		status: UserStatus.Archived,
		role: UserRole.User,
		regDate: 1041379200, // 2003-01-01
		lastLogin: 1451606400, // 2016-01-01
		threads: 200,
		posts: 1500,
		credits: 8000,
	},
];

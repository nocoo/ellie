// models/types.ts — Core type definitions aligned with Doc02 D1 schema
// Field names: snake_case (D1) -> camelCase (frontend)

// ─── Enums ───────────────────────────────────────────────

/** User role — maps to Doc02 users.role (from DZ adminid) */
export enum UserRole {
	User = 0,
	Admin = 1,
	SuperMod = 2,
	Mod = 3,
}

/** User status — maps to Doc02 users.status */
export enum UserStatus {
	Active = 0,
	Banned = -1,
	Archived = -2,
}

/** Sticky level — maps to Doc02 threads.sticky (from DZ displayorder) */
export enum StickyLevel {
	None = 0,
	Forum = 1,
	Global = 2,
	Category = 3,
}

/** Forum type — maps to Doc02 forums.type */
export enum ForumType {
	Group = "group",
	Forum = "forum",
	Sub = "sub",
}

// ─── Entity Interfaces ──────────────────────────────────

/** Maps to Doc02 users table — 1.14M rows */
export interface User {
	id: number;
	username: string;
	email: string;
	avatar: string;
	status: UserStatus;
	role: UserRole;
	regDate: number;
	lastLogin: number;
	threads: number;
	posts: number;
	credits: number;
}

/** Maps to Doc02 forums table — 213 rows */
export interface Forum {
	id: number;
	parentId: number;
	name: string;
	description: string;
	icon: string;
	displayOrder: number;
	threads: number;
	posts: number;
	type: ForumType;
	status: number;
	lastThreadId: number;
	lastPostAt: number;
	lastPoster: string;
}

/** Maps to Doc02 threads table — 790K rows */
export interface Thread {
	id: number;
	forumId: number;
	authorId: number;
	authorName: string;
	subject: string;
	createdAt: number;
	lastPostAt: number;
	lastPoster: string;
	replies: number;
	views: number;
	closed: number;
	sticky: StickyLevel;
	digest: number;
	special: number;
	highlight: number;
	recommends: number;
}

/** Maps to Doc02 posts table — 9.4M rows */
export interface Post {
	id: number;
	threadId: number;
	forumId: number;
	authorId: number;
	authorName: string;
	content: string;
	createdAt: number;
	isFirst: boolean;
	position: number;
}

/** Maps to Doc02 attachments table — 78K rows */
export interface Attachment {
	id: number;
	threadId: number;
	postId: number;
	authorId: number;
	filename: string;
	filePath: string;
	fileSize: number;
	isImage: boolean;
	width: number;
	hasThumb: boolean;
	downloads: number;
	createdAt: number;
}

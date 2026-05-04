/**
 * User role — maps to Doc02 users.role (from DZ adminid)
 *
 * DZ extended values (-1, 7) are passed through as-is for historical data.
 * Application code should handle unknown values gracefully.
 */
export declare enum UserRole {
    User = 0,
    Admin = 1,
    SuperMod = 2,
    Mod = 3
}
/**
 * User status — maps to Doc02 users.status
 *
 * Placeholder (-3) is used for FK integrity when the original user was deleted.
 */
/**
 * User account status — see Doc02 §6.1 (legacy: -1=Banned, -2=Archived).
 *
 * Placeholder (-3) is used for FK integrity when the original user was deleted.
 *
 * D4 Tombstone (-99): user has been "彻底清除" (admin purge). PII is wiped,
 * username is replaced with a `[已删除#<id>]` marker, all of the user's
 * threads/posts/messages have been deleted. The row is kept so that FK
 * references from collateral content + audit logs stay intact.
 */
export declare enum UserStatus {
    Tombstone = -99,// D4: tombstoned by admin purge — PII cleared, content removed
    Placeholder = -3,// FK integrity placeholder
    Archived = -2,// Historical/archived account
    Banned = -1,// Account disabled
    Active = 0
}
/**
 * Sticky level — maps to Doc02 threads.sticky (from DZ displayorder)
 *
 * Negative values indicate hidden/special states:
 *   -99: Placeholder (FK integrity)
 *    -4: Draft
 *    -3: Ignored/hidden
 *    -2: Pending moderation
 *    -1: In recycle bin
 */
export declare enum StickyLevel {
    Placeholder = -99,// FK integrity placeholder
    Draft = -4,// Saved but not published
    Ignored = -3,// Hidden by moderator
    Moderating = -2,// Pending review
    RecycleBin = -1,// In recycle bin
    None = 0,// Normal (no sticky)
    Forum = 1,// Forum-level sticky
    Global = 2,// Global sticky (all forums)
    Category = 3
}
/** Forum type — maps to Doc02 forums.type */
export declare enum ForumType {
    Group = "group",// Category/group header
    Forum = "forum",// Normal forum board
    Sub = "sub"
}
/**
 * Forum status — maps to Doc02 forums.status
 *
 * Placeholder (-1) is used for FK integrity when the original forum was deleted.
 */
export declare enum ForumStatus {
    Placeholder = -1,// FK integrity placeholder
    Hidden = 0,// Disabled, not shown
    Normal = 1,// Active forum
    Paused = 2,// Temporarily closed for posting
    QQGroup = 3
}
/**
 * Thread closed state — maps to Doc02 threads.closed
 *
 * Values > 1 indicate the thread was merged into another thread.
 */
export declare enum ThreadClosedState {
    Open = 0,// Open for replies
    Closed = 1
}
/**
 * Digest level — maps to Doc02 threads.digest (精华级别)
 */
export declare enum DigestLevel {
    None = 0,// Not digest
    Level1 = 1,// ★
    Level2 = 2,// ★★
    Level3 = 3
}
/**
 * Post visibility — maps to Doc02 posts.invisible
 */
export declare enum PostVisibility {
    DeletedByUser = -5,// Soft delete by user
    Draft = -3,// Saved but not published
    AwaitingReview = -2,// Awaiting moderator review
    DeletedByMod = -1,// Deleted by moderator
    Visible = 0,// Normal visible post
    PendingReview = 1
}
/**
 * User gender — maps to Doc02 users.gender
 */
export declare enum Gender {
    Unset = 0,
    Male = 1,
    Female = 2
}
/** Public-facing user profile — excludes email, status, lastLogin, password */
export interface PublicUser {
    id: number;
    username: string;
    avatar: string;
    avatarPath: string;
    role: UserRole;
    regDate: number;
    threads: number;
    posts: number;
    credits: number;
    signature: string;
    groupTitle: string;
    groupStars: number;
    groupColor: string;
    customTitle: string;
    digestPosts: number;
    olTime: number;
    lastActivity: number;
    gender: number;
    birthYear: number;
    birthMonth: number;
    birthDay: number;
    resideProvince: string;
    resideCity: string;
    graduateSchool: string;
    bio: string;
    interest: string;
    qq: string;
    site: string;
    regIp?: string;
    lastIp?: string;
}
/** Maps to Doc02 users table — 1.14M rows */
export interface User {
    id: number;
    username: string;
    email: string;
    avatar: string;
    avatarPath: string;
    status: UserStatus;
    role: UserRole;
    regDate: number;
    lastLogin: number;
    threads: number;
    posts: number;
    credits: number;
    signature: string;
    groupTitle: string;
    groupStars: number;
    groupColor: string;
    customTitle: string;
    digestPosts: number;
    olTime: number;
    gender: number;
    birthYear: number;
    birthMonth: number;
    birthDay: number;
    resideProvince: string;
    resideCity: string;
    graduateSchool: string;
    bio: string;
    interest: string;
    qq: string;
    site: string;
    lastActivity: number;
    /**
     * Email verification state — see docs/17-email-verification.md §3, §6.1.
     * 0 = unverified (sentinel). > 0 = unix seconds at the moment of verification.
     */
    emailVerifiedAt: number;
    /** Lowercased + trimmed snapshot of `email`. Empty for legacy rows. */
    emailNormalized: string;
    /** Unix seconds of the last successful email change while unverified. 0 if never. */
    emailChangedAt: number;
    /** Whether user has uploaded an avatar (determines posting permission) */
    hasAvatar?: boolean;
    /** Registration IP (admin-only) */
    regIp?: string;
    /** Last login IP (admin-only) */
    lastIp?: string;
    /**
     * D4 tombstone — unix seconds at the moment of `POST /admin/users/:id/purge`.
     * 0 = not purged. Status is `UserStatus.Tombstone (-99)` when set.
     */
    purgedAt: number;
    /** Admin user id who issued the purge. 0 if never purged. */
    purgedBy: number;
}
/** Moderator info for display */
export interface ModeratorInfo {
    id: number;
    name: string;
}
/** Forum visibility level */
export type ForumVisibility = "public" | "members" | "staff" | "admin";
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
    visibility: ForumVisibility;
    moderators: string;
    moderatorList: ModeratorInfo[];
    todayThreads: number;
    lastThreadId: number;
    lastPostAt: number;
    lastPoster: string;
    lastPosterId: number;
    lastPosterAvatar: string;
    lastPosterAvatarPath: string;
    lastThreadSubject: string;
}
/** Maps to Doc02 threads table — 790K rows */
export interface Thread {
    id: number;
    forumId: number;
    authorId: number;
    authorName: string;
    authorAvatar: string;
    authorAvatarPath: string;
    subject: string;
    createdAt: number;
    lastPostAt: number;
    lastPoster: string;
    lastPosterId: number;
    lastPosterAvatar: string;
    lastPosterAvatarPath: string;
    replies: number;
    views: number;
    closed: number;
    sticky: StickyLevel;
    digest: number;
    special: number;
    highlight: number;
    recommends: number;
    typeName: string;
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
/** Maps to ip_bans table — IP ban management */
export interface IpBan {
    id: number;
    ip: string;
    adminId: number;
    adminName: string;
    reason: string;
    expiresAt: number | null;
    createdAt: number;
}
/** Maps to censor_words table — content filtering rules */
export interface CensorWord {
    id: number;
    find: string;
    replacement: string;
    action: "ban" | "replace";
    adminId: number;
    adminName: string;
    createdAt: number;
}
/** Maps to post_comments table — 点评 (short comments on posts) */
export interface PostComment {
    id: number;
    threadId: number;
    postId: number;
    authorId: number;
    authorName: string;
    content: string;
    score: number;
    replyPostId: number;
    createdAt: number;
}

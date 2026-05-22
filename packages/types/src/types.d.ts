import type { UserCheckinSummary } from "./checkin";
import type { PostRatingAggregate } from "./rating";
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
    coins: number;
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
    /** 校区 — campus affiliation, e.g. "四平路校区" / "校外人士". Empty if not set. */
    campus: string;
    /** Daily check-in summary. `null` when the user has never checked in. */
    checkin: UserCheckinSummary | null;
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
    coins: number;
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
    /** 校区 — campus affiliation, e.g. "四平路校区" / "校外人士". Empty if not set. */
    campus: string;
    /** Daily check-in summary. `null` when the user has never checked in. */
    checkin: UserCheckinSummary | null;
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
    /**
     * Admin-list-only enrichment: number of private messages where the user
     * is sender OR receiver. Populated by the admin user list handler via
     * post-page enrichment; absent on detail / non-admin payloads. Mirrors
     * the `purgeUser` pre-flight semantics so the count an operator sees is
     * the same one purge will report on success.
     */
    messagesCount?: number;
    /**
     * Admin-list-only enrichment: number of `attachments` rows uploaded by
     * this user (`author_id`). Populated only on the admin user list.
     */
    attachmentsCount?: number;
    /**
     * Admin user-detail-only soft signal — current online IP from the
     * `online:<uid>` KV entry written by the online-tracker middleware.
     * Present only when KV holds a fresh (TTL-window, ≤15min) snapshot.
     * Distinct from `lastIp` (persistent last-login IP). UI label:
     * "当前在线 IP".
     */
    onlineIp?: string;
    /**
     * Admin user-detail-only soft signal — last URL pathname seen by the
     * online tracker for this user. Same TTL gate as `onlineIp`.
     */
    onlinePage?: string;
    /**
     * Admin user-detail-only soft signal — unix seconds of the most recent
     * online-tracker write. Same TTL gate as `onlineIp`.
     */
    onlineTs?: number;
}
/** Moderator info for display */
export interface ModeratorInfo {
    id: number;
    name: string;
}
/** Forum visibility level */
export type ForumVisibility = "public" | "members" | "staff" | "admin";
/**
 * Per-forum thread-category configuration switches (Doc forums.thread_types_*).
 *
 * Always returned as part of `Forum` so the web layer can decide in a single
 * round trip whether to render the category filter / picker / required hint
 * (reviewer pin msg b03d4af3 + 4b64ac64).
 *
 *   • enabled  — admin master switch; gates every other option
 *   • required — posting requires a non-zero category
 *   • listable — list endpoint accepts `typeId` filter
 *   • prefix   — render the category as a subject prefix (UI hint)
 */
export interface ForumThreadTypeConfig {
    enabled: boolean;
    required: boolean;
    listable: boolean;
    prefix: boolean;
}
/**
 * Public DTO for one row of `forum_thread_types` (a 主题分类).
 *
 * `id` is the D1 SYNTHETIC global id minted by 0039 — what threads.type_id
 * stores and what every public API (list filter, post create body) takes.
 * The Discuz-local `source_typeid` is admin/debug-only and intentionally
 * NOT exposed here.
 *
 * Tombstone rows (enabled=false) appear so the web can render historical
 * thread badges; create/required validation accepts only enabled rows.
 */
export interface ForumThreadType {
    id: number;
    name: string;
    displayOrder: number;
    icon: string;
    enabled: boolean;
    moderatorOnly: boolean;
}
/** Maps to Doc02 forums table — 213 rows */
export interface Forum {
    id: number;
    parentId: number;
    name: string;
    description: string;
    /**
     * Long-form HTML announcement shown in the forum-page top card below
     * `description`. Set by forum moderators / SuperMod / Admin via the
     * web edit dialog; **server-side sanitized** before write. Empty
     * string means "no announcement card" — UI hides the section.
     *
     * Restored from legacy Discuz `pre_forum_forumfield.rules`; see
     * migration 0044 for column semantics and allowlist rules.
     */
    announcement: string;
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
    /** Per-forum thread-category configuration; always returned. */
    threadTypes: ForumThreadTypeConfig;
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
    /** True when this thread is the earliest visible thread by the author. */
    isAuthorFirstThread: boolean;
    /**
     * True when this thread appears in its forum's `forum_recommended_threads`
     * allowlist (migration 0045). Drives the "已推荐 / 推荐" toggle label on
     * the thread-detail mod menu. Populated by `thread.getById` via an
     * `EXISTS` probe on the composite PK; list-view payloads do not carry
     * this field (it is not part of the forum-page thread list).
     */
    isRecommended: boolean;
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
    /**
     * Per-post per-dimension rating aggregate (docs/22 §6.3). Always present;
     * posts with no ratings carry a zero-state aggregate so the UI never has
     * to null-check this field.
     */
    ratingAggregate: PostRatingAggregate;
}
/**
 * Subset of `Thread` fields needed to render a post-history row alongside its
 * parent thread on the user profile page.
 *
 * The user profile "回复" tab joins `posts` with `threads` (the SQL already
 * inner-joins for visibility); this carries the joined columns up to the
 * frontend so it can show the same forum-list-style row (icon → title →
 * forum → replies/views → time) without a second `/threads/:id` lookup.
 */
export interface PostThreadSummary {
    id: number;
    forumId: number;
    subject: string;
    replies: number;
    views: number;
    createdAt: number;
    lastPostAt: number;
    closed: number;
    sticky: StickyLevel;
    digest: number;
    special: number;
    highlight: number;
    typeName: string;
}
/**
 * Composite item for the user profile "回复" tab.
 *
 * `post` is the user's reply event (used for time + cursor); `thread` is the
 * parent thread (used for the forum-list-style title/forum/stats row).
 */
export interface UserPostHistoryItem {
    post: Post;
    thread: PostThreadSummary;
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

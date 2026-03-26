import type {
	Attachment,
	Forum,
	Post,
	StickyLevel,
	Thread,
	User,
	UserRole,
	UserStatus,
} from "@ellie/types";
/** Keyset pagination result — 04a §Pagination */
export interface PaginatedResult<T> {
	items: T[];
	nextCursor: string | null;
	prevCursor: string | null;
	total: number;
}
/** Common pagination params */
export interface PaginationParams {
	cursor?: string;
	direction?: "forward" | "backward";
	limit?: number;
}
export interface UpdateForumInput {
	name?: string;
	description?: string;
	icon?: string;
	status?: number;
	displayOrder?: number;
}
export interface ForumRepository {
	/** Get all forums (213 rows, no pagination needed) */
	listAll(): Promise<Forum[]>;
	/** Get forum by ID */
	getById(id: number): Promise<Forum | null>;
	/** Update forum info (admin use) */
	update(id: number, input: UpdateForumInput): Promise<void>;
}
export interface ThreadListParams extends PaginationParams {
	forumId?: number;
	authorId?: number;
	digest?: boolean;
	createdAfter?: number;
	sort?: "latest" | "newest" | "hot";
}
export interface ThreadSearchParams extends PaginationParams {
	titlePrefix?: string;
	authorName?: string;
}
export interface CreateThreadInput {
	forumId: number;
	authorId: number;
	authorName: string;
	subject: string;
	content: string;
}
export interface ThreadRepository {
	list(params: ThreadListParams): Promise<PaginatedResult<Thread>>;
	search(params: ThreadSearchParams): Promise<PaginatedResult<Thread>>;
	getById(id: number): Promise<Thread | null>;
	create(input: CreateThreadInput): Promise<Thread>;
	delete(id: number): Promise<void>;
	/** Moderation operations */
	setSticky(id: number, level: StickyLevel): Promise<void>;
	setDigest(id: number, level: number): Promise<void>;
	setClosed(id: number, closed: boolean): Promise<void>;
	move(id: number, targetForumId: number): Promise<void>;
}
export interface PostListParams extends PaginationParams {
	threadId?: number;
	authorId?: number;
}
export interface CreatePostInput {
	threadId: number;
	authorId: number;
	authorName: string;
	content: string;
}
export interface PostRepository {
	list(params: PostListParams): Promise<PaginatedResult<Post>>;
	create(input: CreatePostInput): Promise<Post>;
	delete(id: number): Promise<void>;
}
export interface UserListParams extends PaginationParams {
	search?: string;
	role?: UserRole;
	status?: UserStatus;
	lastLoginAfter?: number;
	sort?: "newest" | "lastLogin";
}
export interface UserRepository {
	list(params: UserListParams): Promise<PaginatedResult<User>>;
	getById(id: number): Promise<User | null>;
	/** Admin operations */
	setStatus(id: number, status: UserStatus): Promise<void>;
	setRole(id: number, role: UserRole): Promise<void>;
}
export interface AttachmentRepository {
	/** Get attachments for a post */
	listByPostId(postId: number): Promise<Attachment[]>;
	/** Get attachments for a thread */
	listByThreadId(threadId: number): Promise<Attachment[]>;
}

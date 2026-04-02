// tests/e2e/fixtures/selectors.ts — Common selectors for E2E tests
// Ref: docs/e2e-test-design.md §Page Object Corrections
// Centralized selectors to avoid repetition across page objects

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export const NAV = {
	/** Site logo in header */
	logo: 'a[href="/"]',
	/** Theme toggle button */
	themeToggle: 'button[aria-label*="mode"], button[aria-label*="theme"]',
	/** Search icon/link in header */
	searchLink: 'a[href="/search"]',
	/** User dropdown trigger */
	userMenu: '[data-testid="user-menu"]',
} as const;

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export const FORM = {
	/** Username input on login/register */
	usernameInput: 'input[id="username"]',
	/** Password input on login/register */
	passwordInput: 'input[id="password"]',
	/** Submit button */
	submitButton: 'button[type="submit"]',
} as const;

// ---------------------------------------------------------------------------
// Forum
// ---------------------------------------------------------------------------

export const FORUM = {
	/** New thread button on forum page */
	newThreadButton: 'button:has-text("发表新帖")',
	/** Thread list container */
	threadList: ".divide-y",
	/** Thread item in list */
	threadItem: ".divide-y > div",
} as const;

// ---------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------

export const THREAD = {
	/** Post card container */
	postCard: '[data-testid="post-card"], .bg-card',
	/** Reply button (floating actions) */
	replyButton: 'button:has-text("回复")',
	/** Post content area */
	postContent: ".prose",
} as const;

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export const DIALOG = {
	/** Generic dialog overlay */
	overlay: '[role="dialog"]',
	/** Dialog close button */
	closeButton: 'button[aria-label="Close"]',
} as const;

// ---------------------------------------------------------------------------
// User Profile
// ---------------------------------------------------------------------------

export const USER = {
	/** User avatar */
	avatar: 'img[alt*="avatar"], .avatar',
	/** Stats cards container */
	statsCards: '[data-testid="stats-cards"]',
	/** Tab navigation - plain div.flex, not ARIA tablist */
	tabNav: "div.flex.items-center.gap-1",
} as const;

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export const SEARCH = {
	/** Search input field */
	input: 'input[name="q"], input[placeholder*="搜索"], input[type="search"]',
	/** Search submit button */
	submitButton: 'button:has-text("搜索")',
	/** Search type tabs container (not ARIA tablist, just div.flex) */
	typeTabs: ".flex.items-center.gap-1.border-b",
} as const;

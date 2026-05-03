# Changelog

All notable changes to this project will be documented in this file.

## [1.2.1] - 2026-05-03

### Added

- **Post image upload**: Magic-byte sniffing for image validation on upload + serve endpoints
- **L3 E2E test suite**: 15 new spec files covering post CRUD, thread CRUD, pagination, search, digest filter, user journey, messages, post-comments, and redirect security (39 total L3 tests)

### Fixed

- **CSRF origin allowlist**: Added E2E port (27031) to allowed origins, unblocking write operations in L3 tests
- **Open redirect**: `buildRedirectUrl` no longer trusts forwarded-host header
- **Post-comments API**: Client uses `searchParams` object form for correct query forwarding
- **DM receiver validation**: Reject receivers with `status < 0` as `USER_NOT_FOUND`
- **Post-comment permissions**: Route `post-comment:create` through `checkPostingPermission` gate
- **Thread metadata on delete**: Recalculate thread replies/last_poster when deleting non-first posts
- **CI build failures**: `force-dynamic` on forum/admin layouts prevents pre-render env var errors
- **CI migrations**: Fix D1 migration command and vitest isolation for GitHub Actions

### Changed

- **Worker refactors**: Consolidated cursor responses, pagination clamping, forum status guards, and removed dead exports/aliases
- **Proxy error passthrough**: Unified error forwarding across all v1 proxy routes

## [1.2.0] - 2026-05-02

### Added

- **Email verification flow**: Request-code + verify endpoints with HMAC-signed codes, KV-backed state, and Dove email relay integration
- **Email verification UI**: `EmailVerificationCard` on `/me` and `/verify-email` pages with 6-digit code input
- **Email verification gate**: `withVerifiedEmail` middleware rejects unverified users on write endpoints (§5.4 dialog)
- **EmailVerificationBanner**: Server-rendered banner nudging unverified users to verify
- **EmailVerificationDialog**: Client-side dialog triggered on §5.4 403 responses

### Changed

- **CAPTCHA unified to Cap.js**: Replaced Cloudflare Turnstile with Cap.js for email verification (client-side only gate, matching login/register pattern)
- **FOUC prevention**: Externalized inline script to `public/fouc.js`
- **Button variants**: Extracted `buttonVariants` to dedicated module

### Fixed

- **Cap widget event listeners**: Fixed listeners not attaching after mount (stable refs + `[mounted]` dependency)
- **KV send-lock TTL**: Raised from 10s to 60s (Cloudflare KV minimum)

## [1.1.0] - 2026-04-12

### Added

- **GUID-based avatar storage**: New upload system generates unique paths (`avatars/{uuid}.{ext}`) to bypass cache issues
- **Avatar path endpoint**: New internal API `/api/v1/users/:id/avatar-path` for avatar proxy resolution
- **Legacy avatar support**: Users with `has_avatar=1` (legacy system) can still post when avatar is required

### Fixed

- **Avatar cache handling**: Distinguish API errors from no-avatar cases; errors cache 5 min instead of 1 day
- **Banned user avatars**: Avatar proxy can now resolve avatars for banned/archived users whose posts are visible
- **Posting permission**: Check both `avatar_path` (new) and `has_avatar` (legacy) for avatar requirement

### Changed

- Avatar upload now stores GUID-based paths in `avatar_path` field
- Avatar proxy uses new `/avatar-path` endpoint instead of public user API

## [1.0.0] - Initial Release

- Forum thread and post viewing
- User authentication and profiles
- Private messaging system
- Moderation tools
- Admin panel
- Rust TUI client

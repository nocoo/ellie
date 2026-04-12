# Changelog

All notable changes to this project will be documented in this file.

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

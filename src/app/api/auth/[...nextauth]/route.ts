// api/auth/[...nextauth]/route.ts — NextAuth catch-all handler
// Ref: 04b §认证方案 — credentials provider + JWT session
//
// Uses the singleton auth instance from @/lib/auth-instance.
// Phase 2: auth source moves to Worker, NextAuth is removed entirely.

import { handlers } from "@/lib/auth-instance";

export const { GET, POST } = handlers;

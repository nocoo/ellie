// api/auth/[...nextauth]/route.ts — NextAuth catch-all handler
// Ref: 04b §认证方案 — credentials provider + JWT session
//
// Uses createAuth() from @/auth bound to the shared MockDataStore.
// Phase 2: auth source moves to Worker, NextAuth is removed entirely.

import { createAuth } from "@/auth";
import { createRepositories } from "@/data/index";

const repos = createRepositories();
const { handlers } = createAuth(repos._store.users);

export const { GET, POST } = handlers;

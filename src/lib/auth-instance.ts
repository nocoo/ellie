// lib/auth-instance.ts — Singleton NextAuth instance
// Ref: 04b §认证方案 — single auth instance shared across proxy + API + UI
//
// NextAuth v5 requires a single instance to share JWT secret, callbacks,
// and provider config. This module creates it once using the singleton
// MockDataStore, so auth checks in proxy, route handlers, and server
// components all validate against the same session/JWT.

import { createAuth } from "@/auth";
import { createRepositories } from "@/data/index";

const repos = createRepositories();

export const { handlers, auth, signIn, signOut } = createAuth(repos._store.users);

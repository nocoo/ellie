# 04g — 用户注册与登录

> 论坛用户的注册、登录、会话管理与 NextAuth 对接设计。
>
> **前置依赖**：04a（类型定义）、04d（论坛前端）、05（Worker API）

---

## 概览

系统存在**两套独立的认证体系**，各自服务不同用户群体：

| 维度 | 论坛用户（本文档范围） | Admin 后台（已实现） |
|------|----------------------|---------------------|
| 身份源 | 用户名/密码 → Worker JWT | Google OAuth → NextAuth JWT |
| API 密钥 | Key A (`API_KEY`) | Key B (`ADMIN_API_KEY`) |
| Worker 端点 | `/api/v1/*` | `/api/admin/*` |
| 实现状态 | ⚠️ Worker 登录已有，前端未对接 | ✅ 完整 |

### 现状分析

**已实现的部分：**

| 组件 | 状态 | 文件 |
|------|------|------|
| Worker `POST /api/v1/auth/login` | ✅ 完整 | `apps/worker/src/handlers/auth.ts` |
| Worker `POST /api/v1/auth/refresh` | ✅ 完整 | 同上 |
| Worker `DELETE /api/v1/auth/logout` | ✅ 完整 | 同上 |
| Worker `GET /api/v1/auth/me` | ✅ 完整 | 同上 |
| Worker `POST /api/v1/users/me/password` | ✅ 完整 | `apps/worker/src/handlers/me.ts` |
| 密码体系（DZ 兼容 + PBKDF2 + 静默升级） | ✅ 完整 | `apps/worker/src/lib/password.ts` |
| JWT 签发/验证 (HS256) | ✅ 完整 | `apps/worker/src/lib/jwt.ts` |
| Refresh Token (KV 存储，30 天 TTL) | ✅ 完整 | auth handler 内嵌 |
| 论坛登录页 UI | ✅ 完整 | `apps/web/src/app/(forum)/login/page.tsx` |
| Auth viewmodel (验证 + 错误映射) | ✅ 完整 | `apps/web/src/viewmodels/forum/auth.ts` |
| Route 保护 (`/threads/new` 需登录) | ✅ 完整 | `apps/web/src/proxy.ts` |
| NextAuth SessionProvider | ✅ 完整 | `apps/web/src/components/providers.tsx` |

**缺失的部分：**

| 组件 | 状态 | 说明 |
|------|------|------|
| NextAuth Credentials Provider | ❌ 未实现 | `auth.ts` 只有 Google Provider |
| NextAuth session 扩展 (论坛字段) | ❌ 未实现 | session.user 只有 Google 字段 |
| Worker JWT 存储 & 透传 | ❌ 未实现 | 前端无法调用需认证的 Worker API |
| 注册端点 | ❌ 不存在 | Worker 无 `POST /api/v1/auth/register` |
| 注册页面 | ❌ 不存在 | 前端无 `/register` 路由 |

---

## §1 Worker 注册端点

### §1.1 端点定义

```
POST /api/v1/auth/register
Headers: X-API-Key: <Key A>
Content-Type: application/json
```

> **调用方**：Next.js Server Action（服务端），Key A 由服务端注入，不暴露给浏览器。见 §3.4。

### §1.2 请求体

```typescript
interface RegisterInput {
  username: string;     // 必填
  password: string;     // 必填
  email?: string;       // 选填
  inviteCode?: string;  // 选填（预留，Phase 1 不实现）
}
```

### §1.3 验证规则

| 字段 | 规则 | 错误码 |
|------|------|--------|
| `username` | 非空，2–15 字符，仅允许中文/英文/数字/下划线 | `INVALID_USERNAME` (400) |
| `username` | 不在敏感词库中（复用 `censor_words` 表） | `USERNAME_BANNED` (400) |
| `username` | 数据库唯一性约束 | `USERNAME_TAKEN` (409) |
| `password` | 非空，≥6 字符 | `INVALID_PASSWORD` (400) |
| `email` | 若提供，需符合 email 格式 | `INVALID_EMAIL` (400) |

### §1.4 注册流程

```
1. 校验输入字段（格式、长度）
2. 敏感词过滤 username（复用 censorContent 逻辑）
3. IP 频率限制检查（§1.7）
4. 使用 PBKDF2-SHA256 哈希密码（hashPassword()）
5. 插入用户记录（INSERT 自带 UNIQUE 约束兜底）:
   INSERT INTO users (
     username, email, password_hash, password_salt,
     status, role, reg_date, last_login, last_activity,
     group_title, group_stars
   ) VALUES (
     ?, ?, ?, '',
     0, 0, now, now, now,
     '新手上路', 0
   )
6. 捕获 INSERT 异常:
   - 如果是 UNIQUE constraint violation → 返回 409 USERNAME_TAKEN
   - 其他异常 → 返回 500
7. 签发 JWT + Refresh Token（复用 login 逻辑）
8. 返回与 login 相同格式的响应
```

**关键**：步骤 5-6 确保即使并发注册同用户名（两个请求都通过了步骤 2 的 SELECT 检查），INSERT 的 `UNIQUE(username)` 约束仍然能拦住后到的请求，并通过异常捕获正确映射为 409 而非 500。

### §1.5 响应

**成功 (201):**

```json
{
  "data": {
    "token": "<JWT>",
    "refreshToken": "<UUID>",
    "user": {
      "userId": 1140001,
      "username": "newuser",
      "role": 0
    }
  },
  "meta": { "timestamp": 1711900000000, "requestId": "<UUID>" }
}
```

**错误:**

| 状态码 | 错误码 | 场景 |
|--------|--------|------|
| 400 | `INVALID_USERNAME` | 用户名格式不合法 |
| 400 | `INVALID_PASSWORD` | 密码太短 |
| 400 | `INVALID_EMAIL` | 邮箱格式不合法 |
| 400 | `USERNAME_BANNED` | 用户名含敏感词 |
| 409 | `USERNAME_TAKEN` | 用户名已被注册（SELECT 预检 或 INSERT UNIQUE 约束） |
| 429 | `RATE_LIMITED` | IP 注册频率超限 |

### §1.6 ID 分配策略

迁移数据的用户 ID 来自 Discuz（范围约 1–114 万），新注册用户 ID 需避免冲突。

**方案：** D1 的 `INTEGER PRIMARY KEY` 在不指定值时自动使用 `ROWID`，SQLite 会取 `max(id) + 1`。迁移完成后 max ID 约为 114 万，新用户 ID 从 114 万+ 自增，无冲突。不需要额外处理。

### §1.7 反滥用（Phase 1 基础版）

| 措施 | 实现 |
|------|------|
| IP 频率限制 | 同一 IP 每小时最多注册 3 个账号，使用 KV 计数：`reg-ip:{ip}` → TTL 1h |
| 用户名敏感词 | 复用 censor_words 表 |
| 密码最低长度 | ≥6 字符 |

**暂不实现（后续按需）：**
- CAPTCHA / 验证码
- 邮箱验证
- 邀请码
- 管理员审核

---

## §2 NextAuth Credentials Provider

### §2.1 核心改动

在 `apps/web/src/auth.ts` 中添加 Credentials provider，与 Google provider 共存：

```typescript
import Credentials from "next-auth/providers/credentials";

// Credentials provider — 论坛用户登录
Credentials({
  credentials: {
    username: { label: "Username", type: "text" },
    password: { label: "Password", type: "password" },
  },
  async authorize(credentials) {
    // 调用 Worker login API（服务端执行，Key A 不暴露）
    const res = await fetch(`${WORKER_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": FORUM_API_KEY,
      },
      body: JSON.stringify({
        username: credentials.username,
        password: credentials.password,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const code = body?.error?.code;
      if (code === "USER_BANNED") {
        // 在 user 对象上标记 banned 状态，由 signIn callback 处理（见 §2.5）
        // 不能在 authorize 中 throw — NextAuth 会包成 CallbackRouteError，
        // 前端只能看到通用错误而不是 AccessDenied
        return { id: "banned", name: "", banned: true } as any;
      }
      // INVALID_CREDENTIALS 或其他 → return null → NextAuth 抛 CredentialsSignin
      return null;
    }

    const { data } = await res.json();
    // 返回 NextAuth User 对象（这些字段会进入 JWT callback 的 user 参数）
    return {
      id: String(data.user.userId),
      name: data.user.username,
      workerJwt: data.token,
      workerRefreshToken: data.refreshToken,
      role: data.user.role,
    };
  },
})
```

### §2.2 JWT Callback 扩展

NextAuth 的 JWT callback 需要处理两种 provider。

**`auth()` 在服务端的行为（源码分析）**：

NextAuth v5 的 `auth()` 在 RSC / Server Action 中无参调用时，执行链如下：

1. 解码 cookie 中的 JWT
2. **调用 jwt callback**（含 refresh 逻辑）→ 得到更新后的 `token`
3. 调用 session callback（传入 `{ session, token }`）→ 得到 `newSession`
4. **重新签名 token 并写回 cookie**（刷新后的 workerJwt 持久化）
5. 返回 `{ user: token, ...newSession }`

**⚠️ 关键陷阱**：步骤 5 中 `...newSession` 展开后 `newSession.user` 会**覆盖**前面的 `user: token`。所以 `auth()` 返回值中 `result.user` 最终是 session callback 输出的 `session.user`，**不包含** `workerJwt` 等 token 私有字段。

**⚠️ 第二个陷阱**：步骤 4 的 "写回 cookie" 仅在 **proxy（middleware wrapper 模式）** 中生效。`auth()` 在 RSC/Server Action 中无参调用时，执行 `getSession(...).then(r => r.json())`，`.json()` 丢弃了 Response 的 Set-Cookie 头，**cookie 不会被写回**。

**结论**：
- `auth()` **在 proxy 层**触发 jwt callback（refresh）并通过 handleAuth() 写回 cookie ✅
- `auth()` **在 RSC/Server Action**触发 jwt callback 但**不写回 cookie** ❌
- `auth()` 返回值中**拿不到** workerJwt（`{ user, ...session }` 覆盖）❌
- Server Action 使用 `decode()` 直接解密 cookie 获取 workerJwt（见 §3.2）

```typescript
async jwt({ token, user, account, profile }) {
  // ── Google OAuth (admin) ──
  if (account?.provider === "google") {
    token.sub = profile?.sub;
    token.email = profile?.email;
    token.name = profile?.name;
    token.picture = profile?.picture as string;
    token.provider = "google";
    return token;
  }

  // ── Credentials 首次登录 ──
  if (account?.provider === "credentials" && user) {
    // 跳过 banned 占位 user（由 signIn callback 在后续拦截，见 §2.5）
    if ((user as any).banned) return token;

    token.provider = "credentials";
    token.sub = user.id;
    token.name = user.name;
    token.workerJwt = user.workerJwt;
    token.workerRefreshToken = user.workerRefreshToken;
    token.workerJwtExp = decodeJwtExp(user.workerJwt);
    token.role = user.role;
    token.error = undefined; // 清除旧错误
    return token;
  }

  // ── 后续请求：检查 Worker JWT 过期 ──
  if (token.provider === "credentials" && token.workerJwtExp) {
    const now = Math.floor(Date.now() / 1000);
    const buffer = 5 * 60; // 提前 5 分钟刷新
    if (now > token.workerJwtExp - buffer) {
      const refreshed = await refreshWorkerToken(token.workerRefreshToken);
      if (refreshed) {
        token.workerJwt = refreshed.token;
        token.workerRefreshToken = refreshed.refreshToken;
        token.workerJwtExp = decodeJwtExp(refreshed.token);
        token.error = undefined;
      } else {
        // Refresh 失败 → 将 error 传入 session，由前端处理
        token.error = "RefreshTokenExpired";
      }
    }
  }

  return token;
}
```

### §2.3 Session Callback 扩展

Session callback 决定**客户端** `useSession()` 能看到什么。`workerJwt` 不在此处输出。

> **`workerJwt` 不通过 `auth()` 返回值传递**。
> `auth()` 返回 `{ user, ...session }`，`...session` 展开后 `session.user` 会覆盖前面的 `user`，
> 最终 `result.user` 是 session callback 的输出，不含 `workerJwt`。
> Server Action 通过 `decode()` 直接解密 cookie 获取 `workerJwt`（见 §3.2）。
> 客户端 `useSession()` 走 `/api/auth/session`，只能看到 session callback 的输出。

```typescript
session({ session, token }) {
  if (token.provider === "credentials") {
    session.user.id = token.sub ?? "";
    session.user.name = token.name ?? "";
    session.user.provider = "credentials";
    session.user.role = token.role;
    // 传递 error 到客户端，用于前端检测 session 失效
    if (token.error) {
      session.error = token.error;
    }
    // workerJwt 故意不放入 session
    // 客户端 useSession() 看不到它
    // 服务端通过 decode(cookie) 直接读取（见 §3.2）
  } else {
    // Google OAuth — 保持现有行为
    session.user.id = token.sub ?? "";
    session.user.email = token.email ?? "";
    session.user.name = token.name ?? "";
    session.user.image = token.picture as string | undefined;
    session.user.provider = "google";
  }
  return session;
}
```

### §2.4 类型扩展

```typescript
// types/next-auth.d.ts
declare module "next-auth" {
  interface User {
    workerJwt?: string;
    workerRefreshToken?: string;
    role?: number;
  }
  interface Session {
    user: {
      id: string;
      name: string;
      email?: string;
      image?: string;
      provider: "credentials" | "google";
      role?: number;       // UserRole enum
    };
    error?: string;        // "RefreshTokenExpired" 等
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    provider?: "credentials" | "google";
    workerJwt?: string;
    workerRefreshToken?: string;
    workerJwtExp?: number;
    role?: number;
    error?: string;
  }
}
```

### §2.5 signIn Callback — Banned 用户拦截

在 Credentials provider 中，`authorize()` 抛异常会被包成 `CallbackRouteError`，前端收不到 `AccessDenied` 错误码。正确做法是：

1. `authorize()` 对 banned 用户返回一个带标记的 user 对象（而非 throw）
2. `signIn` callback 检查标记，`return false` → NextAuth 抛 `AccessDenied`
3. 前端 `loginErrorMessage("AccessDenied")` → "账号已被禁用"

```typescript
callbacks: {
  async signIn({ user, account }) {
    // Credentials provider 的 banned 用户拦截
    if (account?.provider === "credentials" && (user as any).banned) {
      return false;  // → NextAuth 抛 AccessDenied → 前端收到 "AccessDenied" 错误码
    }
    return true;
  },
  // jwt, session callbacks...
}
```

**错误码流转**：
```
Worker 返回 USER_BANNED
  → authorize() return { banned: true }（不是 return null、不是 throw）
  → signIn callback return false
  → NextAuth 内部 throw AccessDenied
  → signIn() 返回 { error: "AccessDenied" }
  → loginErrorMessage("AccessDenied") → "账号已被禁用"
```

对比其他路径：
```
Worker 返回 INVALID_CREDENTIALS
  → authorize() return null
  → NextAuth 内部 throw CredentialsSignin
  → signIn() 返回 { error: "CredentialsSignin" }
  → loginErrorMessage("CredentialsSignin") → "用户名或密码错误"
```

---

## §3 Worker JWT 透传

### §3.1 架构决策

**选择 Server Action 代理模式**，不把 Worker JWT 暴露给浏览器：

```
Browser → Server Action → decode(cookie).workerJwt → 调用 Worker API → 返回结果
```

理由：
- Worker JWT 含 userId + role，暴露到浏览器有伪造/窃取风险
- Server Action 天然适配 Next.js RSC 生态
- 复用现有 `forum-api.ts` 的服务端调用模式

### §3.2 获取 Worker JWT 的正确方式

**使用 `decode()` 直接解密 NextAuth cookie**，不通过 `auth()` 返回值。

#### 为什么不能用 `auth()` 的返回值？

根据 §2.2 的源码分析，`auth()` 在 RSC/Server Action 中无参调用时返回 `{ user, ...session }`，`...session` 展开后 `session.user` 会**覆盖** `user: token`，导致返回值中 `result.user` 是 session callback 的输出（不含 `workerJwt`），而非完整 token。

#### 为什么不需要在 Server Action 中触发 refresh？

Worker JWT 的 refresh 由 **proxy（路由保护层）** 负责，它在**每个页面请求**时执行：

```
proxy.ts 使用 auth() 的 middleware wrapper 模式
  → handleAuth() 调用 getSession()
  → getSession() 内部触发 jwt callback（含 refresh 逻辑）
  → Auth() 返回的 Response 包含 Set-Cookie
  → handleAuth() 将 Set-Cookie 复制到 finalResponse ✅
  → 浏览器收到刷新后的 cookie
```

而 `auth()` 在 RSC/Server Action 中**无参调用**时：
```
auth() → getSession(...).then(r => r.json())  // .json() 丢弃 Set-Cookie headers ❌
```

因此 refresh 链路在 proxy 层已经完成，Server Action 只需**读取已刷新的 cookie** 即可。

#### 实现：直接解密 cookie

使用 `@auth/core/jwt` 的 `decode()` 直接解密 NextAuth session cookie，获取完整的 JWT payload（含 `workerJwt`）。这是纯密码学操作，不触发任何 callback，不修改 cookie。

```typescript
// lib/forum-auth.ts
import "server-only";

import { decode } from "@auth/core/jwt";
import { cookies } from "next/headers";

const AUTH_SECRET = process.env.AUTH_SECRET!;

/**
 * NextAuth cookie name:
 * - Production (HTTPS): "__Secure-authjs.session-token"
 * - Development (HTTP):  "authjs.session-token"
 *
 * decode() 的 salt 参数必须与 cookie name 一致，
 * 因为加密密钥由 HKDF(secret, salt) 派生。
 */
function getSessionCookieName(): string {
  const isSecure = process.env.NODE_ENV === "production"
    || process.env.NEXTAUTH_URL?.startsWith("https://");
  return isSecure
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";
}

/** 获取当前论坛用户的 Worker JWT，未登录返回 null */
export async function getWorkerJwt(): Promise<string | null> {
  const cookieName = getSessionCookieName();
  const cookieStore = await cookies();
  const raw = cookieStore.get(cookieName)?.value;
  if (!raw) return null;

  const token = await decode({
    token: raw,
    secret: AUTH_SECRET,
    salt: cookieName,
  });
  if (!token) return null;
  if (token.provider !== "credentials") return null;
  if (token.error === "RefreshTokenExpired") return null;
  return (token.workerJwt as string) ?? null;
}

/** 获取当前论坛用户信息，未登录返回 null */
export async function getCurrentForumUser(): Promise<{
  userId: number;
  username: string;
  role: number;
} | null> {
  const cookieName = getSessionCookieName();
  const cookieStore = await cookies();
  const raw = cookieStore.get(cookieName)?.value;
  if (!raw) return null;

  const token = await decode({
    token: raw,
    secret: AUTH_SECRET,
    salt: cookieName,
  });
  if (!token) return null;
  if (token.provider !== "credentials") return null;
  return {
    userId: Number(token.sub),
    username: (token.name as string) ?? "",
    role: (token.role as number) ?? 0,
  };
}
```

#### 为什么这是安全的？

| 关注点 | 说明 |
|--------|------|
| workerJwt 不到达浏览器 | cookie 是 httpOnly JWE（加密），浏览器 JS 无法解密；`decode()` 仅在服务端执行 |
| refresh 链路完整 | proxy 层在每次页面请求时已通过 jwt callback 刷新并回写 cookie |
| 无竞态风险 | `decode()` 是只读操作，不写 cookie，不触发副作用 |
| cookie name / salt 匹配 | `getSessionCookieName()` 根据环境选择正确的 cookie name，与 NextAuth 内部一致 |

### §3.3 forum-api.ts 扩展

现有 `forum-api.ts` 是 `server-only`，所有方法只注入 `X-API-Key`（Key A）。需要扩展核心 `request()` 函数以支持可选的 `Authorization: Bearer` 头：

```typescript
// forum-api.ts 扩展

interface RequestOptions {
  method: string;
  path: string;
  body?: unknown;
  searchParams?: Record<string, string | number | boolean | undefined | null>;
  bearerToken?: string;  // 新增：可选的 Worker JWT
}

async function request<T>(opts: RequestOptions): Promise<...> {
  const headers: Record<string, string> = {
    "X-API-Key": getApiKey(),
  };

  // 注入 Bearer token（用于需认证的写操作）
  if (opts.bearerToken) {
    headers["Authorization"] = `Bearer ${opts.bearerToken}`;
  }

  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  // ...rest unchanged...
}

// 新增写操作方法
export const forumApi = {
  // ...existing get/getAll/getCursor/getPage/post methods...

  /** POST with auth: 需要 Worker JWT 的写操作 */
  async postAuth<T>(
    path: string,
    body: unknown,
    bearerToken: string,
  ): Promise<ApiResponse<T>> {
    const result = await request<T>({
      method: "POST",
      path,
      body,
      bearerToken,
    });
    return { data: result.data, meta: result.meta as ApiMeta };
  },
};
```

### §3.4 Server Action 调用示例

注册和发帖都通过 Server Action 代理，所有 Worker 调用在服务端完成：

```typescript
// actions/auth.ts
"use server";

import { forumApi, ForumApiError } from "@/lib/forum-api";

/** 注册新用户 — 不需要 JWT，但需要 Key A（由 forumApi 注入） */
export async function registerUser(username: string, password: string, email?: string) {
  try {
    // forumApi.post 已注入 Key A，注册端点不需要 Bearer token
    return await forumApi.post("/api/v1/auth/register", { username, password, email });
  } catch (error) {
    if (error instanceof ForumApiError) {
      return { error: error.code };
    }
    return { error: "INTERNAL_ERROR" };
  }
}

// actions/thread.ts
"use server";

import { getWorkerJwt } from "@/lib/forum-auth";
import { forumApi, ForumApiError } from "@/lib/forum-api";

/** 发新帖 — 需要 Worker JWT */
export async function createThread(forumId: number, subject: string, content: string) {
  // getWorkerJwt() 内部调用 decode() 解密 cookie → 拿到 workerJwt
  // refresh 已由 proxy 层在页面请求时完成（见 §3.2）
  const jwt = await getWorkerJwt();
  if (!jwt) return { error: "NOT_AUTHENTICATED" };

  try {
    return await forumApi.postAuth("/api/v1/threads", { forumId, subject, content }, jwt);
  } catch (error) {
    if (error instanceof ForumApiError) {
      return { error: error.code };
    }
    return { error: "INTERNAL_ERROR" };
  }
}
```

### §3.5 用户名可用性检查的前端调用方式

注册页面需要实时调用 `check-username`。由于这是高频 debounce 请求，用 Server Action 会有不必要的延迟。

**方案**：创建 Next.js API Route 作为代理，服务端注入 Key A：

```typescript
// app/api/auth/check-username/route.ts
import { forumApi } from "@/lib/forum-api";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const username = url.searchParams.get("username");
  if (!username) {
    return NextResponse.json({ available: false, reason: "invalid" });
  }

  try {
    const result = await forumApi.get<{ available: boolean; reason?: string }>(
      "/api/v1/auth/check-username",
      { username },
    );
    return NextResponse.json(result.data);
  } catch {
    return NextResponse.json({ available: false, reason: "error" }, { status: 500 });
  }
}
```

前端调用 `/api/auth/check-username?username=xxx`，Key A 始终在服务端。

---

## §4 注册页面

### §4.1 路由

```
/register — 新用户注册
```

### §4.2 页面结构

```
┌─────────────────────────────────────────────┐
│                    [🌙]                      │
│                                              │
│              (E)  Ellie                       │
│              注册新账号                        │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │              注册                       │  │
│  │                                        │  │
│  │  ⚠️ 错误提示区域                        │  │
│  │                                        │  │
│  │  用户名 *                               │  │
│  │  ┌──────────────────────────────────┐  │  │
│  │  │  请输入用户名（2-15位）            │  │  │
│  │  └──────────────────────────────────┘  │  │
│  │  ✓ 可用 / ✗ 已被注册                   │  │
│  │                                        │  │
│  │  密码 *                                │  │
│  │  ┌──────────────────────────────────┐  │  │
│  │  │  请输入密码（≥6位）               │  │  │
│  │  └──────────────────────────────────┘  │  │
│  │  ■■■□□ 密码强度: 中                    │  │
│  │                                        │  │
│  │  确认密码 *                             │  │
│  │  ┌──────────────────────────────────┐  │  │
│  │  │  请再次输入密码                    │  │  │
│  │  └──────────────────────────────────┘  │  │
│  │                                        │  │
│  │  邮箱（选填）                           │  │
│  │  ┌──────────────────────────────────┐  │  │
│  │  │  用于找回密码                     │  │  │
│  │  └──────────────────────────────────┘  │  │
│  │                                        │  │
│  │  [          注册          ]             │  │
│  └────────────────────────────────────────┘  │
│                                              │
│     已有账号？登录                             │
│                                              │
└─────────────────────────────────────────────┘
```

### §4.3 交互规格

| 交互 | 说明 |
|------|------|
| 用户名实时校验 | 输入停止 500ms 后 debounce 调用 `GET /api/auth/check-username?username=xxx`（Next.js 代理路由，§3.5），返回可用/已占用 |
| 密码强度指示器 | 纯前端计算：<6 无效，6–7 弱，8–11 中，≥12 或含大小写+数字+符号为强 |
| 确认密码匹配 | 实时比对，不匹配时显示红色提示 |
| 提交 | Server Action `registerUser()` → 成功后调用 `signIn("credentials")` 自动登录 → redirect 到首页或 `?redirect=` 指定页 |
| 已登录用户 | 访问 `/register` 时 redirect 到首页 |

### §4.4 ViewModel

```typescript
// viewmodels/forum/register.ts
interface RegisterFormState {
  username: string;
  password: string;
  confirmPassword: string;
  email: string;
}

function canSubmitRegister(state: RegisterFormState): boolean;
function passwordStrength(password: string): "none" | "weak" | "medium" | "strong";
function validateUsername(username: string): string | null;  // 返回错误消息或 null
function registerErrorMessage(errorCode: string | null): string | null;
```

---

## §5 登录页面增强

### §5.1 现状

登录页面 UI 已完整（`/login`），但调用 `signIn("credentials", ...)` 由于 Credentials Provider 缺失而无法工作。

### §5.2 变更

完成 §2 后，现有登录页面的 `signIn("credentials", ...)` 调用即可正常工作。需要以下增强：

| 变更 | 说明 |
|------|------|
| 注册入口 | 将底部 "没有账号？联系管理员" 改为 "没有账号？[注册](/register)" 链接 |
| banned 用户提示优化 | 拦截 `AccessDenied` 错误时展示 "账号已被禁用，请联系管理员" |

### §5.3 RefreshTokenExpired 处理

当 Worker refresh token 过期（用户超过 30 天未访问），JWT callback 会设置 `token.error = "RefreshTokenExpired"`，这个值通过 session callback 传入 `session.error`。

**处理链路：**

```
JWT callback
  → refresh 失败
  → token.error = "RefreshTokenExpired"
  → session callback
  → session.error = "RefreshTokenExpired"
  → 客户端 useSession() 可读取 session.error
```

**前端检测组件**（全局挂载在 forum layout 中）：

```typescript
// components/forum/session-guard.tsx
"use client";

import { signOut, useSession } from "next-auth/react";
import { useEffect } from "react";

export function SessionGuard() {
  const { data: session } = useSession();

  useEffect(() => {
    if (session?.error === "RefreshTokenExpired") {
      // 服务端已无法刷新 JWT → 强制登出，清除无效 session cookie
      signOut({ callbackUrl: "/login" });
    }
  }, [session?.error]);

  return null;
}
```

**为什么不在服务端直接清 session？** NextAuth v5 的 JWT callback 不能主动销毁 session — 它只能修改 token 内容。销毁 session 需要清除 cookie，这在 callback 内无法安全操作。通过 `session.error` 传递到客户端，由 `signOut()` 执行完整的登出流程（清 cookie + redirect），是 NextAuth 推荐的模式。

---

## §6 用户名可用性检查端点

### §6.1 Worker 端点

```
GET /api/v1/auth/check-username?username=xxx
Headers: X-API-Key: <Key A>
```

> **调用方**：Next.js API Route 代理（§3.5），不由浏览器直接调用。

### §6.2 响应

```json
// 可用
{ "data": { "available": true }, "meta": {...} }

// 不可用
{ "data": { "available": false, "reason": "taken" | "invalid" | "banned" }, "meta": {...} }
```

### §6.3 验证逻辑

1. 格式校验（2–15 字符，允许中文/英文/数字/下划线）
2. 敏感词检查
3. `SELECT 1 FROM users WHERE username = ?` 唯一性检查

### §6.4 频率限制

Worker 端：同一 IP 每分钟最多 30 次（KV 计数）。
Next.js 代理端：可按需加更严格的限制。

---

## §7 Session 生命周期

### §7.1 登录

```
用户提交 (username, password)
  → signIn("credentials", { username, password, redirect: false })
  → NextAuth Credentials Provider
    → fetch Worker POST /api/v1/auth/login (服务端，Key A 由 auth.ts 注入)
    → Worker 验证密码，返回 { token, refreshToken, user }
  → NextAuth JWT callback
    → 存储 workerJwt, workerRefreshToken, workerJwtExp, role 到 NextAuth JWT
  → NextAuth Session callback
    → 暴露 id, name, provider, role 到客户端 session（workerJwt 不暴露）
  → 前端 router.push(callbackUrl)
```

### §7.2 会话保持

```
每次页面请求（proxy 层，middleware wrapper 模式）:
  → NextAuth auth() 在 handleAuth() 中调用 getSession()
  → 触发 jwt callback
  → 检查 workerJwtExp
    → 未过期: 正常放行
    → 即将过期（<5min buffer）: 调用 Worker refresh 端点（服务端，Key A 注入）
      → 成功: 更新 workerJwt + workerRefreshToken + workerJwtExp
      → 失败: 设置 token.error = "RefreshTokenExpired"
  → Auth() 返回 Response（含 Set-Cookie）
  → handleAuth() 复制 Set-Cookie 到 finalResponse → 浏览器写入刷新后的 cookie ✅
  → Session callback
    → 如果 token.error → session.error = "RefreshTokenExpired"
  → 客户端 SessionGuard 组件检测 session.error
    → 有错误 → signOut() 强制登出，redirect 到 /login

Server Action 中获取 workerJwt:
  → decode(cookie) 直接解密 NextAuth cookie（不触发 callback）
  → 读取 proxy 层已刷新的 workerJwt
  → 调用 Worker API
```

### §7.3 登出

```
用户点击退出 / SessionGuard 触发:
  → signOut({ callbackUrl: "/login" }) from next-auth/react
  → NextAuth 清除 session cookie（httpOnly）
  → redirect 到目标页

Worker 端 refresh token 的清理:
  → 不主动调用 Worker logout 端点
  → refresh token 有 30 天 TTL，自然过期
  → 理由：signOut 是客户端操作，此时没有可靠的方式在服务端拿到
    workerRefreshToken 并调用 Worker（NextAuth signOut 不触发服务端回调）
```

### §7.4 Token 时间线

```
Day 0: 登录
  ├─ Worker JWT: 有效 7 天 (Day 0 → Day 7)
  ├─ Refresh Token: 有效 30 天 (Day 0 → Day 30)
  └─ NextAuth session cookie: maxAge 30 天

Day 6+: JWT 即将过期（<5min buffer），用户发起 SSR 请求
  → NextAuth JWT callback 自动 refresh
  ├─ 新 Worker JWT: Day 6+ → Day 13+
  └─ 新 Refresh Token: Day 6+ → Day 36+ (rotation)

Day 30+: 如果用户超过 30 天未访问
  → NextAuth session cookie 过期 → 需重新登录
  → 或 Refresh Token 先过期 → refresh 失败 → session.error → signOut

NextAuth session maxAge 设为 30 天（与 refresh token TTL 对齐）
```

---

## §8 路由保护更新

### §8.1 proxy.ts 变更

**变更 1**：新增 `/register` 为公开路由：

```typescript
export function isPublicRoute(pathname: string): boolean {
  // ...existing checks...
  if (pathname === "/register") return true;  // 新增
  // ...
}
```

**变更 2**：论坛受保护路由需要区分 provider 类型。

当前 `isForumAuthRoute` 仅检查 `isLoggedIn`（是否有任意 session），这意味着 Google OAuth 登录的 admin 用户也能通过 `/threads/new` 的保护检查，但他们没有 Worker JWT，无法实际发帖。

修改 `resolveProxyAction` 中 forum auth 路由的判定逻辑：

```typescript
export function resolveProxyAction(
  pathname: string,
  isLoggedIn: boolean,
  email?: string | null,
  provider?: string | null,  // 新增参数
): "next" | "redirect:/admin" | "redirect:/login" | "redirect:/admin/login" {
  // ...

  // Forum auth routes: 要求 credentials session（论坛用户），不接受 Google OAuth session
  if (isForumAuthRoute(pathname)) {
    if (!isLoggedIn) return "redirect:/login";
    if (provider !== "credentials") return "redirect:/login"; // Google 用户无法发帖
    return "next";
  }

  // ...
}
```

`proxy` 函数中传入 provider：

```typescript
export async function proxy(request: NextRequest) {
  const authHandler = await auth((req) => {
    const action = resolveProxyAction(
      req.nextUrl.pathname,
      !!req.auth,
      req.auth?.user?.email,
      (req.auth?.user as any)?.provider,  // NextAuth session 中的 provider 字段
    );
    // ...
  });
  // ...
}
```

### §8.2 已登录用户处理

`/register` 和 `/login` 页面在已登录状态下 redirect 到首页（在页面组件层处理，非 proxy 层）。

---

## 实施计划

### Phase 1 — 登录打通

| 步骤 | 内容 | 预估 |
|------|------|------|
| 1.1 | NextAuth Credentials Provider + signIn/JWT/Session callback 扩展（§2） | 中 |
| 1.2 | 类型声明 `next-auth.d.ts`（§2.4） | 小 |
| 1.3 | `decode()` 方式获取 Worker JWT 工具函数（§3.2） | 小 |
| 1.4 | `forum-api.ts` 扩展 `postAuth` 方法（§3.3） | 小 |
| 1.5 | `SessionGuard` 组件 + forum layout 挂载（§5.3） | 小 |
| 1.6 | 登录页底部注册链接（§5.2） | 小 |
| 1.7 | proxy.ts provider 判定修复（§8.1 变更 2） | 小 |
| 1.8 | 端到端验证：登录 → session → 发帖调用 | 测试 |

### Phase 2 — 注册

| 步骤 | 内容 | 预估 |
|------|------|------|
| 2.1 | Worker `POST /api/v1/auth/register` 端点 + UNIQUE 约束兜底（§1） | 中 |
| 2.2 | Worker `GET /api/v1/auth/check-username` 端点（§6） | 小 |
| 2.3 | Next.js API Route 代理 `/api/auth/check-username`（§3.5） | 小 |
| 2.4 | 注册 ViewModel（§4.4） | 小 |
| 2.5 | 注册页面 `/register`（§4） | 中 |
| 2.6 | proxy.ts 新增 `/register` 公开路由（§8.1 变更 1） | 小 |
| 2.7 | IP 频率限制（§1.7） | 小 |

### Phase 3 — 健壮性

| 步骤 | 内容 | 预估 |
|------|------|------|
| 3.1 | Worker JWT 自动刷新完整测试（§2.2 refresh 逻辑） | 中 |
| 3.2 | 长时间未访问 → refresh 失败 → 自动登出 E2E 测试 | 测试 |

---

## 文件变更清单

### 新建文件

| 文件 | 用途 |
|------|------|
| `apps/web/src/types/next-auth.d.ts` | NextAuth 类型扩展 |
| `apps/web/src/lib/forum-auth.ts` | Server-only：getWorkerJwt() + getCurrentForumUser()（基于 decode()） |
| `apps/web/src/components/forum/session-guard.tsx` | 客户端 RefreshTokenExpired 检测 + 自动登出 |
| `apps/web/src/app/api/auth/check-username/route.ts` | 用户名检查代理路由 |
| `apps/web/src/app/(forum)/register/page.tsx` | 注册页面 |
| `apps/web/src/viewmodels/forum/register.ts` | 注册表单 ViewModel |
| `apps/web/src/actions/auth.ts` | Server Action: registerUser() |

### 修改文件

| 文件 | 变更 |
|------|------|
| `apps/web/src/auth.ts` | 添加 Credentials Provider，扩展 JWT/Session/signIn callback，双 provider 分流 |
| `apps/web/src/lib/forum-api.ts` | 核心 `request()` 支持 `bearerToken` 参数，新增 `postAuth()` 方法 |
| `apps/web/src/proxy.ts` | `/register` 公开路由 + forum auth 路由 provider 判定 |
| `apps/web/src/app/(forum)/login/page.tsx` | 底部 "联系管理员" → "注册" 链接 |
| `apps/web/src/app/(forum)/layout.tsx` | 挂载 `<SessionGuard />` |
| `apps/worker/src/handlers/auth.ts` | 新增 `register` + `checkUsername` handler |
| `apps/worker/src/index.ts` | 注册新路由：`POST register`、`GET check-username` |

### 不变的文件

| 文件 | 理由 |
|------|------|
| `apps/worker/src/handlers/auth.ts` (login/refresh/logout/me) | 已有逻辑完整，不需修改 |
| `apps/worker/src/lib/password.ts` | 注册复用 `hashPassword()`，无需改动 |
| `apps/worker/src/lib/jwt.ts` | 注册复用 `createJwt()`，无需改动 |
| `apps/worker/src/middleware/auth.ts` | 认证中间件不变 |
| `apps/web/src/viewmodels/forum/auth.ts` | 登录验证逻辑不变 |

---

## 安全备注

| 关注点 | 处理方式 |
|--------|----------|
| Key A 不暴露给浏览器 | 所有 Worker 调用走 Server Action 或 Next.js API Route 代理 |
| Worker JWT 不暴露给浏览器 | 存在 NextAuth JWT（httpOnly JWE cookie），session callback 不输出，服务端通过 `decode(cookie)` 获取 |
| 密码存储 | PBKDF2-SHA256，100k iterations，16 bytes salt |
| 注册并发安全 | SELECT 预检 + INSERT UNIQUE 约束双重保障 |
| 注册滥用 | IP 频率限制（3 次/小时）+ 用户名敏感词过滤 |
| CSRF | NextAuth 内置 CSRF token 保护 |
| Timing attack | 密码验证使用 constant-time 比较 |
| Session 劫持 | NextAuth JWT 签名 + httpOnly cookie |
| Refresh token 泄露 | Token rotation — 每次 refresh 后旧 token 失效 |
| Google OAuth 用户误入论坛路由 | proxy.ts 检查 provider 类型，Google session 不能通过论坛 auth 路由 |

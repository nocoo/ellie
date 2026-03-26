# 04e — 高级功能

> 特殊帖子类型、富文本编辑器、表情系统、全文搜索和站内私信的设计方案。这些功能按优先级分批实施，部分后置到 Phase 4。
>
> **前置依赖**：04a（类型定义）、04d（帖子系统）

## 功能优先级总览

| 功能 | 优先级 | 当前阶段实现方式 | 完整实现依赖 |
|------|--------|-----------------|-------------|
| 特殊帖子类型标签展示 | P0 | 只读标签 + 数据展示 | — |
| 投票帖交互 | P1 | Mock 投票数据展示 | Phase 2 poll 表 |
| 富文本编辑器 | P0 | Tiptap v2 基础功能 | — |
| Emoji（新帖） | P0 | emoji-mart Unicode 输入 | — |
| Smiley 渲染（旧帖） | P0 | 表情代码 → `<img>` 映射 | — |
| 悬赏帖交互 | P2 | 只读展示 | Phase 2 bounty 表 |
| 交易帖交互 | P2 | 只读展示 | Phase 2 trade 表 |
| 活动帖交互 | P2 | 只读展示 | Phase 2 activity 表 |
| 辩论帖交互 | P2 | 只读展示 | Phase 2 debate 表 |
| 全文搜索 | 后置 | 标题前缀匹配（04d） | Phase 4 Workers AI + Vectorize |
| 站内私信 | 后置 | 不实现 | Phase 2 messages 表 |

---

## 特殊帖子类型

### 概述

DZ 通过 `threads.special` 字段标记 6 种帖子类型（04a §Thread）。由于交互数据表（poll/trade/bounty/activity/debate）不在当前迁移范围内（Doc02 只迁移了 5 张核心表），**当前阶段仅做标签展示和数据预览**，不实现完整交互。

### 标签展示（P0 — 当前阶段）

所有特殊类型帖子在列表和详情页中通过 `ThreadBadge` 组件展示类型标签：

```typescript
// models/thread.ts（扩展 04d 的 getThreadBadges）
const SPECIAL_BADGES: Record<number, { label: string; variant: string }> = {
  1: { label: "投票", variant: "default" },
  2: { label: "交易", variant: "warning" },
  3: { label: "悬赏", variant: "warning" },
  4: { label: "活动", variant: "default" },
  5: { label: "辩论", variant: "default" },
};

// 在 getThreadBadges() 中：
if (thread.special > 0 && SPECIAL_BADGES[thread.special]) {
  const badge = SPECIAL_BADGES[thread.special];
  badges.push({ type: "special", label: badge.label, variant: badge.variant });
}
```

### 投票帖（special=1）— P1 Mock 展示

投票帖是最常见的特殊类型。当前用 Mock 数据展示投票 UI，未来接入真实 poll 表。

**展示位置**：帖子详情页，主帖内容上方或下方。

```
┌─ 投票 ───────────────────────────────────────────────────┐
│  📊 食堂最佳窗口评选                                       │
│                                                           │
│  ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░ 一食堂 3 楼    62% (156 票)        │
│  ▓▓▓▓▓▓░░░░░░░░░░░░ 二食堂 2 楼    28% (70 票)         │
│  ▓▓░░░░░░░░░░░░░░░░ 学苑食堂       10% (25 票)         │
│                                                           │
│  共 251 人参与投票 · 可选 1 项 · 截止: 2024-10-01         │
│                                      [投票] (需登录)      │
└──────────────────────────────────────────────────────────┘
```

**组件：**

```typescript
// components/forum/VotePoll.tsx
interface VotePollProps {
  poll: PollData;
  hasVoted: boolean;
  onVote: (optionIds: number[]) => void;
}
```

**Mock 数据（data/mock/polls.ts）：**

```typescript
export const mockPolls: Record<number, PollData> = {
  // threadId → PollData
  1001: {
    question: "食堂最佳窗口评选",
    options: [
      { id: 1, text: "一食堂 3 楼", votes: 156, percentage: 62 },
      { id: 2, text: "二食堂 2 楼", votes: 70, percentage: 28 },
      { id: 3, text: "学苑食堂", votes: 25, percentage: 10 },
    ],
    maxChoices: 1,
    expiresAt: 1727740800,
    voterCount: 251,
  },
};
```

### 悬赏帖（special=3）— P2 只读展示

```
┌─ 悬赏 ───────────────────────────────────────────────────┐
│  🏆 悬赏 50 积分                                          │
│  状态: 进行中 / 已采纳 / 已过期                             │
│  [如已采纳] 最佳答案: #12 楼 by user123                    │
└──────────────────────────────────────────────────────────┘
```

### 交易帖（special=2）— P2 只读展示

```
┌─ 交易 ───────────────────────────────────────────────────┐
│  💰 出售: 高等数学教材（第七版）                             │
│  价格: ¥25 · 状态: 在售 / 已售出 / 已过期                  │
│  联系方式: [登录后可见]                                     │
└──────────────────────────────────────────────────────────┘
```

### 活动帖（special=4）— P2 只读展示

```
┌─ 活动 ───────────────────────────────────────────────────┐
│  📅 2024 同济校庆跑步活动                                   │
│  时间: 2024-05-20 09:00 ~ 12:00                           │
│  地点: 四平路校区大操场                                     │
│  人数: 45/100 人                                           │
│  状态: 报名中 / 进行中 / 已结束                             │
└──────────────────────────────────────────────────────────┘
```

### 辩论帖（special=5）— P2 只读展示

```
┌─ 辩论 ───────────────────────────────────────────────────┐
│  ⚖️ 辩题: 大学是否应该强制早操？                            │
│                                                           │
│  👍 支持 (65%)  ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░  👎 反对 (35%)      │
│  123 人              67 人                                │
└──────────────────────────────────────────────────────────┘
```

### 特殊类型数据扩展接口

为未来 Phase 2 接入真实数据预留：

```typescript
// data/repositories/types.ts（扩展）
export interface SpecialDataRepository {
  getPollByThreadId(threadId: number): Promise<PollData | null>;
  getBountyByThreadId(threadId: number): Promise<BountyData | null>;
  getTradeByThreadId(threadId: number): Promise<TradeData | null>;
  getActivityByThreadId(threadId: number): Promise<ActivityData | null>;
  getDebateByThreadId(threadId: number): Promise<DebateData | null>;
}
```

当前 Mock 实现直接从 `data/mock/` 中的硬编码数据返回。

---

## 富文本编辑器

### 技术选型：Tiptap v2

| 选项 | 优势 | 劣势 | 结论 |
|------|------|------|------|
| Tiptap v2 | ProseMirror 底层、可扩展、TypeScript 支持好 | 略重 | ✅ 选用 |
| TinyMCE | 功能全 | 许可证、体积大 | ❌ |
| 原生 textarea | 最轻量 | 无格式支持 | ❌ |

### 编辑器功能

**基础功能（P0）：**

| 功能 | Tiptap 扩展 | 说明 |
|------|-------------|------|
| 粗体/斜体/下划线 | StarterKit | 基础格式 |
| 标题 (H2-H4) | StarterKit | 不提供 H1（页面标题占用） |
| 无序/有序列表 | StarterKit | |
| 引用 | StarterKit | blockquote |
| 代码块 | StarterKit | 语法高亮（后置） |
| 链接 | @tiptap/extension-link | 自动检测 URL |
| 表情 | 自定义扩展 | 集成 emoji-mart |
| Placeholder | @tiptap/extension-placeholder | "输入内容..." |

**增强功能（P1）：**

| 功能 | 说明 |
|------|------|
| 图片上传 | 拖拽/粘贴上传到 R2（当前 Mock：生成占位图） |
| @提及 | 输入 @ 弹出用户选择器（后置到 Phase 2） |
| 字数统计 | @tiptap/extension-character-count |

### 编辑器工具栏

```
┌──────────────────────────────────────────────────────────┐
│  B  I  U  │  H2  H3  │  UL  OL  │  ""  </>  │  🔗  😀 │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  编辑区域...                                              │
│                                                          │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  字数: 128 / 50000                              [发布]   │
└──────────────────────────────────────────────────────────┘
```

### 编辑器组件

```typescript
// components/forum/PostEditor.tsx
interface PostEditorProps {
  initialContent?: string;
  onSubmit: (html: string) => void;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
}

// 内部使用 Tiptap:
const editor = useEditor({
  extensions: [
    StarterKit,
    Link.configure({ openOnClick: false }),
    Placeholder.configure({ placeholder: props.placeholder }),
    CharacterCount.configure({ limit: props.maxLength ?? 50000 }),
    // Emoji 自定义扩展
  ],
  content: props.initialContent ?? "",
});
```

### 输出格式

编辑器输出 **sanitized HTML**，与 04a §内容格式规约完全一致：

```
用户输入 → Tiptap 编辑器 → editor.getHTML() → sanitize() → POST to API
```

Sanitize 规则复用 04a §Sanitize 规则（以 `bbcode.ts` 现有实现为 source of truth）：
- URL 协议白名单：`http:`, `https:`, `ftp:`, `mailto:` + 相对路径
- 标签白名单：`p, br, strong, em, u, s, h2, h3, h4, ul, ol, li, blockquote, pre, code, a, img, span, div, hr, attachment`
- 禁止 `<script>`, `<style>`, `on*` 属性, `<iframe>/<embed>/<object>` 等
- CSS 值白名单：`color`（hex/命名/rgb）、`font-size`、`text-align`

---

## 表情系统

### 双轨方案

| 场景 | 方案 | 说明 |
|------|------|------|
| **新帖编辑** | emoji-mart → Unicode Emoji | 现代标准，跨平台一致 |
| **旧帖渲染** | Smiley 映射 → `<img>` 标签 | 兼容 DZ 历史数据 |

### 新帖 Emoji（emoji-mart）

在编辑器工具栏集成 Emoji picker：

```typescript
// components/forum/EmojiPicker.tsx
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
}

export function EmojiPicker({ onSelect }: EmojiPickerProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon">😀</Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Picker
          data={data}
          onEmojiSelect={(emoji: { native: string }) => onSelect(emoji.native)}
          locale="zh"
          theme="auto"
        />
      </PopoverContent>
    </Popover>
  );
}
```

选中的 Emoji 以 Unicode 字符插入编辑器，存储为 HTML 文本节点，渲染时由浏览器/OS 原生显示。

### 旧帖 Smiley 渲染

迁移阶段（Doc03）已将 DZ BBCode 表情代码转为 `<img>` 标签：

```html
<!-- 迁移后的 HTML -->
<img src="/smileys/default/smile.gif" alt=":)" class="smiley" />
```

Smiley 图片存放在 `public/smileys/` 目录，按 DZ 原始目录结构组织：

```
public/smileys/
├── default/           # 默认表情包
│   ├── smile.gif
│   ├── biggrin.gif
│   ├── cry.gif
│   └── ...
├── coolmonkey/        # 酷猴表情包
└── ...
```

> **运行时不做 Smiley 代码解析。** 所有 BBCode 表情代码在迁移阶段一次性转为 `<img>` 标签。渲染时 `dangerouslySetInnerHTML` 直接展示。

### Smiley 映射表（仅供参考/调试）

```typescript
// lib/smiley-map.ts — 仅用于调试和测试，运行时不使用
export const SMILEY_MAP: Record<string, string> = {
  ":)": "/smileys/default/smile.gif",
  ":(": "/smileys/default/sad.gif",
  ":D": "/smileys/default/biggrin.gif",
  "{:soso_e113:}": "/smileys/soso/e113.gif",
  // ... 完整映射表基于 DZ 的 data/cache/cache_smiley.php
};
```

---

## 全文搜索（后置到 Phase 4）

### 当前方案（MVP）

参见 04d §搜索 — 仅支持标题前缀匹配和作者精确匹配，受 D1 限制。

### Phase 4 目标方案

```
用户搜索查询
    │
    ▼
Workers AI (Embedding Model)
    │  将查询文本转为向量
    ▼
Vectorize (向量索引)
    │  ANN 搜索最相似的帖子向量
    ▼
D1 (获取完整帖子数据)
    │
    ▼
返回搜索结果
```

**关键组件：**

| 组件 | 用途 |
|------|------|
| Workers AI | 文本向量化（Embedding） |
| Vectorize | 向量存储和 ANN 搜索 |
| D1 | 元数据存储和精确查询 |

**索引策略：**
- 对 threads.subject + posts.content（首帖）建立向量索引
- 写入时异步更新向量（不阻塞发帖流程）
- 搜索时先向量召回 Top-K，再 D1 回查详情

**前端搜索接口预留：**

```typescript
// 04d 中的 SearchViewModel 已通过 ThreadRepository.search() 调用
// Phase 4 只需扩展 search() 的后端实现（从 D1 LIKE 切换为向量搜索）
// 前端 ViewModel 和 ThreadSearchParams 接口不变
```

> **为什么不用 D1 FTS5？** SQLite FTS5 不支持中文分词。即使加上 ICU tokenizer，D1 托管环境不支持自定义 tokenizer 加载。Workers AI embedding 天然支持多语言。

---

## 站内私信（后置）

### 当前状态

Doc02 未定义 messages 表，当前 D1 schema 不包含私信数据。**本阶段不实现站内私信。**

### Phase 2 预设方案

当 messages 表就绪后的设计方向：

**数据模型（预留 — 不在 04a 正式 contract 中，Phase 2 落地时迁入）：**

```typescript
// Phase 2 新增到 models/types.ts
export interface Message {
  id: number;
  fromUserId: number;
  toUserId: number;
  subject: string;
  content: string;
  createdAt: number;
  readAt: number | null;   // null = 未读
}
```

**D1 Schema（Phase 2 新增）：**

```sql
CREATE TABLE messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user   INTEGER NOT NULL REFERENCES users(id),
  to_user     INTEGER NOT NULL REFERENCES users(id),
  subject     TEXT    NOT NULL DEFAULT '',
  content     TEXT    NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL DEFAULT 0,
  read_at     INTEGER,       -- NULL = unread
);

CREATE INDEX idx_messages_to ON messages(to_user, created_at DESC);
CREATE INDEX idx_messages_from ON messages(from_user, created_at DESC);
```

**路由（预留）：**

```
src/app/(forum)/messages/
├── page.tsx              # /messages — 消息列表
└── [id]/page.tsx         # /messages/:id — 对话详情
```

**Repository 接口（预留）：**

```typescript
export interface MessageRepository {
  listInbox(params: PaginationParams): Promise<PaginatedResult<Message>>;
  listSent(params: PaginationParams): Promise<PaginatedResult<Message>>;
  getById(id: number): Promise<Message | null>;
  send(input: { toUserId: number; subject: string; content: string }): Promise<Message>;
  markRead(id: number): Promise<void>;
  unreadCount(): Promise<number>;
}
```

**UI 预览：**

```
┌─ 消息列表 ───────────────────────────────────────────────┐
│  Tab: [收件箱 (3)] [已发送]                                │
│                                                           │
│  ● [avatar] user123                    3h ago             │
│    关于校庆活动的问题                                       │
│    你好，请问活动报名还开放吗？                              │
│                                                           │
│  ○ [avatar] admin                      1d ago             │
│    回复: 版块申请                                          │
│    已批准，请查看...                                        │
└──────────────────────────────────────────────────────────┘
```

---

## 其他后置功能

### 用户注册

当前 MVP 不开放注册。未来需要：
- 注册表单（用户名 + 邮箱 + 密码）
- 邮箱验证（Cloudflare Email Workers）
- 验证码/人机验证（Turnstile）

### 通知系统

当前不实现。未来需要：
- 帖子被回复通知
- @提及通知
- 系统公告
- 通知中心 UI

### 用户设置

当前不实现。未来需要：
- 修改密码
- 修改头像（上传到 R2）
- 修改个人签名
- 通知偏好设置

---

## 实施建议

### 当前阶段工作范围

| 组件 | 要做 | 不做 |
|------|------|------|
| 特殊帖子标签 | ✅ ThreadBadge 展示标签 | ❌ 交互功能 |
| 投票帖 | ✅ VotePoll Mock UI | ❌ 真实投票 API |
| 富文本编辑器 | ✅ Tiptap 基础功能 | ❌ 图片上传到 R2 |
| Emoji | ✅ emoji-mart picker | ❌ 自定义表情包管理 |
| Smiley | ✅ `<img>` 标签渲染 | ❌ 运行时 BBCode 解析 |
| 搜索 | ✅ 标题前缀 + 作者精确 | ❌ 全文搜索 |
| 私信 | ❌ 不实现 | — |
| 注册 | ❌ 不实现 | — |
| 通知 | ❌ 不实现 | — |

### 依赖关系

```
04a (类型定义)
  │
  ├──→ 特殊帖子标签（纯 Model 函数）
  │
  └──→ 04d (帖子系统)
        │
        ├──→ VotePoll 组件（嵌入帖子详情页）
        ├──→ PostEditor 组件（Tiptap）
        ├──→ EmojiPicker 组件（集成到 PostEditor）
        └──→ SearchBar 组件（集成到 ForumNavbar）
```

# 数据迁移

## Magic Number 字段映射 (Discuz X3.4 → Ellie)

本节列出所有从 Discuz 迁移而来的 magic number 字段及其含义。这些值源自 Discuz X3.4 源码分析，在 `packages/types/src/types.ts` 中有对应的 TypeScript 枚举定义。

### forums.status

| DZ 值 | Ellie 枚举 | 含义 |
|-------|-----------|------|
| -1 | `ForumStatus.Placeholder` | 占位记录（FK 完整性，原版块已删除）|
| 0 | `ForumStatus.Hidden` | 隐藏/关闭（不显示在版块列表）|
| 1 | `ForumStatus.Normal` | 正常（活跃版块）|
| 2 | `ForumStatus.Paused` | 暂停（临时关闭发帖）|
| 3 | `ForumStatus.QQGroup` | QQ群组（特殊类型，用于QQ群集成）|

### forums.type

| DZ 值 | Ellie 枚举 | 含义 |
|-------|-----------|------|
| "group" | `ForumType.Group` | 分类/组头 |
| "forum" | `ForumType.Forum` | 普通版块 |
| "sub" | `ForumType.Sub` | 子版块 |

### threads.sticky (DZ: displayorder)

| DZ 值 | Ellie 枚举 | 含义 |
|-------|-----------|------|
| -99 | `StickyLevel.Placeholder` | 占位记录（FK 完整性，原主题已删除）|
| -4 | `StickyLevel.Draft` | 草稿（已保存但未发布）|
| -3 | `StickyLevel.Ignored` | 忽略/隐藏（被版主手动隐藏）|
| -2 | `StickyLevel.Moderating` | 待审核 |
| -1 | `StickyLevel.RecycleBin` | 回收站 |
| 0 | `StickyLevel.None` | 普通（无置顶）|
| 1 | `StickyLevel.Forum` | 版块置顶 |
| 2 | `StickyLevel.Global` | 全站置顶 |
| 3 | `StickyLevel.Category` | 分类置顶 |

### threads.closed

| DZ 值 | Ellie 枚举 | 含义 |
|-------|-----------|------|
| 0 | `ThreadClosedState.Open` | 开放回复 |
| 1 | `ThreadClosedState.Closed` | 已锁定 |
| >1 | - | 已合并到 tid=closed 值的主题 |

### threads.digest (精华级别)

| DZ 值 | Ellie 枚举 | 含义 |
|-------|-----------|------|
| 0 | `DigestLevel.None` | 非精华 |
| 1 | `DigestLevel.Level1` | 精华 ★ |
| 2 | `DigestLevel.Level2` | 精华 ★★ |
| 3 | `DigestLevel.Level3` | 精华 ★★★ |

### posts.invisible

| DZ 值 | Ellie 枚举 | 含义 |
|-------|-----------|------|
| -5 | `PostVisibility.DeletedByUser` | 用户自删（软删除）|
| -3 | `PostVisibility.Draft` | 草稿（已保存但未发布）|
| -2 | `PostVisibility.AwaitingReview` | 等待版主审核 |
| -1 | `PostVisibility.DeletedByMod` | 版主删除 |
| 0 | `PostVisibility.Visible` | 可见（正常帖子）|
| 1 | `PostVisibility.PendingReview` | 待审核（等待批准）|

### users.role (DZ: adminid)

| DZ 值 | Ellie 枚举 | 含义 |
|-------|-----------|------|
| -1 | - | 特殊/系统账户（DZ 扩展值，直接透传）|
| 0 | `UserRole.User` | 普通用户 |
| 1 | `UserRole.Admin` | 管理员（完整系统权限）|
| 2 | `UserRole.SuperMod` | 超级版主（全站版主权限）|
| 3 | `UserRole.Mod` | 版块版主 |
| 7 | - | 特殊管理员（DZ 扩展值，含义不明，直接透传）|

### users.status

| DZ 值 | Ellie 枚举 | 含义 |
|-------|-----------|------|
| -3 | `UserStatus.Placeholder` | 占位记录（FK 完整性，原用户已删除）|
| -2 | `UserStatus.Archived` | 归档（历史数据，不可登录）|
| -1 | `UserStatus.Banned` | 封禁（账户已禁用）|
| 0 | `UserStatus.Active` | 活跃（正常账户）|

### users.gender

| DZ 值 | Ellie 枚举 | 含义 |
|-------|-----------|------|
| 0 | `Gender.Unset` | 未设置/未知 |
| 1 | `Gender.Male` | 男 |
| 2 | `Gender.Female` | 女 |

---

## 核心原则

**完整保留数据，不丢弃任何内容。**

- 即使数据存在不一致（如帖子指向已删除的用户、被隐藏的版块包含帖子），也完整迁移
- 被删除/隐藏/合并等状态通过字段值透传到新系统，由应用层决定展示策略
- 对于 FK 断裂的情况（如帖子的 author_id 指向已删除的用户），使用**占位记录**（如"已删除用户"）保持引用完整性
- 迁移后再根据业务需求处理这些历史遗留数据

## 概述

从 tongji.nocoo.cloud 的 Discuz! X3.4 MySQL 数据库迁移到 Cloudflare D1。

- **数据源**：`reference/db/` 中的 MySQL dump 文件（`.sql.gz`）
- **目标**：本地 SQLite 文件 → Cloudflare D1
- **数据量**：~1170 万行原始数据，全量迁移

## 迁移流程

```
reference/db/*.sql.gz
        │
        ▼
    ┌─────────┐
    │ Extract │  解析 SQL dump，提取 INSERT 行数据
    └────┬────┘
         │
         ▼
    ┌───────────┐
    │ Transform │  BBCode→HTML, 编码转换, 密码映射, 头像路径
    └─────┬─────┘
          │
          ▼
    ┌──────┐
    │ Load │  批量写入本地 SQLite（D1 兼容格式）
    └──┬───┘
       │
       ▼
    ┌────────┐
    │ Verify │  行数校验, 外键关联, 编码抽检, 查询性能
    └────────┘
       │
       ▼
    wrangler d1 execute → 远程 D1
```

## 迁移顺序

按外键依赖排列：

| 顺序 | 表 | 行数 | 依赖 | 数据源文件 |
|------|---|------|------|-----------|
| 1 | forums | 213 | 无 | main_small.sql.gz |
| 2 | users | ~1.14M | 无 | ucenter.sql.gz + main_small.sql.gz |
| 3 | threads | ~790K | forums, users | thread.sql.gz |
| 4 | posts | ~9.4M | threads, users | post_main.sql.gz + post_shards.sql.gz |
| 5 | attachments | ~78K | posts, users | main_small.sql.gz |

## 各表迁移细节

### forums
- 源表：`pre_forum_forum` JOIN `pre_forum_forumfield`
- 过滤：无（全量迁移，`status` 原值透传：0=关闭, 1=正常, 3=群组）
- 转换：`lastpost` char(110) 解析为 `last_thread_id` / `last_post_at` / `last_poster`
  - 格式：`"tid\tsubject\ttimestamp\tposter"`，用 `\t` 分割

### users
- 源表：`uc_members` LEFT JOIN `pre_common_member` LEFT JOIN `pre_common_member_archive` LEFT JOIN `pre_common_member_count`
- 过滤：无（全量迁移 114 万用户）
- 转换：
  - `adminid` → `role`（0=user, 1=admin, 2=super-mod, 3=mod；实际数据还有 -1 和 7 等 DZ 扩展值，直接透传）
  - `avatarstatus` → `avatar` 路径计算（仅 avatarstatus=1 时计算）
  - 密码字段直接映射（hash + salt），不做转换
  - `status` 映射：活跃用户取 `pre_common_member.status`（0=正常，-1=封禁），`freeze=1` 也标记为 -1；归档用户统一标记 -2
- 策略：以 `uc_members` 为基准（114 万），分两步——先活跃用户（JOIN `pre_common_member`），再归档用户（JOIN `pre_common_member_archive` 且排除已导入的）
- 注意：`uc_members` 有 114 万记录，`pre_common_member` 7 万 + `pre_common_member_archive` 107 万
- ⚠️ 历史迁移遗留：该论坛经历过多次迁移（包括 Discuz! 版本升级）。`uc_members`（UCenter 用户表）是后期引入的，部分早期用户的扩展数据在历次迁移中丢失。实际 dump 中 `pre_common_member_archive` 和 `pre_common_member_count` 均为 0 条记录。导致：
  - 10.3 万发过帖的用户缺少 member 元数据（status/role/credits/reg_date 均为默认值）
  - 所有用户的 `threads`/`posts` 计数字段为 0
  - `threads`/`posts` 可在迁移后从帖子数据重新计算；其他字段需从线上数据库补充

### threads
- 源表：`pre_forum_thread`
- 过滤：无（全量迁移，`displayorder` 和 `closed` 状态透传）
- 转换：
  - `displayorder` → `sticky`（负值=隐藏，0=普通，正值=置顶）
  - `posttableid` → `post_table_id`
- 合并帖：`closed > 1` 表示该 thread 已合并到 tid=closed 的目标 thread。这些记录完整保留，应用层可按 `closed` 值做 redirect

### posts
- 源表：`pre_forum_post` + `pre_forum_post_1` ~ `pre_forum_post_4`（5 个表）
- 过滤：无（全量迁移，`invisible` 状态透传：0=可见, 1=审核中, -1/-5=已删除）
- 转换：
  - `message` → `content`：BBCode → HTML（检查 `bbcodeoff` 和 `htmlon` flag）
  - 编码检测和修复
- ⚠️ 这是最大的表（9.4M 行），需要流式处理

### attachments
- 源表：`pre_forum_attachment`（索引表）JOIN `pre_forum_attachment_N`（分片表）
- 分片查找：使用索引表的 `tableid` 字段，不假设 `tid % 10`
- 转换：
  - `isimage` 值域：0=否, 1=是
  - `downloads` 从索引表获取
  - `attachment` 路径 → R2 object key

## SQL Dump 解析器

mysqldump 的 extended INSERT 格式：
```sql
INSERT INTO `table` VALUES (1,'foo','bar'),(2,'baz','qux');
```

解析要点：
- 流式读取 gzip 文件（逐行或逐块）
- 只关心 `INSERT INTO \`目标表\`` 开头的行
- 处理 MySQL 转义：`\'`, `\\`, `\n`, `\r`, `\0`, `NULL`
- 处理字段内含 `),(` 的情况（字符串值中可能有括号和逗号）
- 支持多 VALUES tuple 的单行 INSERT

## BBCode 转换

### 转换规则

| BBCode | HTML |
|--------|------|
| `[b]text[/b]` | `<strong>text</strong>` |
| `[i]text[/i]` | `<em>text</em>` |
| `[u]text[/u]` | `<u>text</u>` |
| `[s]text[/s]` | `<s>text</s>` |
| `[url=href]text[/url]` | `<a href="href">text</a>` |
| `[img]src[/img]` | `<img src="src">` |
| `[quote]text[/quote]` | `<blockquote>text</blockquote>` |
| `[code]text[/code]` | `<pre><code>text</code></pre>` |
| `[color=red]text[/color]` | `<span style="color:red">text</span>` |
| `[size=4]text[/size]` | `<span style="font-size:...">text</span>` |
| `[align=center]text[/align]` | `<div style="text-align:center">text</div>` |
| `[hr]` | `<hr>` |
| `[attach]aid[/attach]` | `<attachment data-aid="aid"></attachment>` |
| `[list][*]item[/list]` | `<ul><li>item</ul>` |
| `[list=1][*]item[/list]` | `<ol><li>item</ol>` |

### 特殊处理
- `bbcodeoff = 1` 时：不做 BBCode 解析，内容视为纯文本（HTML 实体转义）
- `htmlon = 1` 时：保留原始 HTML，但 **过滤危险元素**（`<script>`、`<style>`、事件处理器、`<iframe>`/`<embed>`/`<object>` 等），再转换 BBCode 部分
- `[attach]aid[/attach]`：替换为 `<attachment data-aid="aid"></attachment>` 占位元素，运行时由前端解析为 R2 附件 URL
- 嵌套标签：支持合理深度的嵌套（如 `[b][color=red]text[/color][/b]`）

### 安全过滤
- **URL 协议白名单**：`[url]` 和 `[img]` 的 URL 仅允许 `http:`/`https:`/`ftp:`/`mailto:` 和相对路径，阻止 `javascript:`/`data:`/`vbscript:` 等危险协议
- **CSS 值验证**：`[color]` 仅接受 hex（`#abc`/`#FF0000`）、命名颜色、`rgb()` 格式；`[align]` 仅接受 `left`/`center`/`right`/`justify`。不合法的值剥离标签保留内容
- **htmlon 净化**：移除 `<script>`/`<style>` 块、`on*` 事件处理器属性、`javascript:` 协议、`<iframe>`/`<embed>`/`<object>`/`<applet>`/`<form>`/`<base>`/`<meta>`/`<link>` 标签
- **⚠️ 局限性**：`sanitizeHtml` 基于正则匹配，非完整 HTML 解析器。对畸形标签、实体编码协议（`&#106;avascript:`）、异常属性引号等边角 case 可能遗漏。迁移源为 Discuz 生成的已知模式 HTML，风险可控；运行时展示应使用专业 sanitizer（如 DOMPurify）

## 编码处理

Discuz X3.4 默认 UTF-8，但历史数据可能混入 GBK 编码：
- mysqldump 已声明 `SET NAMES utf8mb4`，大部分数据应该是正确的 UTF-8
- 验证策略：解析后检查是否包含 UTF-8 非法序列
- 修复策略：检测到非 UTF-8 时尝试按 GBK 解码再转 UTF-8

## 批量写入

- 使用 `bun:sqlite` 直接写本地 SQLite 文件（零依赖，Bun 内置）
- 每批 500 行，包裹在事务中（`BEGIN...COMMIT`）
- 先建表（DDL from 02-database-schema.md），再建索引（数据写入完成后）
- 进度输出：每 10,000 行报告一次

## 验证清单

| 检查项 | 方法 | 通过标准 |
|--------|------|---------|
| 行数一致 | 过滤后源数据 COUNT vs D1 COUNT | 精确匹配（对比的是应用过滤条件后的源数据，非原始表总数） |
| 外键完整 | posts.thread_id 全部在 threads.id 中 | 0 orphan |
| 外键完整 | posts.author_id 全部在 users.id 中 | 0 orphan |
| 外键完整 | threads.forum_id 全部在 forums.id 中 | 0 orphan |
| 外键完整 | attachments.post_id 全部在 posts.id 中 | 0 orphan |
| 编码正确 | 随机抽样 1000 条帖子，人工可读 | 0 乱码 |
| 查询性能 | 8 种查询模式（见 02-database-schema.md） | 索引命中 <10ms，整体 <50ms |
| 索引有效 | EXPLAIN QUERY PLAN 确认走索引 | 无 SCAN TABLE |

## 占位记录

基于"完整保留数据"原则，FK 断裂时使用占位记录而非跳过：

| 场景 | 占位策略 |
|------|---------|
| 帖子 `author_id` 不在 `users` 中 | 创建占位用户（username="[已删除用户{uid}]", status=-3）|
| 帖子 `thread_id` 不在 `threads` 中 | 创建占位主题（subject="[已删除主题{tid}]", sticky=-99）|
| 主题 `forum_id` 不在 `forums` 中 | 创建占位版块（name="[已删除版块{fid}]", status=-1）|
| 主题 `author_id` 不在 `users` 中 | 创建占位用户（username="[已删除用户{uid}]", status=-3）|
| 附件 `post_id` 不在 `posts` 中 | 创建占位帖子（content="[已删除帖子]", invisible=-1）|

占位记录在迁移完成后可按 status/invisible 值识别和处理。

## 错误处理

迁移脚本遇到异常数据时的处理策略：

| 场景 | 策略 | 说明 |
|------|------|------|
| 帖子 `author_id` 不在 `users` 中 | **创建占位用户 + 继续** | 收集所有缺失 uid，批量创建占位用户，帖子全量保留 |
| 帖子 `thread_id` 不在 `threads` 中 | **创建占位主题 + 继续** | 收集所有缺失 tid，批量创建占位主题（sticky=-99），帖子全量保留 |
| 主题 `forum_id` 不在 `forums` 中 | **创建占位版块 + 继续** | 收集所有缺失 fid，批量创建占位版块（status=-1），主题全量保留 |
| 主题 `author_id` 不在 `users` 中 | **创建占位用户 + 继续** | 收集所有缺失 uid，批量创建占位用户，主题全量保留 |
| 附件 `post_id` 不在 `posts` 中 | **创建占位帖子 + 继续** | 收集所有缺失 pid，批量创建占位帖子，附件全量保留 |
| 头像文件不存在 | **avatar 设为空字符串** | `avatarstatus=1` 但实际文件缺失时，降级为无头像 |
| 附件文件不存在 | **保留数据库记录，file_path 不变** | R2 上传阶段单独处理缺失文件，不影响 D1 数据迁移 |
| BBCode 解析失败 | **保留原始文本 + 标记** | 记录 pid 到 `bbcode_failures.log`，content 存原始 message |
| 编码无法修复 | **保留原始字节 + 标记** | 记录 pid 到 `encoding_failures.log` |
| SQL dump 解析错误 | **中止当前表** | 报告行号和原始内容，人工检查 |

## D1 导入实战

Cloudflare D1 的 `wrangler d1 execute --file` 有诸多限制，需要特殊处理。

### 导入限制

| 限制项 | 说明 | 解决方案 |
|-------|------|---------|
| SQL 语句长度 | 单条语句最大 100KB | 超长内容截断（47 个帖子被截断） |
| 解析方式 | 按行解析 SQL | 换行用 `replace(...,char(10))` 处理 |
| 文件大小 | 5 GiB 上传限制 | 拆成小文件（每 20K 行 ~10-30MB） |
| 执行超时 | 大文件导入易超时 | 逐个小文件导入，自动重试 |
| 并发 | 导入期间数据库锁定 | 顺序导入，不可并行 |
| 外键约束 | `PRAGMA defer_foreign_keys` 在 import 模式无效 | 用 `PRAGMA foreign_keys = OFF` |

### 导出脚本 (`scripts/migrate/export-v3.ts`)

关键技术：

1. **换行处理**：帖子内容中的 `\n`/`\r` 替换为 token `{{LF}}`/`{{CR}}`，再用 `replace()` 函数还原
   ```typescript
   replace(replace('content{{LF}}here', '{{LF}}', char(10)), '{{CR}}', char(13))
   ```

2. **NULL 字节清理**：历史数据中有 `\x00` 字节，会导致 SQL 解析失败
   ```typescript
   s = s.replaceAll("\x00", "");
   ```

3. **超长内容截断**：检测字节长度超过 95KB 的内容，二分查找截断到安全范围内
   ```typescript
   const byteLen = new TextEncoder().encode(line).length;
   if (byteLen > 95000) { /* truncate */ }
   ```

4. **分块导出**：每 20K 行一个文件，确保单文件在 10-30MB 之间

### 导入脚本 (`scripts/migrate/import-v3.sh`)

- 150 个小文件逐个导入
- 自动重试机制（最多 3 次）
- D1 reset 恢复等待（遇到 `D1_RESET_DO` 时等 120 秒）
- `rows_written` 验证（虽然 wrangler meta 显示不准确）

### 实际导入结果

| 表 | 行数 | 文件数 | 导入耗时 |
|---|---|---|---|
| forums | 218 | 1 | ~1 秒 |
| users | 1,141,586 | 1 | ~3 秒 |
| threads | 982,598 | 1 | ~2 秒 |
| posts | 9,510,896 | 150 | ~54 分钟 |
| attachments | 76,721 | 1 | ~2 秒 |

**总耗时：约 60 分钟**

### 最终数据库

- **大小**：4.5 GB（含索引 331 MB）
- **查询性能**：核心查询 < 10ms，统计查询 ~100-200ms
- **索引**：8 个，全部生效

### 性能测试结果

| 查询类型 | 耗时 | 索引使用 |
|---------|------|---------|
| 按用户查帖子 | 3.4ms | idx_posts_author |
| 主题帖子分页 | 1.8ms | idx_posts_thread |
| 全站最新主题 | 0.5ms | idx_threads_latest |
| 按论坛查主题 | 136ms | idx_threads_forum |
| 论坛统计（GROUP BY） | 159ms | 全表扫描 |

### 故障排除记录

1. **`unistr() not supported`**：sqlite3 3.51+ CLI 输出用 `unistr()` 编码控制字符，D1 不支持
   - 解决：用 `bun:sqlite` 直接导出 SQL

2. **`Expression tree is too large (maximum depth 100)`**：用 `||` 拼接换行导致嵌套过深
   - 解决：改用 `replace()` 函数（仅 2 层嵌套）

3. **`SQLITE_TOOBIG: statement too long`**：单个 INSERT 语句超过 100KB
   - 解决：检测字节长度并截断超长内容

4. **静默失败（`success: true` 但 `rows_written: 0`）**：文件包含 NULL 字节或换行导致解析中断
   - 解决：清理 NULL 字节，确保每条 SQL 单行

5. **D1_RESET_DO 恢复模式**：失败后需要等待 60-120 秒才能重试
   - 解决：检测到该错误时等待 120 秒后重试

# 数据迁移

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
  - `adminid` → `role`（0=user, 1=admin, 2=super-mod, 3=mod）
  - `avatarstatus` → `avatar` 路径计算（仅 avatarstatus=1 时计算）
  - 密码字段直接映射（hash + salt），不做转换
  - `status` 映射：活跃用户取 `pre_common_member.status`（0=正常，-1=封禁），`freeze=1` 也标记为 -1；归档用户统一标记 -2
- 策略：以 `uc_members` 为基准（114 万），分两步——先活跃用户（JOIN `pre_common_member`），再归档用户（JOIN `pre_common_member_archive` 且排除已导入的）
- 注意：`uc_members` 有 114 万记录，`pre_common_member` 7 万 + `pre_common_member_archive` 107 万

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

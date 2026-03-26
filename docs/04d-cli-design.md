# 04d — CLI 客户端设计

> Telnet 风格命令行论坛客户端，通过 Worker API 访问数据。

## 功能

- 浏览版块、主题、帖子
- 查看用户资料
- 发布回复（TODO）
- 私信（TODO）

## 技术栈

| 依赖 | 版本 | 说明 |
|------|------|------|
| commander | latest | 命令行参数解析 |
| inquirer | latest | 交互式提示 |
| chalk | latest | 终端颜色 |
| ora | latest | 加载动画 |
| @ellie/types | workspace:* | 共享类型 |
| @ellie/api-client | 内置 | Worker API 客户端 |

## 命令

```bash
# 查看帮助
ellie --help

# 浏览版块列表
ellie browse

# 浏览指定版块
ellie browse 1

# 查看主题
ellie thread 123

# 发布回复（TODO）
ellie reply 123
```

## API 客户端

```typescript
// packages/cli/src/client.ts
const API_BASE = process.env.ELLIE_API_URL || "https://ellie.nocoo.cloud";

export class ApiClient {
	async request<T>(path: string, options?: RequestInit): Promise<T> {
		const res = await fetch(`${API_BASE}${path}`, options);
		if (!res.ok) throw new Error(`API error: ${res.status}`);
		return res.json();
	}

	async getForums() {
		return this.request("/api/v1/forums");
	}

	async getThreads(forumId: number, limit = 20) {
		const params = new URLSearchParams({ forumId: String(forumId), limit: String(limit) });
		return this.request(`/api/v1/threads?${params}`);
	}
}
```

## 界面示例

```
$ ellie browse

┌─────────────────────────────────────────┐
│ Ellie Forum CLI                         │
├─────────────────────────────────────────┤
│ [1] 同济大学                             │
│   [2] 校园交流                           │
│   [3] 学术信息                           │
│ [4] 技术社区                             │
│   [5] 编程开发                           │
│   [6] 硬件讨论                           │
└─────────────────────────────────────────┘

> _
```

## 本地运行

```bash
cd packages/cli
bun run src/index.ts
```

## 开发路线

- [x] 基础命令结构
- [x] API 客户端
- [ ] browse 命令实现
- [ ] thread 命令实现
- [ ] reply 命令实现
- [ ] 登录认证
- [ ] 配置文件（~/.ellie/config.json）

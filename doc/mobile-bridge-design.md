# 移动端 Bridge 实现规范（TypeScript）

> 架构与决策见 [mobile-bridge-architecture.md](mobile-bridge-architecture.md)。本文是实现契约：类型、端口、协议、SQL、里程碑与验收标准。

## 1. 仓库结构

```
bridge/
├── package.json                 # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── packages/
│   └── protocol/                # 共享类型与 zod schema（Bridge 与移动端都依赖）
│       ├── src/messages.ts      # 设备 ↔ Bridge 消息
│       ├── src/entities.ts      # Session/Lease/McpStatus 等
│       └── src/fold.ts          # ACP update → 可渲染 blocks 的纯函数
└── apps/
    ├── bridge/
    │   ├── src/main.ts          # 组装
    │   ├── src/config.ts        # env 解析（zod）
    │   ├── src/acp/             # 监督器 + 连接
    │   ├── src/session/         # 目录、日志、租约
    │   ├── src/ws/              # 接入、鉴权、路由
    │   ├── src/mcp/             # 配置读取、探测、状态合并
    │   ├── src/db/              # DDL、迁移、仓储
    │   └── src/http/            # 健康检查、鉴权、内部端点
    └── mobile/                  # Vite + React + TS
```

**约束**：`packages/protocol` 不得依赖 Node 内置模块（移动端要用）；Bridge 专属逻辑不得进入 protocol。

## 2. 依赖

```json
{
  "engines": { "node": ">=22" },
  "dependencies": {
    "@agentclientprotocol/sdk": "1.4.0",
    "fastify": "^5",
    "@fastify/cookie": "^11",
    "ws": "^8",
    "better-sqlite3": "^12",
    "drizzle-orm": "^0.44",
    "zod": "^4",
    "pino": "^9",
    "prom-client": "^15"
  },
  "devDependencies": {
    "typescript": "^5.9",
    "tsdown": "^0.15",
    "vitest": "^3",
    "@types/ws": "^8",
    "@types/better-sqlite3": "^7"
  }
}
```

`@agentclientprotocol/sdk` 版本必须与本机 DSH 使用的版本一致（当前 1.4.0），升级时同步升。

## 3. 领域类型

```ts
// packages/protocol/src/entities.ts
export type SessionId = string
export type DeviceId = string
/** Bridge 为每会话分配的单调序号，从 1 开始。 */
export type Seq = number

export type LeaseState = 'idle' | 'read' | 'write' | 'handoff'

export interface LeaseSnapshot {
  state: LeaseState
  /** 当前写权持有者；read/idle 时为 null。 */
  holder: DeviceId | null
  /** handoff 宽限截止时间（epoch ms）。 */
  deadline?: number
}

export interface SessionSummary {
  id: SessionId
  /** 来自 DSH 的 durable title；未投影时为 null。 */
  title: string | null
  cwd: string
  createdAt: number
  lastActivityAt: number
  lastSeq: Seq
  lease: LeaseSnapshot
  /** 是否有在途提示词。 */
  running: boolean
}

export type McpState = 'connected' | 'connecting' | 'reconnecting' | 'down' | 'unknown' | 'disabled'

export interface McpServerStatus {
  server: string
  transport: 'stdio' | 'http'
  state: McpState
  since: number
  lastError?: string
  lastCallAt?: number
  lastCallOk?: boolean
  source: 'process' | 'probe' | 'inferred'
}
```

## 4. 端口（可实现、可 mock）

```ts
// apps/bridge/src/ports.ts
export interface AcpAgentPort {
  start(): Promise<void>
  stop(): Promise<void>
  isReady(): boolean
  newSession(input: { cwd: string }): Promise<SessionId>
  resumeSession(input: { sessionId: SessionId; cwd: string }): Promise<void>
  /** 解析时代表本轮结束；流式过程通过 onUpdate 交付。 */
  prompt(sessionId: SessionId, text: string): Promise<StopReason>
  cancel(sessionId: SessionId): Promise<void>
  setConfig(sessionId: SessionId, configId: string, value: string): Promise<void>
  onUpdate(handler: (e: { sessionId: SessionId; update: SessionUpdate }) => void): () => void
  onPermission(handler: (e: PermissionAsk) => Promise<PermissionAnswer>): () => void
  onTitle(handler: (e: { sessionId: SessionId; title: string }) => void): () => void
}

export interface SessionRepository {
  list(): Promise<SessionSummary[]>
  get(id: SessionId): Promise<SessionSummary | undefined>
  upsert(summary: SessionSummary): Promise<void>
  nextSeq(id: SessionId): Promise<Seq>
  append(id: SessionId, seq: Seq, kind: string, payload: unknown): Promise<void>
  range(id: SessionId, from: Seq, to?: Seq): Promise<StoredUpdate[]>
  lastSeq(id: SessionId): Promise<Seq>
  prune(id: SessionId, keep: number): Promise<void>
  rename(id: SessionId, title: string): Promise<void>
}

export interface LeaseManager {
  attach(sessionId: SessionId, deviceId: DeviceId): Promise<LeaseSnapshot>
  detach(sessionId: SessionId, deviceId: DeviceId): Promise<LeaseSnapshot>
  take(sessionId: SessionId, deviceId: DeviceId): Promise<LeaseSnapshot>
  release(sessionId: SessionId, deviceId: DeviceId): Promise<LeaseSnapshot>
  assertWriter(sessionId: SessionId, deviceId: DeviceId): Promise<void>
  holder(sessionId: SessionId): Promise<DeviceId | null>
}

export interface McpStatusSource {
  snapshot(): Promise<McpServerStatus[]>
  /** 订阅变化，供 WS 推送。 */
  subscribe(handler: (servers: McpServerStatus[]) => void): () => void
}
```

所有端口以构造注入，便于用假 ACP server 跑集成测试。

## 5. ACP 集成

### 5.1 启动子进程

```ts
const child = spawn(dshBin, ['--profile', 'acp'], {
  cwd: workspaceRoot,
  env: { ...process.env, DSH_HOME: dshHome, ...extraEnv },
  stdio: ['pipe', 'pipe', 'pipe'],
})
```

- `stderr` 单独收集，写入日志文件；**绝不与 stdout 混流**（stdout 是协议）。
- 退出/崩溃：指数退避重启（500ms → 30s，上限 10 次），重启后所有会话标记为"需重新 resume"。
- 关闭：先 `SIGTERM`，等待 5s，再 `SIGKILL`（Windows 直接 `taskkill /T`）。

### 5.2 建立连接（与 DSH 官方 ACP 客户端同构）

```ts
import { client as createAcpClientApp, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'

const app = createAcpClientApp({ name: 'dsh-mobile-bridge' })
  .onNotification(methods.client.session.update, ({ params }) => {
    void onUpdate(params.sessionId, params.update)
  })
  .onRequest(methods.client.session.requestPermission, ({ params }) => requestPermission(params))

const connection = app.connect(ndJsonStream(
  NodeWritable.toWeb(child.stdin)  as WritableStream<Uint8Array>,
  NodeReadable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
))

await connection.agent.request(methods.agent.initialize, {
  protocolVersion: PROTOCOL_VERSION,
  // 不广告 fs / terminal：agent 自服务，客户端不需要也未获授权
  clientCapabilities: {},
})
```

### 5.3 会话方法

| 操作 | 调用 | 说明 |
|---|---|---|
| 新建 | `agent.request(methods.agent.session.new, { cwd, mcpServers: [] })` | `cwd` 必须是白名单根目录 |
| 恢复 | `agent.request(methods.agent.session.resume, { sessionId, cwd, mcpServers: [] })` | 仅当 Bridge 未持有该会话 |
| 提示 | `agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text }] })` | Promise 在本轮结束时 resolve |
| 取消 | `agent.notify(methods.agent.session.cancel, { sessionId })` | 通知，无回执 |
| 关闭 | `agent.request(methods.agent.session.close, { sessionId })` | 释放写锁 |
| 列举 | `agent.request(methods.agent.session.list, {})` | **只含非活跃会话**，仅用于冷启动补目录 |

**错误映射**（ACP JSON-RPC error → 设备错误码）：

| 来源 | 设备码 | 处理 |
|---|---|---|
| `session is already active` | `session_busy` | 标记"被其他入口占用"，只读 |
| `session is not resumable` | `session_gone` | 引导回列表 |
| `session cwd does not match` | `session_cwd_mismatch` | 记录并忽略该会话 |
| 其他 `-32xxx` | `agent_error` | 原样消息（脱敏后） |
| 连接断开 | `agent_disconnected` | 触发重启，设备收到可重试错误 |

## 6. 状态机

### 6.1 会话生命周期

```
cold --(首个 prompt)--> activating --(resume/new 成功)--> active --(idle 30min)--> cold
active --(ACP 崩溃)--> cold（写锁已由内核释放）
```

**懒激活**：attach/读不触发 resume；只有写操作（prompt）才激活。避免"看一眼列表就拉起 N 个 Agent"。

### 6.2 租约

| 当前 | 事件 | 下一个 | 副作用 |
|---|---|---|---|
| idle | attach | read | 广播 lease |
| read | prompt | write | 其余设备收到只读通知；广播 |
| write | prompt（其他设备） | write | 拒绝：`lease_held`（或排队，见配置） |
| write | 设备断线 | handoff | 启动 10s 计时 |
| handoff | 同 deviceId 重连 | write | 取消计时 |
| handoff | 超时 | read | 广播；未决审批保留 |
| read | 最后持有者重连 | write | 自动收回 |
| 任意 | 显式 take | write | 原持有者降级并收 `lease_revoked` |

### 6.3 提示词

```
idle --prompt--> in_flight --(resolve)--> idle
in_flight --cancel--> cancelling --(resolve)--> idle
in_flight --设备断线--> in_flight（继续）
```

- `clientMsgId` 幂等表：重复请求直接返回原回执。
- 同一会话已有 `in_flight` 时，第二个 prompt 返回 `prompt_in_flight`（不排队）。

## 7. 设备协议（zod）

```ts
// packages/protocol/src/messages.ts
const imageRef = z.object({
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  data: z.string().max(8 * 1024 * 1024), // base64
})

export const clientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), token: z.string().max(256), deviceId: z.string().max(64) }),
  z.object({ type: z.literal('session.list'), cursor: z.string().max(64).optional() }),
  z.object({ type: z.literal('session.attach'), sessionId: z.string(), lastSeq: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal('session.detach'), sessionId: z.string() }),
  z.object({ type: z.literal('session.prompt'), sessionId: z.string(), clientMsgId: z.string().max(64), text: z.string().max(64_000), images: z.array(imageRef).max(4).optional() }),
  z.object({ type: z.literal('session.cancel'), sessionId: z.string() }),
  z.object({ type: z.literal('session.lease'), sessionId: z.string(), action: z.enum(['take', 'release']) }),
  z.object({ type: z.literal('permission.answer'), requestId: z.string(), optionId: z.string() }),
  z.object({ type: z.literal('config.set'), sessionId: z.string(), configId: z.string().max(64), value: z.string().max(256) }),
  z.object({ type: z.literal('mcp.subscribe') }),
])
```

下行：

```ts
export const serverMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), deviceId: z.string() }),
  z.object({ type: z.literal('session.list'), sessions: z.array(sessionSummarySchema), nextCursor: z.string().optional() }),
  z.object({ type: z.literal('session.snapshot'), session: sessionSummarySchema, seq: z.number(), blocks: z.array(blockSchema), pendingPermission: permissionSchema.optional(), historyStartsAt: z.number().optional(), historyTruncated: z.boolean().optional() }),
  z.object({ type: z.literal('session.update'), sessionId: z.string(), seq: z.number(), update: z.unknown() }),
  z.object({ type: z.literal('session.lease'), sessionId: z.string(), lease: leaseSchema }),
  z.object({ type: z.literal('session.prompt.done'), sessionId: z.string(), clientMsgId: z.string(), stopReason: z.string() }),
  z.object({ type: z.literal('permission.request'), sessionId: z.string(), requestId: z.string(), toolCall: z.object({ toolCallId: z.string(), title: z.string().optional() }), options: z.array(permissionOptionSchema) }),
  z.object({ type: z.literal('permission.resolved'), requestId: z.string(), outcome: z.enum(['allowed', 'rejected', 'cancelled']) }),
  z.object({ type: z.literal('mcp.status'), servers: z.array(mcpServerStatusSchema) }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string(), retryable: z.boolean(), requestType: z.string().optional() }),
])
```

**约束**：`session.update.update` 用 `z.unknown()`——未知的 `sessionUpdate` 变体必须原样下发，不能因解析失败而断开设备。

## 8. 持久化

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,
  title           TEXT,
  cwd             TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  next_seq        INTEGER NOT NULL DEFAULT 1,
  archived        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE updates (
  session_id  TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  kind        TEXT NOT NULL,
  payload     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (session_id, seq)
) WITHOUT ROWID;

CREATE TABLE devices (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  token_hash  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE prompt_receipts (
  client_msg_id TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  device_id     TEXT NOT NULL,
  state         TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE mcp_status (
  server      TEXT PRIMARY KEY,
  transport   TEXT NOT NULL,
  state       TEXT NOT NULL,
  since       INTEGER NOT NULL,
  last_error  TEXT,
  source      TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
```

- 序号分配：`UPDATE sessions SET next_seq = next_seq + 1 WHERE id = ? RETURNING next_seq - 1`，事务内完成。
- 写入顺序：**先落库，再 fan-out**（设备看到的每个 seq 都已持久化，重启后可补发）。
- 保留策略：每会话保留最近 `RETENTION_UPDATES`（默认 5000）条；超出后删除最旧的并写一条 `history/truncated` 标记，客户端展示"更早的记录已省略"。
- 迁移：`migrations/0001_init.sql`，启动时按 `PRAGMA user_version` 执行。

## 9. 重连与快照

| 场景 | 行为 |
|---|---|
| `lastSeq` 在内存环形缓冲 | 补发 `[lastSeq+1, now]` |
| `lastSeq` 早于缓冲但库里有 | 从库读区间补发；超过保留上限则发快照 |
| 无 `lastSeq` / 不连续 | `session.snapshot` + 之后增量 |
| 会话在 ACP 已消失 | `error { code: 'session_gone' }` |

快照内容 = `fold(updates[0..now])`，`fold` 是纯函数，客户端与服务端共用同一实现（`packages/protocol/src/fold.ts`）。

**历史边界（v1 已接受）**：Bridge 只拥有自己接入之后收到的 update。attach 一个没有历史的会话时，`session.snapshot` 带 `historyStartsAt`（Bridge 写入首条记录的时间）或 `historyTruncated: true`（超出保留上限）。客户端据此显示"更早的记录不在本设备可见"，**禁止渲染成空会话**。不要为了补历史去 resume——`session/resume` 不回放历史，只会白付一次 Agent 组装成本。

环形缓冲：每会话最近 500 条，进程内 Map，冷启动时从库回填最后 500 条。

## 10. 标题

- 依赖 DSH 补丁发出 `session_info_update`；Bridge 在 `sessionUpdate` 分发前拦截该类型：
  - 更新 `sessions.title`
  - 立刻推 `session.list` 的单行更新或 `session.updated` 消息
- DSH 未打补丁时：标题为 `null`，移动端显示 `cwd` 的 basename 或 `sessionId` 前 8 位，并标注"标题不可用"。
- 可选回填：读投影缓存（`$DSH_HOME/storages/*/session_projcache/...`）——只在启动时做一次，失败静默。

## 11. MCP 状态

**配置来源**：解析 `$DSH_HOME/profiles/acp/cordis.patch.yml` 中的 `dsh-mcp-client` 行；解析失败即启动失败（配置错误要早暴露）。

**探测**（每 30s）：

| 传输 | 方法 | 超时 |
|---|---|---|
| http | `POST {url}` 发 MCP `initialize`（`clientInfo` 固定） | 3s |
| stdio | 检查 DSH 子进程树中是否有匹配 command 的进程 | 1s |

**上报**（可选，推荐）：DSH 侧插件把 `{server, state, since, error}` POST 到 `http://127.0.0.1:${INTERNAL_PORT}/internal/mcp`，Header `x-bridge-secret`。

**合并**：`process` 优先 > `probe` > `inferred`；两者矛盾时 `reconnecting`。
**缓存**：写 `mcp_status` 表，重启后先展示上次状态（带"陈旧"标记）。

## 12. 配置

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `DSH_BIN` | 是 | — | `dsh` 可执行文件路径 |
| `DSH_HOME` | 是 | — | 子进程 home |
| `DSH_PROFILE` | 否 | `acp` | |
| `WORKSPACE_ROOT` | 是 | — | 会话 `cwd` 白名单根 |
| `BRIDGE_PORT` | 否 | 8787 | HTTP/WS |
| `INTERNAL_PORT` | 否 | 8788 | 内部端点（只监听 loopback） |
| `BRIDGE_SECRET` | 是 | — | Cookie 签名 + 内部端点共享密钥 |
| `DB_PATH` | 否 | `./data/bridge.db` | |
| `RETENTION_UPDATES` | 否 | 5000 | |
| `LEASE_GRACE_MS` | 否 | 10000 | |
| `PERMISSION_TTL_MS` | 否 | 180000 | |
| `LOG_LEVEL` | 否 | `info` | |

## 13. 里程碑与验收标准

| 里程碑 | 交付 | 验收 |
|---|---|---|
| **M0** | workspace、tsconfig、protocol 包、SQLite 迁移、health 端点 | `GET /health` 返回 200；`pnpm test` 通过 |
| **M1** | ACP 监督器：spawn、initialize、崩溃重启、优雅退出 | 杀子进程后 30s 内自动重启；stdout 无日志污染 |
| **M2** | new/resume/prompt/cancel 封装 + 假 ACP server 集成测试 | 用假 server 跑通一次完整流式轮次；取消能中断 |
| **M3** | 会话目录、update 持久化、seq、attach/snapshot | 重连后从 `lastSeq` 补发且不丢不重；重启进程后历史仍在 |
| **M4** | 租约状态机、多设备 fan-out | 两台设备同时 attach，只有一台能 prompt；接管后原设备只读 |
| **M5** | 权限请求 + 转移 + TTL | 写权设备批准生效；断线 180s 后自动 `cancelled` |
| **M6** | 标题（含未打补丁降级） | 有补丁时标题实时更新；无补丁时降级显示不报错 |
| **M7** | MCP 配置解析 + 探测 + 状态推送 | 停掉一个 HTTP MCP 服务器，状态在 60s 内变 `down` |
| **M8** | 移动端 UI（列表/聊天/审批/状态） | 真机浏览器可用；横竖屏不溢出；无历史时显示"更早记录不可见"提示而非空页 |

每个里程碑结束必须：`pnpm typecheck && pnpm test` 全绿；新增 SQL 有迁移文件；协议改动同时更新 `packages/protocol` 与移动端。

## 14. 测试策略

1. **单元**：`fold`、租约状态机、seq 分配、MCP 合并规则。
2. **集成（假 ACP server）**：一个 200 行的 Node 脚本，按 ACP 协议回放脚本化场景（正常轮次、权限、中途崩溃）。
3. **契约（真实 DSH）**：起 `dsh --profile acp`，跑 new/list/resume/prompt/cancel/权限，把收到的通知录成 golden JSON，CI 比对。**这条最重要**——SDK 版本与 DSH 发出的变体可能漂移。
4. **负载**：50 台模拟设备同时订阅一个会话，验证 fan-out 内存与延迟。

## 15. 编码约束（给实现代理）

**必须**

- 所有设备输入按 zod 校验后再使用；未知字段拒绝或忽略，不透传。
- `session/new` / `session/resume` 的 `cwd` 必须固定为 `WORKSPACE_ROOT`；`mcpServers` 必须为空数组。
- ACP 通知先持久化再 fan-out。
- 未知 `sessionUpdate` 原样转发，禁止抛错断开连接。
- 所有 ACP 调用都要有超时与取消；`prompt` 无超时但有取消。
- 日志只打印 sessionId 前 8 位、工具名、状态；不打印 prompt 正文、路径、env。

**禁止**

- 禁止把设备的 `mcpServers`、`cwd`、`additionalDirectories` 透传给 ACP。
- 禁止在 Bridge 里生成/改写标题。
- 禁止用 `JSON.parse` 直接吃 ACP 输出而不校验（用 SDK 类型）。
- 禁止把 DSH 的 stdout 接进日志管道。
- 禁止由读权设备回答权限请求。

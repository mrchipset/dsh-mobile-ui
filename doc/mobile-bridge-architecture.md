# 移动端 Bridge 架构（v2 · 全 TypeScript）

> 配套实现规范：[mobile-bridge-design.md](mobile-bridge-design.md)。本文只写"是什么、为什么"，实现细节在配套文档。

## 1. 范围与已定决策

**范围**：一个 DSH ACP 进程、一个 Bridge、多台设备；MCP 由服务端配置，移动端只读状态。

| # | 决策 | 影响 |
|---|---|---|
| 1 | 只做单进程 + 多设备 fan-out，不做多租户进程池 | Bridge 接口不变，后续可加进程池 |
| 2 | 标题从 DSH 侧导入 | 给 ACP 服务加 `session_info_update`；Bridge 不生成标题 |
| 3 | 手机后台被杀时提示词继续跑，回来补流 | Bridge 持久化全部 update；设备持久化 `lastSeq` |
| 4 | 审批只有写权设备能做 | 写权转移时审批权随之转移；未决审批 180s TTL 兜底 |
| 5 | 全 TypeScript | Bridge、协议层、移动端同一套类型与工具链 |
| 6 | v1 接受"历史仅从 Bridge 接入后可见" | 不做 JSONL 回填；v2 候选是非标准 `session/history` 方法 |

**非目标**：`/api`（Typert Remote）客户端、工作区/文件/终端/插件管理、多租户调度、计费。

## 2. 拓扑

```
Device A (WSS) ─┐
Device B (WSS) ─┼─> Bridge ── stdio JSON-RPC（单连接）──> dsh --profile acp
Device C (WSS) ─┘     │
                      ├── SQLite：会话 / update 日志 / 设备 / 租约 / MCP 状态
                      ├── MCP 配置（唯一真源）+ 健康探测
                      └── 内部端点：供 MCP 状态上报插件写入
```

- DSH 是 Bridge 的子进程，stdio 生命周期绑定：Bridge 退出 → DSH 退出。
- 设备只信任 Bridge；DSH 不监听端口。
- 一个 Bridge = 一个 `DSH_HOME` + 一个 `--profile acp` + 一条 ACP 连接。

## 3. 组件与职责

| 组件 | 职责 | 明确不做 |
|---|---|---|
| 接入层（HTTP + WS） | 鉴权、Cookie/票据、限流、消息校验 | 不解析 Agent 语义 |
| ACP 监督器 | 拉起/重启 DSH、单连接、请求串行、取消、能力协商 | 不直接读写会话文件 |
| 会话目录 | id、标题、cwd、时间、归档 | 不存消息正文 |
| Update 日志 | 每会话有序 update、快照、保留策略 | 不是 Agent 的真相源 |
| 租约管理 | 写权状态机、审批权转移、TTL | 不改变 ACP 行为 |
| Fan-out | 订阅、增量补发、快照重建 | 不渲染 |
| MCP 状态聚合 | 配置读取、L4/L7 探测、上报合并 | 不提供写配置接口 |
| 策略过滤 | 固定 `cwd`、清空 `mcpServers`、config 白名单 | 不信任设备输入 |

## 4. ACP 的硬约束（决定架构的事实）

| 事实 | 后果 |
|---|---|
| `session/list` **过滤掉活跃会话**，只返回 `{sessionId, cwd}` | Bridge 必须自建会话目录（含标题、时间） |
| `session/resume` **不回放历史** | 首屏历史只能来自 Bridge 自己的日志 |
| 没有工具列表接口 | 只能展示 MCP 服务器状态，不能展示工具清单 |
| 每个会话同时只有一个提示词 | Bridge 串行化 + 租约，避免双写 |
| `session/new`/`resume` 接受客户端 `cwd`、`mcpServers` | 必须由 Bridge 覆盖，绝不能透传 |
| 协议有 `session_info_update`，但 DSH 未发送 | 标题需要 DSH 侧补丁（见 §6） |
| MCP 连接状态无公开事件或服务 | 需要上报插件或 Bridge 探测（见 §7） |

## 5. 会话租约

状态：`idle` / `read` / `write` / `handoff`。

```
idle --attach--> read(多台)
read --prompt--> write(1 台)，其余降为只读
write --断线--> handoff(10s 宽限) --重连--> write / --超时--> read
read --最后持有者重连且无人持写权--> write（自动收回）
read --显式接管--> write（原持有者降级并收到通知）
```

- 任何设备可随时接管；原写者立即降级，不丢消息、不中断提示词。
- 同一会话只允许一个在途提示词；第二台要么排队（深度 1），要么明确拒绝。
- 租约是 UX 保护，不是安全边界；一致性由 ACP 单提示词约束保证。
- **审批权跟随写权**：未决 `permission.request` 转移到新写者。
- **TTL 180s**：写者离线且无人接管时，Bridge 代答 `cancelled`，避免会话永久挂起。
- 设备断线不取消提示词；只有显式 `session.cancel` 或 TTL 才终止。

## 6. 标题从 DSH 导入

ACP 的 `SessionUpdate` 里已有 `session_info_update { title, updatedAt }`，但 DSH 的 ACP 服务没有发。方案：

1. **（采纳）** DSH 侧补丁：标题落盘后发一条 `session_info_update`；`resume` 成功后补发一次。约 30 行，非自定义扩展。
2. Bridge 侧兜底：只读 DSH 投影缓存做冷启动回填，可选。

**标题质量**：`acp-app` 关闭了 `session-title-llm`，所以默认只有 fallback 标题（前 5 词 / 40 字节）。移动专用 profile 可重新启用，代价是每会话多一次标题调用。

## 7. MCP 状态

**配置**：写在 `acp` profile 的 patch 层（每台服务器一条 `dsh-mcp-client`），Bridge 启动时校验，不提供写接口；`session/new` 时强制 `mcpServers: []`、`cwd` 固定。

用 profile 而非逐会话注入的原因：逐会话 `mcpServers` 会给每个会话各起一套 MCP 子进程。

**状态三源合并**（优先级从高到低）：

| 来源 | 内容 | 实现 |
|---|---|---|
| `process` | 连接/重连/失败 | DSH 侧事件 + 上报插件 POST 到内部端点 |
| `probe` | 服务端视角可用性 | HTTP 做 MCP `initialize`/`ping`（3s 超时），stdio 查进程存活 |
| `inferred` | 最近一次调用 | 从 `session/update` 的 `mcp__<server>__<tool>` 推断 |

移动端只读面板：服务器名、传输方式、状态、最近调用时间；不显示 token/命令/env/完整 URL。

## 8. 安全边界

- 设备 → Bridge：WSS + HttpOnly Cookie 会话票据；票据可吊销、可单设备失效。
- Bridge → DSH：stdio，DSH 不监听端口；`clientCapabilities: {}`（不广告 fs/terminal）。
- 输入清洗：`cwd` 固定、`mcpServers` 清空、`configId` 白名单、图片大小/类型限制、文本长度上限。
- 审计：谁批准了哪个 `toolCall`；保留时间可配置。
- 日志脱敏：不回传绝对路径、env、凭据、完整 MCP URL。

## 9. 已知限制（v1）

1. **历史边界（已接受，决策 6）**：只显示 Bridge 亲眼见过的历史。Bridge 上线前或桌面端创建的会话，`resume` 不回放历史，手机上首屏为空；用户发第一条消息后才有内容。UI 必须明确提示"更早的记录不在本设备可见"，不能让用户误以为消息丢了。v2 再评估 `session/history`。
2. 不支持工作区浏览、文件编辑、终端、插件管理。
3. 移动端不能配置 MCP；新增服务器需要改服务端 profile 并重启 DSH 进程。
4. 一个 Bridge 一个 `DSH_HOME`，不做多用户隔离。

## 10. 技术栈

| 层 | 选型 |
|---|---|
| 运行时 | Node 22 LTS，ESM，TS strict |
| HTTP | Fastify |
| WebSocket | `ws` |
| ACP | `@agentclientprotocol/sdk` **1.4.0**（与 DSH 对齐） |
| DB | better-sqlite3 + Drizzle，WAL |
| 校验 | zod（与移动端共享） |
| 日志/指标 | pino + prom-client |
| 测试 | vitest + 假 ACP server + 契约测试 |
| 前端 | Vite + React + TS；后续 Capacitor 套壳 |

**仓库**：Bridge 独立于 DSH monorepo；只有 ACP 标题补丁留在 DSH fork。

## 11. 里程碑

M0 骨架 → M1 ACP 监督 → M2 会话与流式 → M3 持久化与补发 → M4 租约与多设备 → M5 审批 → M6 标题 → M7 MCP 状态 → M8 移动端 UI。

验收标准与目录结构见 [实现规范](mobile-bridge-design.md#13-里程碑与验收标准)。

# DSH Mobile UI

[English](README.md) | **简体中文**

一个用于演示的 DeepSeek Harness 移动端 UI。它由移动优先的 React 客户端和本地 Node Bridge 组成，通过 Agent Client Protocol（ACP）驱动本机 `dsh --profile acp`。

> 这是一个 demo，不是生产级客户端。主要用于探索和验证移动端工作流：会话、流式更新、工具/计划渲染、审批、写权租约和 Light/Dark 主题。仍可能存在粗糙之处、内存租约和未完成的 MCP 集成。

## 功能

- 移动优先的 React UI：会话列表、流式时间线、工具调用、计划和通知。
- 通过 WebSocket 接收实时 ACP 更新，先写入 SQLite 再向设备分发。
- 单写权租约与交接宽限期；其他设备保持只读，但仍会收到实时更新。
- 工具调用审批底部面板；Bridge 原样转发 Agent 提供的选项。
- 共享 TypeScript + zod 协议包；未知 ACP `sessionUpdate` 变体会原样透传。
- Light / Dark 双主题，按设备持久化，首次跟随系统偏好。
- 演示模式：无需启动 Bridge 即可查看完整 UI。
- MCP 服务器状态面板（只读；实时探测计划在 M7 实现）。

## 架构

```text
Browser (React) -- WSS + JSON --> Bridge (Fastify + ws + SQLite) -- stdio ACP --> dsh --profile acp
```

Bridge 会把 ACP 会话的 `cwd` 固定为 `WORKSPACE_ROOT`，并始终发送 `mcpServers: []`。建议与 DSH 运行在同一台机器，或放在可信局域网内。

## 仓库结构

| 路径 | 用途 |
| --- | --- |
| `packages/protocol` | 共享类型、zod 线协议、从 ACP update 到渲染 blocks 的纯函数 `fold` |
| `apps/bridge` | Fastify HTTP/WS 服务、ACP supervisor、SQLite 持久化、租约与审批路由 |
| `apps/mobile` | Vite + React 19 + Tailwind v4 + shadcn 风格 UI |
| `doc/` | 架构与实现规范 |
| `notes/` | 已提交的设计决策与取舍 |

## 环境要求

- 本仓库需要 Node.js `>=22.13`。
- 以源码方式运行 DSH 需要 Node `^22.19` 或 `>=24`，因为 DSH 入口使用了 `import.meta.main`。
- pnpm `10.25` 或更新版本。
- 本地 DeepSeek Harness 构建产物，或已安装的 `dsh` 可执行文件。

## 快速开始

```bash
pnpm install
cp .env.example .env      # Windows: Copy-Item .env.example .env
# 首次运行前先编辑 .env
pnpm dev                  # Bridge :8787 + Mobile :5173
```

打开：

- 移动端 UI：<http://127.0.0.1:5173>
- Bridge 健康检查：<http://127.0.0.1:8787/health>

在移动端设置页填入 Bridge 地址和 `BRIDGE_SECRET`。

### 本地 DSH 源码运行

```env
DSH_BIN=C:/path/to/node.exe   # Node ^22.19 或 >=24
DSH_ARGS=["--import","tsx/esm","apps/cli/src/bin.ts","--profile","acp"]
DSH_CWD=C:/path/to/deepseek-harness
DSH_HOME=C:/Users/you/.dsh
```

### 已安装的 `dsh`

```env
DSH_BIN=dsh
DSH_ARGS=["--profile","acp"]
DSH_CWD=C:/path/to/workspace
```

## 配置

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `BRIDGE_PORT` | `8787` | HTTP 与 WebSocket 端口 |
| `BRIDGE_SECRET` | 必填 | 移动端使用的共享设备令牌 |
| `DB_PATH` | `./data/bridge.db` | SQLite 数据库路径 |
| `WORKSPACE_ROOT` | 当前目录 | 新会话固定的 ACP `cwd` |
| `DSH_BIN` | `dsh` | DSH 可执行文件 |
| `DSH_ARGS` | `["--profile","acp"]` | 传给 `DSH_BIN` 的 JSON 数组参数 |
| `DSH_CWD` | `WORKSPACE_ROOT` | DSH 子进程工作目录 |
| `DSH_HOME` | 继承环境 | 可选的 DSH 子进程 `DSH_HOME` |
| `ACP_ENABLED` | `true` | 是否启动 ACP supervisor；`false` 时 HTTP/WS 仍可用 |
| `RETENTION_UPDATES` | `5000` | 每个会话保留的 update 数量 |
| `LEASE_GRACE_MS` | `10000` | 写权交接宽限期 |
| `PERMISSION_TTL_MS` | `180000` | 未处理审批的自动取消时间 |
| `LOG_LEVEL` | `info` | Pino 日志级别 |
| `STT_ENABLED` | `false` | 启用 `POST /api/transcribe` 与 STT 就绪探测 |
| `STT_BASE_URL` | `http://127.0.0.1:8000/v1` | FunASR OpenAI 兼容服务地址 |
| `STT_MODEL` | `paraformer` | FunASR 模型别名；`sensevoice` 更快 |
| `STT_API_KEY_ENV` | 未设置 | 可选 STT 密钥所在的环境变量名 |

## 语音输入

语音输入会在浏览器录制短音频并上传到 Bridge，再把 FunASR 转写结果插入草稿；发送仍需用户手动确认。

- 配置 `STT_ENABLED=true`、`STT_BASE_URL=http://127.0.0.1:8000/v1`（同机）或 `http://192.168.71.5:8000/v1`（局域网 GPU 主机）、`STT_MODEL=paraformer`。`/health` 会通过 `/v1/models` 返回缓存后的就绪状态。
- 手机需要 HTTPS。在仓库根目录执行：
  ```bash
  mkcert -install
  mkcert -cert-file .certs/dev-cert.pem -key-file .certs/dev-key.pem 192.168.71.5 <LAN_IP> localhost 127.0.0.1
  pnpm dev:mobile:https
  ```
- 打开 `https://<LAN_IP>:5174`。Vite 会把 `/api` 与 `/ws` 代理到 `127.0.0.1:8787` 的 Bridge。
- 手机上安装 mkcert 根证书；iPhone 还需在“设置 → 通用 → 关于本机 → 证书信任设置”中开启完全信任，Android 则作为用户 CA 安装。
- 直接使用 `http://<LAN_IP>` 时无法调用真实麦克风。请在专用网络放行 `5174`；仅当手机直连 Bridge 时才需要放行 `8787`。演示模式无需麦克风或 STT 服务。

## 脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 同时启动 Bridge 与 Mobile |
| `pnpm dev:bridge` | 只启动 Bridge |
| `pnpm dev:mobile` | 只启动 Vite dev server |
| `pnpm dev:mobile:https` | 在 `0.0.0.0:5174` 启动 Vite HTTPS（需要 `.certs/`） |
| `pnpm typecheck` | 全仓库 TypeScript 检查 |
| `pnpm test` | Protocol、Bridge 与 Mobile 单元测试 |
| `pnpm build` | 构建 Bridge 与 Mobile |
| `pnpm lint` / `pnpm format` | Biome 检查与格式化 |
| `pnpm smoke:acp` | 真实 ACP 冒烟测试；需要 `.env` 和本地 DSH 构建 |

## 验证

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm lint
pnpm smoke:acp
```

当前已验证范围：

- Protocol：10 个单元测试。
- Bridge：65 个单元测试，覆盖持久化、租约状态迁移、WS 鉴权与 STT 处理。
- 真实 DSH ACP 冒烟：initialize、列出会话、创建会话、关闭会话。
- Mobile：Playwright 在 390×844 与 320×700 下验证 Light/Dark，包括 onboarding、会话目录、聊天、设置和审批 Sheet。

尚未验证：真实模型 prompt/cancel 往返、真实 DSH 审批回传、iOS 真机 safe-area、离线 PWA。

## 安全

- Bridge 应运行在 loopback 或可信网络中。暴露到公网前请加 TLS 和反向代理。
- `BRIDGE_SECRET` 是共享密钥，不要提交 `.env`。
- Bridge 不会记录 prompt 文本、绝对路径、令牌、环境变量或完整 MCP URL。
- 移动端 v1 将令牌保存在 `localStorage`；HttpOnly Cookie 或按设备令牌是后续工作。
- 所有设备输入在使用前都会经过 zod 校验。

## 限制

- 真实 Bridge 下的 MCP 状态目前为空（只读），实时探测在 M7 实现。
- 租约保存在内存中，Bridge 重启后会重置写权。
- 历史记录从 Bridge 首次观察到会话时开始，不回填桌面端更早的消息。
- 生产打包、离线 PWA、代码拆包尚未完成。

## 文档

- [架构](doc/mobile-bridge-architecture.md)
- [实现规范](doc/mobile-bridge-design.md)
- [设计记录](notes/)

## README 语言

GitHub 始终显示英文 `README.md`；Gitee 会根据浏览器语言自动选择中文 `README.zh-CN.md`。两个平台都可以使用顶部的语言切换链接。

## 许可证

[MIT](LICENSE) © 2026 Zouyu

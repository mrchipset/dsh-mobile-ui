# DSH Mobile UI

移动端友好的 DeepSeek Harness Web UI。浏览器通过 WebSocket 连接 Bridge，Bridge 以 stdio JSON-RPC（ACP）驱动本机 `dsh --profile acp`。

设计文档：

- [架构](doc/mobile-bridge-architecture.md)
- [实现规范](doc/mobile-bridge-design.md)

## 结构

```
packages/protocol   # 共享类型、zod 协议、ACP update → 可渲染 blocks 的纯函数
apps/bridge         # Fastify + ws + ACP supervisor + SQLite
apps/mobile         # Vite + React + Tailwind v4 + shadcn 风格组件
```

## 开发

```bash
pnpm install
cp .env.example .env      # Windows: Copy-Item .env.example .env
pnpm dev                  # bridge :8787 + mobile :5173
```

默认 `.env.example` 指向本机 `C:/Users/Zouyu/CodeReviews/deepseek-harness` 的源码运行方式。DSH 源码入口使用 `import.meta.main`，需要 Node `^22.19` 或 `>=24`；若默认 Node 较旧，把 `DSH_BIN` 指向受支持的 `node` 可执行文件。

若使用已安装的 `dsh`，改为：

```env
DSH_BIN=dsh
DSH_ARGS=["--profile","acp"]
DSH_CWD=<一个工作区目录>
```

移动端打开 `http://127.0.0.1:5173`，在设置页填入 Bridge 地址与 `BRIDGE_SECRET`。

## 校验

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm smoke:acp           # 需要 .env 中的 DSH 配置
curl http://127.0.0.1:8787/health
```

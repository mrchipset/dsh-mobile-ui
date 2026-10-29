# DSH Mobile + GateAway 一体化 Docker 构建手册

本手册覆盖两套部署拓扑、镜像构建、自动化 bootstrap、手工 GateAway 初始化、
密钥管理、验证与排障。所有命令默认在仓库根目录执行。

> 不要把 `deploy/.env`、`deploy/secrets/` 的内容粘贴到聊天、Issue、日志或
> 截图中。二者都已加入 `.gitignore`。

## 1. 架构

### A. 默认拓扑 `deploy/docker-compose.yml`

- `stt`：FunASR paraformer，仅内部 `8000`。
- `bridge`：Bridge + DSH CLI（ACP 为 stdio，必须同容器）。
- `web`：Caddy 静态站 + `/api/*`、`/ws*` 反代，宿主 `8443:443`。
- Bridge 加入外部网络 `llm-gateaway_default`，使用
  `http://backend:4000/v1`。
- 要求外部 GateAway 栈已运行。

### B. 一体化拓扑 `deploy/docker-compose.with-gateaway.yml`

- 额外包含 GateAway：`postgres`、`migrate`、`backend`、`ui`。
- 全部服务在同一 `app` 网络；DSH 仍访问 `http://backend:4000/v1`。
- 宿主端口：app `8443`，Gateway UI `8080`；数据库和后端不映射宿主端口。
- 不要与默认拓扑或原 `llm-gateaway` 栈同时运行：UI 端口和 Postgres 数据卷会冲突。

## 2. 前置条件

- Docker Desktop（Linux containers）与 Compose v2.24+。
- PowerShell 7（`pwsh`）用于自动脚本；Git。
- Node 22（仅本地工具链需要；容器内已自带）。
- 上游 DeepSeek API Key（`GATEWAY_DEEPSEEK_API_KEY`）。
- 仓库根目录已有 `.certs/dev-cert.pem`、`.certs/dev-key.pem`，SAN 含手机访问的
  LAN IP（当前 `192.168.71.5`）。
- 本地镜像（可避免 Docker Hub 认证失败）：
  `node:22-bookworm-slim`、`caddy:2-alpine`、`postgres:16-alpine`、
  `llm-gateaway-backend:local`、`llm-gateaway-ui:local`、
  `funasr-openai-api:cpu-2026-10`、`dsh-mobile-bridge:local`、`dsh-mobile-web:local`。

## 3. 代码与镜像准备

### 3.1 GateAway 源码

```powershell
git clone https://github.com/mrchipset/LLM-GateAway.git ..\LLM-GateAway
# 建议固定到已验证的 tag/commit，构建前执行：
git -C ..\LLM-GateAway checkout <tag-or-commit>
```

默认 `GATEWAY_REPO=../../LLM-GateAway`（相对 `deploy/`）。可用
`deploy/.env` 的 `GATEWAY_REPO` 或脚本参数 `-GatewayRepo` 覆盖。

### 3.2 构建 GateAway 镜像

```powershell
docker compose -f deploy/docker-compose.with-gateaway.yml build backend ui
```

或使用 GateAway 自身 compose：

```powershell
docker compose -f ..\LLM-GateAway\docker-compose.yml --profile app build
```

### 3.3 构建应用镜像

```powershell
docker compose -f deploy/docker-compose.with-gateaway.yml build bridge web
```

STT 镜像已存在时直接复用；缺失时：

```powershell
docker compose -f deploy/docker-compose.with-gateaway.yml build stt
```

镜像构建使用本地 Node/Caddy、npmmirror、Tsinghua apt（HTTP 引导）和
Tsinghua PyPI。可在 `deploy/.env` 覆盖 `NODE_IMAGE`、`CADDY_IMAGE`、
`NPM_REGISTRY`、`APT_MIRROR`、`PIP_INDEX_URL`、`TORCH_INDEX_URL`。

## 4. 自动 bootstrap（推荐）

```powershell
$env:GATEWAY_DEEPSEEK_API_KEY = '<上游 DeepSeek Key>'
pwsh deploy/bootstrap.ps1
```

脚本不会输出任何密钥，只打印步骤、文件路径和 URL。

### 4.1 参数

| 参数 | 行为 |
| --- | --- |
| 无参数 | 全新 Gateway 数据卷 `dsh-mobile-gateway-pgdata`；生成缺失的本地密钥；构建并启动 |
| `-ExistingGateway` | 复用 `llm-gateaway_pgdata`；保留现有 client key/audit；要求已存在的 Postgres 密码与 master key |
| `-Force` | 先停止 `deploy/docker-compose.yml`、一体化栈和 `../LLM-GateAway` 栈；全新模式下重新生成 Bridge/master/Postgres 密钥并重建 Gateway DB 卷；与 `-ExistingGateway` 合用时保留 DB 凭据和已有 client key。应用卷保留 |
| `-SkipBuild` | 不构建，要求全部镜像已存在 |
| `-GatewayRepo <path>` | 使用指定 LLM-GateAway 检出目录 |

### 4.2 脚本产物

- `deploy/secrets/bridge.secret`
- `deploy/secrets/gateway.master.key`
- `deploy/secrets/postgres.password`
- `deploy/secrets/gateway.deepseek.key`
- `deploy/secrets/gateway.client.key`（通过管理 API 创建后写入）
- `deploy/.env`（运行时生成/更新，git-ignored）

脚本步骤：解析/克隆 GateAway → 生成或复用密钥 → 写 `.env` → 构建 →
启动 `postgres/migrate/backend/ui` → 等待 `/readyz` → 创建/查找 tenant
`dsh-mobile` → 创建/复用 client key → 注册 `deepseek-flash` → 启动
`stt/bridge/web` → 等待 `https://127.0.0.1:8443/api/health`。

> `-Force` 会删除并重建 `dsh-mobile-gateway-pgdata`（仅这个全新 Gateway 卷），
> 应用数据卷 `dsh-mobile_*` 不受影响。不要用它切换已有 Gateway 数据。

## 5. 手工路径（理解或非 Windows 环境）

### 5.1 生成密钥文件（不打印）

Linux/macOS：

```bash
mkdir -p deploy/secrets
openssl rand -base64 32 | tr '+/' '-_' | tr -d '=' > deploy/secrets/gateway.master.key
openssl rand -base64 32 | tr '+/' '-_' | tr -d '=' > deploy/secrets/bridge.secret
openssl rand -hex 24 > deploy/secrets/postgres.password
```

PowerShell 7：

```powershell
New-Item -ItemType Directory -Force deploy/secrets | Out-Null
function New-Token { $b=[byte[]]::new(32); [Security.Cryptography.RandomNumberGenerator]::Fill($b); [Convert]::ToBase64String($b).TrimEnd('=').Replace('+','-').Replace('/','_') }
[IO.File]::WriteAllText('deploy/secrets/gateway.master.key', (New-Token))
[IO.File]::WriteAllText('deploy/secrets/bridge.secret', (New-Token))
$b=[byte[]]::new(24); [Security.Cryptography.RandomNumberGenerator]::Fill($b)
[IO.File]::WriteAllText('deploy/secrets/postgres.password', [Convert]::ToHexString($b).ToLowerInvariant())
```

### 5.2 写 `deploy/.env`

从 `deploy/.env.example` 复制并至少设置：

```dotenv
BRIDGE_SECRET=<bridge.secret 内容>
GATEWAY_MASTER_KEY=<gateway.master.key 内容>
POSTGRES_PASSWORD=<postgres.password 内容>
GATEWAY_DEEPSEEK_API_KEY=<上游 DeepSeek Key>
GATEWAY_UI_PORT=8080
GATEWAY_ENVIRONMENT=production

# 全新 Gateway：
GATEWAY_PGDATA_VOLUME=dsh-mobile-gateway-pgdata
GATEWAY_PGDATA_EXTERNAL=false

# 复用现有 Gateway：
# GATEWAY_PGDATA_VOLUME=llm-gateaway_pgdata
# GATEWAY_PGDATA_EXTERNAL=true
```

`POSTGRES_PASSWORD` 必须是 URL-safe 字符（字母/数字/-/_），因为会嵌入 DSN。

### 5.3 启动 GateAway 并初始化

```powershell
docker compose -f deploy/docker-compose.with-gateaway.yml up -d postgres migrate backend ui
do { Start-Sleep 2; $r = curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:8080/readyz } while ($r -ne "200")
```

创建 tenant（master key 从文件读取，不打印）：

```powershell
$master = (Get-Content -Raw deploy/secrets/gateway.master.key).Trim()
$h = @{ Authorization = "Bearer $master" }
$body = @{ name = 'dsh-mobile' } | ConvertTo-Json
try {
  $tenant = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8080/api/v1/tenants -Headers $h -ContentType application/json -Body $body
} catch {
  $list = Invoke-RestMethod -Uri 'http://127.0.0.1:8080/api/v1/tenants?limit=100' -Headers $h
  $tenant = $list.items | Where-Object name -eq 'dsh-mobile' | Select-Object -First 1
}
```

创建 client key（明文只返回一次，直接写文件）：

```powershell
$keyBody = @{ name = 'dsh-mobile'; tenant_id = $tenant.id } | ConvertTo-Json
$created = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8080/api/v1/keys -Headers $h -ContentType application/json -Body $keyBody
[IO.File]::WriteAllText('deploy/secrets/gateway.client.key', $created.key)
```

注册模型（已存在则跳过）：

```powershell
$models = Invoke-RestMethod -Uri 'http://127.0.0.1:8080/api/v1/models?limit=100' -Headers $h
if (-not ($models.items | Where-Object id -eq 'deepseek-flash')) {
  $m = @{ id='deepseek-flash'; provider='deepseek'; upstream_model='deepseek-flash'; enabled=$true } | ConvertTo-Json
  Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8080/api/v1/models -Headers $h -ContentType application/json -Body $m | Out-Null
}
```

把 `gateway.client.key` 的内容写入 `.env` 的 `GATEAWAY_API_KEY`（不要打印），
然后启动应用：

```powershell
docker compose -f deploy/docker-compose.with-gateaway.yml up -d stt bridge web
```

## 6. 密钥文件

| 文件 | 用途 | 注意 |
| --- | --- | --- |
| `deploy/secrets/bridge.secret` | 手机访问 Bridge 的 Bearer token | 轮换后所有手机需重新输入 |
| `deploy/secrets/gateway.master.key` | GateAway 管理 API / UI 管理员 | 生产者密钥加密依赖它，勿随意更换 |
| `deploy/secrets/gateway.client.key` | DSH 推理用 client key | 泄漏后立即新建并 revoke 旧的 |
| `deploy/secrets/postgres.password` | Gateway Postgres 密码 | 已有数据卷不可直接换密码 |
| `deploy/secrets/gateway.deepseek.key` | 上游 DeepSeek Key | 可选，脚本从 env 写入 |
| `deploy/.env` | 运行时配置 | 含密钥，git-ignored |

## 7. 轮换与备份

- **Client key**：`POST /api/v1/keys` 创建新 key → 更新 `.env` 的
  `GATEAWAY_API_KEY` → `docker compose ... restart bridge` → 用
  `DELETE /api/v1/keys/{id}` revoke 旧 key。不要打印明文。
- **Bridge secret**：生成新值写入 `secrets/bridge.secret` 和 `.env`，重启
  bridge，并重新给手机配对。
- **Master key**：更新 `secrets/gateway.master.key` 和 `.env` 后重启 backend。
  若已有 provider 密钥被旧 master key 加密，先评估迁移/重新录入上游 key；
  不要在没有备份时轮换。
- **Postgres password**：已有数据卷修改需要同时 `ALTER ROLE` 和更新 `.env`；
  最简单是备份/导出后重建。不要只改 `.env`。
- 备份：`deploy/secrets/`、`deploy/.env`、`dsh-mobile_*` 卷、以及
  `llm-gateaway_pgdata`（如复用）。

## 8. 验证

```powershell
docker compose -f deploy/docker-compose.with-gateaway.yml ps
curl.exe -s http://127.0.0.1:8080/healthz
curl.exe -s http://127.0.0.1:8080/readyz

# client key 从文件读取，不打印
curl.exe -s -H "Authorization: Bearer $(Get-Content -Raw deploy/secrets/gateway.client.key)" http://127.0.0.1:8080/v1/models

curl.exe -k -s https://127.0.0.1:8443/api/health
```

期望：`healthz`/`readyz` 200；`/v1/models` 含 `deepseek-flash`；Bridge health
含 `agent: ready`、`stt.reachable: true`、`audio.ffmpeg: true`。最后在手机
`https://192.168.71.5:8443` 发一次真实语音/对话。

## 9. 故障排除

- **Docker Hub token/IPv6 失败**：使用本地镜像；或设置
  `NODE_IMAGE=docker.m.daocloud.io/library/node:22-bookworm-slim`、
  `CADDY_IMAGE=docker.m.daocloud.io/library/caddy:2-alpine`。
- **缺 `GATEWAY_DEEPSEEK_API_KEY`**：bootstrap 会直接失败；设置进程环境变量或
  写入 `.env` 后重跑。模型注册和推理都需要它。
- **8080/8443 被占用**：先停旧 `llm-gateaway`/app 栈；或改
  `GATEWAY_UI_PORT`/`WEB_PORT`，手机 URL 随之变化。
- **pgdata 冲突/密码错误**：不要同时运行两套 Gateway。全新用
  `dsh-mobile-gateway-pgdata/false`；复用用 `llm-gateaway_pgdata/true` 且
  `POSTGRES_PASSWORD` 必须匹配旧库。
- **DSH profile 初始化失败**：`docker compose ... logs bridge`；检查 npmmirror
  可达与 `dsh-home` 卷；删除 `dsh-mobile_dsh-home` 会重新下载 bundles。
- **Caddy 证书告警**：确认 `.certs/dev-cert.pem` 的 SAN 含
  `IP:192.168.71.5`，并已在手机安装 `.certs/ca.crt`。

## 10. 警告

- 默认拓扑与一体化拓扑不要同时运行。
- 切换前停止两套旧栈；否则 UI 端口和 Postgres 卷冲突。
- `-Force` 会重建全新 Gateway 数据库卷；已有 GateAway 数据请改用
  `-ExistingGateway` 并先备份。
- 本手册不包含任何真实密钥；示例中的 `<...>` 必须由你填写。

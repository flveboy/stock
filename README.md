# 持仓账本

一个部署在家庭 NAS 上的股票成本、做 T 测算与交易复盘工具。数据集中保存在 PostgreSQL，手机和电脑通过同一个地址访问同一份账本；Redis 用于登录会话和短期缓存。

## 主要功能

- 管理多只股票的起始持仓成本和股数
- 买入、卖出前实时预览佣金、过户费、印花税和操作后成本
- 做 T 测算只用于预览净收益、双边费用、保本价差和摊薄成本，不保存、不改变持仓
- 同一交易日内的真实买入和卖出自动按成交顺序撮合为做 T，支持部分股数和多笔成交
- 支持编辑真实交易，并在修改后重算后续成本和做 T 撮合
- 可使用券商实际佣金、过户费和印花税覆盖自动费用
- 做 T 撮合明细可查看每组买卖，单笔交易可设置不参与做 T
- 保存完整操作记录，按日期筛选并每页显示 6 条，记录再多也不会无限拉长页面
- 支持修正任意有效操作后的成本，并从修正点自动重算后续成本
- 成本变化折线图使用真实成交时间轴，做 T 标记与完成撮合的成交点重合
- 桌面端固定在一个视口，交易、图表和复盘区域独立布局与滚动
- PostgreSQL 持久化，支持多设备共享数据
- Redis 登录会话与数据缓存，Redis 丢失不会丢交易记录
- 单用户密码保护、登录限流和安全响应头
- JSON 全量备份/恢复，以及 PostgreSQL 数据库备份
- 默认沿用旧版参数：佣金 0.00854%（最低 5 元）、沪市过户费 0.001%、卖出印花税 0.05%

## 架构

```text
手机 / 电脑浏览器
        |
        v
Node.js 应用（页面 + API，默认端口 3000）
        |                      |
        v                      v
PostgreSQL                 Redis
永久股票与操作记录          登录会话与 60 秒缓存
```

PostgreSQL 和 Redis 都不暴露宿主机端口，只能由 Compose 内部的应用容器访问。

## 飞牛 NAS 部署

### 1. 准备项目目录

在飞牛文件管理中建立目录，例如：

```text
/vol1/1000/docker/stock-ledger
```

路径以你的实际存储空间为准。通过 Git 克隆项目，或下载项目压缩包并解压到该目录。

### 2. 设置密码

进入项目目录：

```bash
cp .env.example .env
```

编辑 `.env`，至少替换下面两项：

```dotenv
APP_PASSWORD=用于网页登录的高强度密码
POSTGRES_PASSWORD=数据库高强度密码
```

不要把 `.env` 上传到 GitHub。

### 3. 启动容器

在飞牛 Docker 的 Compose 页面导入 `compose.yaml`，或通过终端运行：

```bash
docker compose pull
docker compose up -d
```

飞牛只需要拉取预构建镜像，不需要安装 Node.js，也不要在飞牛上运行 `docker compose build`。应用镜像由 GitHub Actions 自动构建，同时支持常见的 x86_64 和 ARM64 NAS。

默认 `nas-docker` 标签始终指向最新版。需要固定版本和方便回滚时，可在 `.env` 中设置：

```dotenv
APP_IMAGE=ghcr.io/flveboy/stock:2.2.0
```

每个正式版本同时发布完整版本、次版本、主版本和滚动标签，例如 `2.2.0`、`2.2`、`2`、`nas-docker`。

查看状态：

```bash
docker compose ps
docker compose logs -f app
```

浏览器访问：

```text
http://NAS-IP:3000
```

如果 `3000` 端口被占用，可在 `.env` 中修改 `APP_PORT`。

### PostgreSQL 或 Redis 镜像代理返回 401

如果拉取 PostgreSQL 或 Redis 时出现类似错误：

```text
docker.fnnas.com/v2/library/postgres/manifests/17-alpine: 401 Unauthorized
```

这是飞牛内置 Docker Hub 代理失效，不是项目镜像标签错误。先在 `.env` 中覆盖 PostgreSQL 和 Redis 镜像地址，绕过 `docker.fnnas.com`：

```dotenv
POSTGRES_IMAGE=docker.1ms.run/library/postgres:17-alpine
REDIS_IMAGE=docker.1ms.run/library/redis:7.4-alpine
```

然后重新拉取并启动：

```bash
docker compose pull postgres redis
docker compose up -d
```

也可以在飞牛 Docker 的镜像仓库设置中移除或修复 `https://docker.fnnas.com`，恢复后继续使用 `.env.example` 里的官方默认镜像。第三方镜像加速地址只负责代理相同的公开镜像，长期部署建议在网络允许时切回 Docker Hub 官方源。

### 页面有内容但没有样式

`f611d8b` 之前的版本会在 HTTP 内网部署时把 CSS 请求强制升级为 HTTPS，表现为页面文字存在但排版和颜色全部消失。请拉取最新的 `codex/nas-docker` 分支并更新应用镜像：

```bash
git pull
docker compose pull app
docker compose up -d app
```

更新后可以用下面的命令确认安全策略中不再包含 `upgrade-insecure-requests`：

```bash
curl -I http://NAS-IP:应用端口/
```

## 数据保存位置

数据库通过绑定目录保存在项目文件夹中：

```text
data/postgres/   PostgreSQL 永久数据，最重要
data/redis/      Redis 会话和缓存
```

重新构建或删除应用容器不会删除这些目录。不要手工编辑 `data/postgres` 内的文件，也不要在 PostgreSQL 运行时直接复制该目录作为备份。

## 备份与恢复

应用左下角的“备份数据”会下载可读的 JSON 文件，适合日常迁移和恢复。

建议同时在飞牛 NAS 的计划任务中定期执行 PostgreSQL 备份：

```bash
mkdir -p backups
docker compose exec -T postgres pg_dump -U stock -d stock_ledger -Fc > backups/stock_ledger_$(date +%F).dump
```

恢复数据库前先停止应用写入，然后执行：

```bash
docker compose stop app
docker compose exec -T postgres pg_restore -U stock -d stock_ledger --clean --if-exists < backups/stock_ledger_2026-07-16.dump
docker compose start app
```

备份文件也应复制到 NAS 的另一个存储池或外部硬盘，单独保存在同一块硬盘上不能防止硬盘故障。

## 从旧版迁移

先在旧版页面点击“备份数据”导出 JSON。部署 NAS 版并登录后，点击“恢复数据”选择该文件，即可把股票、操作记录和费率写入 PostgreSQL。

## 反向代理与安全

- 家庭内网使用时也建议通过飞牛反向代理配置 HTTPS。
- 不要在路由器上直接暴露 PostgreSQL `5432` 或 Redis `6379`。
- 需要公网访问时，优先使用 WireGuard、Tailscale 等 VPN，不建议直接端口映射。
- 修改 `.env` 中的 `APP_PASSWORD` 并重启应用后，旧 Redis 会话会自动失效，所有设备需要使用新密码重新登录。

## 本地开发与测试

需要 Node.js 20 或更高版本。数据库环境建议直接启动 Compose：

```bash
npm install
npm test
docker compose up -d postgres redis
APP_PASSWORD=development-password \
DATABASE_URL=postgresql://stock:你的数据库密码@127.0.0.1:5432/stock_ledger \
REDIS_URL=redis://127.0.0.1:6379 \
npm run dev
```

常用检查：

```bash
npm test
npm run check
docker compose config
```

如需在本机自行构建完整 Compose 应用镜像，额外加载开发构建配置：

```bash
docker compose -f compose.yaml -f compose.build.yaml build app
docker compose -f compose.yaml -f compose.build.yaml up -d
```

## 成本计算口径

```text
剩余成本金额 = 原持仓成本金额 + 买入成交金额及费用 - 卖出净收入
新摊薄成本 = 剩余成本金额 / 剩余股数
实际做 T 收益 = 同日匹配股数的卖出净收入 - 买入支出（含双方按股分摊的费用）
做 T 成本变化直接来自真实买卖流水，不再额外写入一条成本记录
修正后成本金额 = 手动修正的每股成本 × 当时持仓股数，后续操作从该金额继续计算
```

升级后，旧版本保存的做 T 测算记录会自动停止计入成本、累计费用、图表和操作复盘；可在“做 T 测算”页签中选择清理。真实买卖记录不会被自动删除。

本项目用于个人记录和测算，不构成投资建议。手续费规则以券商实际账单为准。

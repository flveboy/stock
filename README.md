# 持仓账本

一个部署在家庭 NAS 上的股票成本、做 T 测算与交易复盘工具。数据集中保存在 PostgreSQL，手机和电脑通过同一个地址访问同一份账本；Redis 用于登录会话和短期缓存。

## 主要功能

- 管理多只股票的起始持仓成本和股数
- 买入、卖出前实时预览佣金、过户费、印花税和操作后成本
- 做 T 测算净收益、双边费用、保本价差和摊薄后的持仓成本
- 保存完整操作记录，按日期复盘，删除历史后自动重算后续成本
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
docker compose up -d --build
```

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

## 成本计算口径

```text
剩余成本金额 = 原持仓成本金额 + 买入成交金额及费用 - 卖出净收入
新摊薄成本 = 剩余成本金额 / 剩余股数
做 T 后成本 = 当前成本金额 - 做 T 净收益，再除以当前持仓股数
```

本项目用于个人记录和测算，不构成投资建议。手续费规则以券商实际账单为准。

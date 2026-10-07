# Ohimg

自托管的邀请制图床：图片和视频存储在服务器本地，外链公开，图库须登录。支持批量、拖拽、粘贴上传图片，以及管理员通过 Telegram Bot 保存图片和 MP4 视频、获取外链。

[Docker Hub 镜像](https://hub.docker.com/r/ohbaby/ohimg) · [GitHub 源码](https://github.com/ohbaby30/ohimg)

Vue 3 · TypeScript · Fastify · SQLite · Node.js 24 · Docker Compose。

## 镜像安装（推荐）

服务器安装 Docker 和 Docker Compose，并准备域名及 HTTPS 反向代理。镜像支持 `linux/amd64`、`linux/arm64`，不需要在服务器下载源码、安装 npm 依赖或编译。

下载以下文件，用 SSH 工具放到服务器同一个项目目录：

- [compose.hub.yml](https://raw.githubusercontent.com/ohbaby30/ohimg/main/compose.hub.yml)
- [.env.hub.example](https://raw.githubusercontent.com/ohbaby30/ohimg/main/.env.hub.example)
- [backup.sh](https://raw.githubusercontent.com/ohbaby30/ohimg/main/backup.sh)
- [restore.sh](https://raw.githubusercontent.com/ohbaby30/ohimg/main/restore.sh)
- 同机容器 NPM 另需 [compose.npm.yml](https://raw.githubusercontent.com/ohbaby30/ohimg/main/compose.npm.yml)

在服务器项目目录执行：

```sh
cp .env.hub.example .env
chmod 600 .env
openssl rand -hex 32
```

编辑 `.env`：`APP_URL` 填正式 HTTPS 地址，`APP_SECRET` 填刚生成的随机值。保留 `COMPOSE_FILE=compose.hub.yml`，镜像地址使用 `OHIMG_IMAGE=ohbaby/ohimg:stable`。然后启动并初始化管理员：

```sh
docker compose up -d
docker compose exec app node dist/server/cli.js init-admin
```

按提示设置管理员邮箱和密码；已有部署或恢复后不要再次初始化。

### 镜像标签

| 标签 | 用途 |
| --- | --- |
| `ohbaby/ohimg:stable` | 跟随经过发布验证的稳定版本 |
| `ohbaby/ohimg:1.0.0` | 固定首发版本，升级时自行修改版本号 |

## 更新与停止

镜像部署更新前先备份，再执行：

```sh
sh backup.sh
docker compose up -d
docker compose ps
```

镜像配置使用 `pull_policy: always`，执行 `up` 时检查并拉取镜像；不会在后台自动升级。固定版本只有修改 `OHIMG_IMAGE` 后才升级。新版本如要求调整配置，按该版本说明更新部署文件。

```sh
docker compose logs --tail=100 app
docker compose stop app
docker compose start app
# 结束容器和项目默认网络，保留命名数据卷
docker compose down
```

正常更新、停止不要使用 `down -v`。保留原 `.env`、`APP_SECRET`、`COMPOSE_PROJECT_NAME` 和数据卷，备份包含密钥，勿公开。更新可能短暂中断服务；切回旧镜像前确认数据库兼容性。

### 已有源码部署切换到镜像

先在原目录使用原配置运行 `sh backup.sh`，再放入上面的镜像部署文件。在原 `.env` 增加 `OHIMG_IMAGE=ohbaby/ohimg:stable`，把 `COMPOSE_FILE` 改为 `compose.hub.yml`；同机容器 NPM 使用 `compose.hub.yml:compose.npm.yml`。然后执行 `docker compose up -d`，验证原账号和图片外链。

不要用示例覆盖原 `.env`，不要改原项目名、密钥、域名、端口或 NPM 网络，不删除数据卷、不重新初始化管理员。保留原源码和备份便于恢复。

## 反向代理

- 同机 Nginx：转发到 `http://127.0.0.1:18080`。
- 同机容器 NPM：`.env` 设置 `COMPOSE_FILE=compose.hub.yml:compose.npm.yml`、`NPM_NETWORK=实际网络名`；转发到 `http://Ohimg-app:8080`。
- 异机 NPM：`BIND_IP` 填图床服务器的内网/VPN IP，转发到 `http://图床服务器IP:18080`。如必须使用公网地址，先将入口限制为 NPM 出口 IP。

`HOST_PORT` 默认 18080。域名 DNS 指向反代服务器，反代配置有效 HTTPS 证书，`APP_URL` 与实际访问域名一致。Nginx/NPM 设置 `client_max_body_size 25m;`。开启 Cloudflare 橙云时，反代证书有效后使用 Full (strict)。

## 使用

- 网页上传：JPEG、PNG、GIF、WebP，单图最多 20 MiB，每次选择最多 20 张；网页暂不支持视频。图库支持搜索、删除、复制直链及 Markdown、HTML、BBCode。
- 管理员配置 SMTP 后邀请用户，不开放注册；普通用户仅管理自己的图片，管理员可管理全站。
- Telegram Bot：在后台填写 BotFather 的 Token 和管理员数字 ID。ID 未知时先填 Token、开启并保存，私聊 Bot 发送 `/id`，再将返回数字填入后台。仅指定管理员可以上传；保留原图请以文件模式发送。
- Telegram 支持图片和 MP4，单文件最多 20 MB（20,000,000 字节）。这是当前 [Telegram Bot API 下载接口](https://core.telegram.org/bots/api#getfile)的限制。
- 删除后原外链在源站失效；他人已下载或另行缓存的副本无法撤回。

## 备份与迁移恢复

`sh backup.sh` 会短暂停止应用，生成一致的数据库、图片和配置备份，再恢复原运行状态。文件位于 `backups/日期时间/`：`database.sqlite`、`images.tar.gz`、`environment.env`。备份和恢复过程不会隐式拉取新版镜像。

迁移时先停止旧站，再备份，避免备份后继续写入：

```sh
docker compose stop app
sh backup.sh backups/migration
```

将三个备份文件下载保存，再用 SSH 工具上传到新服务器。新服务器准备镜像部署文件及 `.env`，沿用备份中的 `APP_SECRET` 和原域名；源站退出后再切换域名入口。目标必须使用空数据卷，不覆盖现有数据。

```sh
# 在新的恢复目录，先配置 .env，再拉取与备份兼容的镜像
# 迁移本版本可先固定 OHIMG_IMAGE=ohbaby/ohimg:1.0.0
docker compose pull app
sh restore.sh /备份目录
docker compose up -d
```

先恢复、再启动；使用原邮箱和密码登录，不初始化管理员。脚本拒绝非空卷，失败时先处理问题，不继续启动。若要在同一服务器试恢复，使用独立 Compose 项目名和端口，不改动原部署。

## 源码构建（可选）

服务器另需 Git：

```sh
git clone https://github.com/ohbaby30/ohimg.git Ohimg
cd Ohimg
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
```

填写 `.env` 中的域名和密钥后：

```sh
docker compose up -d --build
docker compose exec app node dist/server/cli.js init-admin
```

源码方式使用 `compose.yml`；同机容器 NPM 的 `COMPOSE_FILE` 为 `compose.yml:compose.npm.yml`。源码更新后使用 `docker compose up -d --build`，其他数据和备份规则相同。

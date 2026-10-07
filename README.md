# Ohimg

自托管的邀请制图床：图片和视频保存在服务器本地，外链公开，图库须登录。支持批量、拖拽、粘贴上传图片，以及管理员通过 Telegram Bot 保存图片和 MP4 视频、获取外链。

## 技术栈

Vue 3 · TypeScript · Fastify · SQLite · Node.js 24 · Docker Compose。

## 源码安装

服务器需安装 Git、Docker 和 Docker Compose，并准备域名及 HTTPS 反向代理。下载源码：

```sh
git clone https://github.com/ohbaby30/ohimg.git Ohimg
cd Ohimg
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
```

编辑 `.env`：`APP_URL` 填正式 HTTPS 地址，`APP_SECRET` 填刚生成的随机值。然后从源码构建并启动：

```sh
docker compose up -d --build
docker compose exec app node dist/server/cli.js init-admin
```

按提示设置管理员邮箱和密码。已有部署或从备份恢复后不要再次初始化。

### 反向代理

- 同机 Nginx：转发到 `http://127.0.0.1:18080`。
- 同机容器 NPM：`.env` 设置 `COMPOSE_FILE=compose.yml:compose.npm.yml` 和 `NPM_NETWORK=实际网络名`，再执行启动命令；转发到 `http://Ohimg-app:8080`。
- 异机 NPM：`BIND_IP` 填图床服务器的内网/VPN IP，转发到 `http://图床服务器IP:18080`。如必须走公网，先将入口限制为 NPM 出口 IP。

`HOST_PORT` 默认 18080。域名 DNS 指向反代服务器，配置有效 HTTPS 证书，`APP_URL` 与实际访问域名一致。Nginx/NPM 设置 `client_max_body_size 25m;`；开启 Cloudflare 橙云时，反代证书有效后使用 Full (strict)。

### 源码更新与停止

先备份，再更新源码并重建。保留原 `.env` 和数据卷：

```sh
sh backup.sh
# 更新源码后执行
docker compose up -d --build
docker compose ps
```

```sh
docker compose logs --tail=100 app
docker compose stop app
docker compose start app
# 结束容器和默认网络，保留命名数据卷
docker compose down
```

正常更新、停止不要使用 `down -v`。保留原 `APP_SECRET`、`COMPOSE_PROJECT_NAME`、域名和数据卷；备份包含密钥，勿公开。更新可能短暂中断服务。

## Docker 镜像部署

也可以通过 Docker 或 Docker Compose 使用预构建镜像，无需下载源码或在服务器编译。镜像支持 `linux/amd64`、`linux/arm64`。

**安装、更新、镜像标签及镜像方式的备份恢复，参见 [Docker Hub 部署说明](https://hub.docker.com/r/ohbaby/ohimg)。**

## 使用

- 网页上传：JPEG、PNG、GIF、WebP，单图最多 20 MiB，每次选择最多 20 张；网页暂不支持视频。图库支持搜索、删除、复制直链及 Markdown、HTML、BBCode。
- 管理员配置 SMTP 后邀请用户，不开放注册。普通用户仅管理自己的图片，管理员可管理全站。
- Telegram Bot：后台填写 BotFather 的 Token 和管理员数字 ID。ID 未知时先填 Token、开启并保存，私聊 Bot 发送 `/id`，再将返回数字填入后台。仅指定管理员可以上传；保留原图请以文件模式发送。
- Telegram 支持图片和 MP4，单文件最多 20 MB（20,000,000 字节），这是当前 [Telegram Bot API 下载接口](https://core.telegram.org/bots/api#getfile)的限制。
- 删除后原外链在源站失效；他人已下载或另行缓存的副本无法撤回。

## 源码方式备份与恢复

`sh backup.sh` 会短暂停止应用，生成一致的数据库、图片和配置备份，再恢复原运行状态。文件位于 `backups/日期时间/`：`database.sqlite`、`images.tar.gz`、`environment.env`。

迁移时先停止旧站，再备份，避免备份后继续写入：

```sh
docker compose stop app
sh backup.sh backups/migration
```

将三个备份文件下载保存，再用 SSH 工具上传到新服务器的源码目录。目标必须使用空数据卷。在新目录中从备份配置准备 `.env`，保留原 `APP_SECRET`，核对域名、端口、网络和 Compose 文件选择，然后执行：

```sh
# 先构建与备份兼容的版本；恢复前不要启动应用
docker compose build
sh restore.sh /备份目录
docker compose up -d
```

使用原邮箱和密码登录，不初始化管理员。脚本拒绝非空卷；恢复失败时先处理问题，不继续启动。在同一服务器试恢复时，使用独立 Compose 项目名和端口，不改动原部署。

## 镜像部署后的配置与维护

镜像初次安装请看 [Docker Hub](https://hub.docker.com/r/ohbaby/ohimg)。Docker Hub 的 `docker-compose.yaml` 样本可直接用于部署；仓库内 `compose.hub.yml` 是带健康检查、日志轮转及可配置端口的完整配置。采用仓库文件时使用 `.env.hub.example` 并保留 `COMPOSE_FILE=compose.hub.yml`；采用样本时默认读取 `docker-compose.yaml`。已有部署继续保留原项目名、密钥和数据卷，不用示例覆盖原 `.env`。

### 镜像方式反向代理

同机 Nginx 转发到 `http://127.0.0.1:18080`；异机代理按上方反代说明调整绑定地址和入口限制。Docker 命令部署直接修改 `-p` 的绑定地址与端口。

同机容器 NPM 另放入仓库的 `compose.npm.yml`，填写 `NPM_NETWORK`；使用完整配置时设置 `COMPOSE_FILE=compose.hub.yml:compose.npm.yml`，使用 Docker Hub 样本时设置 `COMPOSE_FILE=docker-compose.yaml:compose.npm.yml`。执行 `docker compose up -d`，NPM 转发到 `http://Ohimg-app:8080`。域名、证书、上传限制和 Cloudflare 设置同上。

### Compose 镜像更新

将仓库的 `backup.sh`、`restore.sh` 放到原部署目录。更新前先备份：

```sh
sh backup.sh
docker compose up -d
docker compose ps
```

`pull_policy: always` 在执行 `up` 时检查镜像，不在后台自动升级。`stable` 跟随稳定版本；锁定版本可使用 `ohbaby/ohimg:1.0.0`。完整配置修改 `OHIMG_IMAGE`，样本修改 `image` 字段。新版本要求调整配置时按版本说明处理；切回旧镜像前确认数据库兼容性。日志、停止和数据保留规则与上方源码方式相同。

### Compose 镜像备份与恢复

备份文件及保密要求与上方源码方式相同。备份和恢复脚本不会隐式拉取新版镜像。迁移时先停止旧站，再运行 `sh backup.sh backups/migration`，下载并保存三个备份文件。

在新服务器准备与原部署对应的 Compose 文件和 `.env`，沿用原 `APP_SECRET`，使用与备份兼容的固定镜像版本。目标须使用空卷：

```sh
docker compose pull app
sh restore.sh /备份目录
docker compose up -d
```

先恢复、再启动，使用原账号登录，不初始化管理员。脚本拒绝非空卷；失败时先处理问题，不继续启动。

### Docker 命令方式维护

`docker logs --tail=100 ohimg` 查看日志，`docker stop ohimg` 和 `docker start ohimg` 临时停止或启动。拉取新镜像不会自动替换运行中的容器；更新前备份两个命名卷和 `.env`，再按原参数重建容器并复用原卷。仓库的备份恢复脚本仅用于 Compose 方式，不能直接用于 `docker run` 部署。

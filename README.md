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
docker compose exec ohimg node dist/server/cli.js init-admin
```

按提示设置管理员邮箱和密码。已有部署或从备份恢复后不要再次初始化。

数据库保存在安装目录的 `data/db/`，图片和视频保存在 `data/images/`。启动时镜像自动准备数据目录，只运行一个图床容器。启动完成后，`docker compose ps` 显示 `Up` 和 `healthy`。安装目录可自行选择，配置使用相对路径。

### 反向代理

- 同机 Nginx：转发到 `http://127.0.0.1:18080`。
- 同机容器 NPM：`.env` 设置 `COMPOSE_FILE=compose.yml:compose.npm.yml` 和 `NPM_NETWORK=实际网络名`，再执行启动命令；转发到 `http://Ohimg-app:8080`。
- 异机 NPM：`BIND_IP` 填图床服务器的内网/VPN IP，转发到 `http://图床服务器IP:18080`。如必须走公网，先将入口限制为 NPM 出口 IP。

以上 `BIND_IP`、`HOST_PORT` 用于仓库的 Compose 配置；Docker Hub 样本直接修改 `ports`，Docker 命令部署修改 `-p`。异机反代可使用 `18080:8080`，并先在云防火墙/安全组中限制 TCP 18080 仅允许 NPM 的实际出口 IP；同机宿主机代理使用 `127.0.0.1:18080:8080`。同机容器 NPM 使用 Hub 样本时，设置 `COMPOSE_FILE=docker-compose.yaml:compose.npm.yml` 并配置上述 `NPM_NETWORK`；共享网络转发到 `Ohimg-app:8080`。

`HOST_PORT` 默认 18080。`APP_URL` 填浏览器最终访问地址，例如 `https://img.example.com`，不改变端口监听或给容器启用 HTTPS。域名 DNS 指向反代服务器，在反代配置有效 HTTPS 证书；NPM 上游协议选择 `http`。Nginx/NPM 设置 `client_max_body_size 25m;`；开启 Cloudflare 橙云时，反代证书有效后使用 Full (strict)。

### 源码更新与停止

先按下方整目录备份步骤保存当前站点，再更新源码并重建。保留原 `.env` 和整个 `data/`，不要用新源码覆盖或删除它们：

```sh
# 更新源码后执行
docker compose up -d --build --remove-orphans
docker compose ps
```

```sh
docker compose logs --tail=100 ohimg
docker compose stop ohimg
docker compose start ohimg
# 结束容器和默认网络，保留安装目录中的 data/
docker compose down
```

保留原 `APP_SECRET`、`COMPOSE_PROJECT_NAME` 和数据目录。更新可能短暂中断服务。

## Docker 镜像部署

也可以通过 Docker 或 Docker Compose 使用预构建镜像，无需下载源码或在服务器编译。镜像支持 `linux/amd64`、`linux/arm64`。

Docker 或 Docker Compose 的镜像部署步骤与配置样本，请查看 [Docker Hub 部署说明](https://hub.docker.com/r/ohbaby/ohimg)。

## 使用

- 网页上传：JPEG、PNG、GIF、WebP，单图最多 20 MiB，每次选择最多 20 张；网页暂不支持视频。图库支持搜索、删除、复制直链及 Markdown、HTML、BBCode。
- 管理员配置 SMTP 后邀请用户，不开放注册。普通用户仅管理自己的图片，管理员可管理全站。
- Telegram Bot：后台填写 BotFather 的 Token 和管理员数字 ID。ID 未知时先填 Token、开启并保存，私聊 Bot 发送 `/id`，再将返回数字填入后台。仅指定管理员可以上传；保留原图请以文件模式发送。
- Telegram 支持图片和 MP4，单文件最多 20 MB（20,000,000 字节），这是当前 [Telegram Bot API 下载接口](https://core.telegram.org/bots/api#getfile)的限制。
- 删除后原外链在源站失效；他人已下载或另行缓存的副本无法撤回。

## 备份与恢复

源码和镜像的 Compose 部署都把数据保存在安装目录里，可以直接复制整个目录备份和恢复。

1. 在安装目录执行 `docker compose stop ohimg`，等待命令成功，停止网页和 Bot 写入。
2. 用 SSH 工具下载整个安装目录，包括隐藏的 `.env`、Compose 配置及完整 `data/`。复制全部完成前不要启动应用；备份完成后可在原服务器执行 `docker compose start ohimg`。
3. 恢复时，将整个目录上传到新服务器的任意空目录，进入该目录。保留原 `APP_SECRET`，核对域名、端口和反代入口。
4. 镜像部署执行 `docker compose up -d`；源码部署执行 `docker compose up -d --build`。沿用备份对应的版本，确认恢复正常后再升级。

使用原账号登录，不重新初始化管理员。数据目录权限由镜像自动准备，无需手动 `chmod 777`。备份含账号数据和密钥，不能公开。只复制源码、只复制 SQLite 主文件或漏掉 `.env` 都不是完整备份；跨服务器切换前保持旧站停止，避免两个 Bot 实例同时接收。

Docker 命令部署同样使用安装目录的 `data/`：备份前执行 `docker stop ohimg`，恢复后按 [Docker Hub](https://hub.docker.com/r/ohbaby/ohimg) 的 Docker 部署命令启动，跳过管理员初始化。备份目录需保留原镜像版本和启动参数。

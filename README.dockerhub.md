# Ohimg Docker 镜像

邀请制个人图床，图片和 MP4 视频保存在服务器本地，公开外链、登录图库。镜像支持 `linux/amd64`、`linux/arm64`。

[GitHub 源码与功能说明](https://github.com/ohbaby30/ohimg)

## 镜像标签

| 标签 | 用途 |
| --- | --- |
| `ohbaby/ohimg:stable` | 跟随经过发布验证的稳定版本 |
| `ohbaby/ohimg:1.0.0` | 固定首发版本，升级时自行修改版本号 |

## Docker Compose 部署（推荐）

服务器需安装 Docker 和 Docker Compose，并准备域名及 HTTPS 反向代理。

下载以下部署文件，用 SSH 工具放到服务器同一个项目目录：

- [compose.hub.yml](https://raw.githubusercontent.com/ohbaby30/ohimg/main/compose.hub.yml)
- [.env.hub.example](https://raw.githubusercontent.com/ohbaby30/ohimg/main/.env.hub.example)
- [backup.sh](https://raw.githubusercontent.com/ohbaby30/ohimg/main/backup.sh)
- [restore.sh](https://raw.githubusercontent.com/ohbaby30/ohimg/main/restore.sh)
- 同机容器 NPM 另需 [compose.npm.yml](https://raw.githubusercontent.com/ohbaby30/ohimg/main/compose.npm.yml)

```sh
cp .env.hub.example .env
chmod 600 .env
openssl rand -hex 32
```

编辑 `.env`：`APP_URL` 填正式 HTTPS 地址，`APP_SECRET` 填刚生成的随机值；保留 `COMPOSE_FILE=compose.hub.yml` 和 `OHIMG_IMAGE=ohbaby/ohimg:stable`。首次启动：

```sh
docker compose up -d
docker compose exec app node dist/server/cli.js init-admin
```

按提示设置管理员邮箱和密码，已有部署或恢复后不要再次初始化。

### 更新、日志与停止

更新前先备份，再执行：

```sh
sh backup.sh
docker compose up -d
docker compose ps
```

`pull_policy: always` 在执行 `up` 时检查并拉取镜像，不会在后台自动升级。固定版本只有修改 `OHIMG_IMAGE` 后才升级；新版本如要求调整配置，按该版本说明更新部署文件。

```sh
docker compose logs --tail=100 app
docker compose stop app
docker compose start app
docker compose down
```

正常操作不要使用 `down -v`。保留原 `.env`、`APP_SECRET`、`COMPOSE_PROJECT_NAME` 和数据卷；更新可能短暂中断服务。切回旧镜像前核对数据库兼容性。

## Docker 命令部署

以下适用于全新部署；已有 Compose 部署继续使用原方式，不直接共用或替换其数据卷。

准备 `.env`，至少填写 `APP_URL` 和 `APP_SECRET`。密钥用 `openssl rand -hex 32` 生成，并设置文件权限为 `600`。执行：

```sh
docker pull ohbaby/ohimg:stable
docker run -d --name ohimg --restart unless-stopped --init \
  --security-opt no-new-privileges:true --cap-drop ALL \
  --env-file .env \
  -p 127.0.0.1:18080:8080 \
  -v ohimg-run-db:/data/db \
  -v ohimg-run-images:/data/images \
  ohbaby/ohimg:stable
docker exec -it ohimg node dist/server/cli.js init-admin
```

数据库和图片位于两个命名卷。上面的端口需直接在命令里调整；`.env` 中的 `HOST_PORT` 仅由 Compose 配置使用。

查看日志用 `docker logs --tail=100 ohimg`，临时停止/启动用 `docker stop ohimg` 和 `docker start ohimg`。镜像拉取不会自动替换运行中的容器；更新前应备份两个卷与 `.env`，再按相同参数重建容器并保留原卷。随包的 `backup.sh`、`restore.sh` 仅用于 Compose 部署；需要这些脚本时推荐采用上面的 Compose 方式。

## 反向代理

- 同机 Nginx：转发到 `http://127.0.0.1:18080`。
- 同机容器 NPM（Compose）：设置 `COMPOSE_FILE=compose.hub.yml:compose.npm.yml` 和 `NPM_NETWORK=实际网络名`，转发到 `http://Ohimg-app:8080`。
- 异机 NPM（Compose）：`BIND_IP` 填图床服务器的内网/VPN IP，转发到 `http://图床服务器IP:18080`。Docker 命令方式需要相应调整 `-p`；如必须走公网，先将入口限制为 NPM 出口 IP。

域名 DNS 指向反代服务器，配置有效 HTTPS 证书，`APP_URL` 与实际访问域名一致。Nginx/NPM 设置 `client_max_body_size 25m;`。开启 Cloudflare 橙云时，反代证书有效后使用 Full (strict)。

## Compose 备份与恢复

`sh backup.sh` 会短暂停止应用，生成一致备份，再恢复原运行状态。文件位于 `backups/日期时间/`：`database.sqlite`、`images.tar.gz`、`environment.env`。备份包含密钥，勿公开；备份和恢复过程不会隐式拉取新版镜像。

迁移时先停止旧站，再备份，避免备份后继续写入：

```sh
docker compose stop app
sh backup.sh backups/migration
```

将三个备份文件下载保存，再用 SSH 工具上传到新服务器。新服务器准备镜像部署文件和 `.env`，保留原 `APP_SECRET`，使用与备份兼容的固定镜像版本；目标必须使用空数据卷。

```sh
# 在新恢复目录配置好 .env 后，先拉取、恢复，再启动
docker compose pull app
sh restore.sh /备份目录
docker compose up -d
```

恢复后使用原邮箱和密码，不初始化管理员。脚本拒绝非空卷；失败时先处理问题，不继续启动。同一服务器试恢复时使用独立 Compose 项目名和端口，不改动原部署。

# Ohimg

邀请制个人图床，支持图片和 MP4 外链。镜像支持 `linux/amd64`、`linux/arm64`。

## 1．准备配置

安装 Docker；使用 Compose 方式还需安装 Docker Compose。在服务器新建项目目录，生成密钥：

```sh
mkdir ohimg
cd ohimg
openssl rand -hex 32
```

创建 `.env` 文件，将生成的密钥填入 `APP_SECRET`，`APP_URL` 填实际访问地址：

```dotenv
APP_URL=http://127.0.0.1:18080
APP_SECRET=
COMPOSE_PROJECT_NAME=ohimg
```

```sh
chmod 600 .env
```

## 2．选择一种部署方式

### Docker Compose（推荐）

在同一目录创建 `docker-compose.yaml`，填入以下内容：

```yaml
services:
  app:
    image: ohbaby/ohimg:stable
    pull_policy: always
    restart: unless-stopped
    env_file:
      - .env
    ports:
      - "127.0.0.1:18080:8080"
    volumes:
      - database:/data/db
      - images:/data/images
    init: true
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL

volumes:
  database:
  images:
```

启动并创建管理员：

```sh
docker compose up -d
docker compose exec app node dist/server/cli.js init-admin
```

### Docker

在包含 `.env` 的目录执行：

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

两种方式选择一种即可，按提示设置管理员邮箱和密码。

## 3．打开图床

默认仅监听服务器本机地址，可在服务器本机访问 `http://127.0.0.1:18080`。使用正式地址时，将 `APP_URL` 改为与实际访问地址一致。

源码及其他配置、维护说明请查看 [GitHub 仓库](https://github.com/ohbaby30/ohimg)。

# Ohimg

邀请制个人图床，支持图片和 MP4 外链。镜像支持 `linux/amd64`、`linux/arm64`。

## 1．准备配置

安装 Docker；使用 Compose 方式还需安装 Docker Compose。在服务器新建项目目录，生成密钥：

```sh
mkdir ohimg
cd ohimg
openssl rand -hex 32
```

准备实际访问地址。使用域名时，先配置该域名的 HTTPS 入口；相关配置请看 [GitHub 部署说明](https://github.com/ohbaby30/ohimg#镜像方式反向代理)。

创建 `.env` 文件，将生成的密钥填入 `APP_SECRET`，`APP_URL` 替换为浏览器实际使用的完整地址：

```dotenv
APP_URL=https://img.example.com
APP_SECRET=
COMPOSE_PROJECT_NAME=ohimg
```

`https://img.example.com` 是示例，须换成自己的 HTTPS 域名。仅通过 IP 和端口访问时，填 `http://服务器IP:18080`。`APP_URL` 用于外链和请求来源校验，不配置域名、证书或端口监听。

```sh
chmod 600 .env
```

下方示例发布服务器的 `18080` 端口。异机反代时，先在云防火墙/安全组中限制该端口只允许反代服务器的实际出口 IP；内网/VPN 部署也可绑定指定网卡。仅供服务器本机访问时，改为 `127.0.0.1:18080:8080`（Docker 命令对应 `-p 127.0.0.1:18080:8080`）。

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
      - "18080:8080"
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
  -p 18080:8080 \
  -v ohimg-run-db:/data/db \
  -v ohimg-run-images:/data/images \
  ohbaby/ohimg:stable
docker exec -it ohimg node dist/server/cli.js init-admin
```

两种方式选择一种即可，按提示设置管理员邮箱和密码。

## 3．打开图床

浏览器打开 `APP_URL` 中配置的地址。使用 HTTPS 域名时，HTTPS 入口需已转发到图床服务；只填 `APP_URL` 不会自动配置转发。直接访问 IP 和端口时，需允许客户端连接服务器的 `18080` 端口。

源码及其他配置、维护说明请查看 [GitHub 仓库](https://github.com/ohbaby30/ohimg)。

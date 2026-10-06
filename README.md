# ohimg

自托管的邀请制图床：图片和视频存储在服务器本地，外链公开，图库须登录。支持批量、拖拽、粘贴上传图片，以及管理员通过 Telegram Bot 保存图片和视频、获取外链。当前视频仅支持 MP4。

## 技术栈

Vue 3 · TypeScript · Fastify · SQLite · Node.js 24 · Docker Compose。

## 部署

服务器需安装 Git、Docker 和 Docker Compose，并准备域名及 HTTPS 反向代理。先下载源码：

```sh
git clone https://github.com/ohbaby30/ohimg.git
cd ohimg
```

创建配置并生成密钥：

```sh
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
```

编辑 `.env`：`APP_URL` 填正式 HTTPS 地址，`APP_SECRET` 填生成的随机值。然后执行：

```sh
docker compose up -d --build
docker compose exec app node dist/server/cli.js init-admin
```

按提示设置管理员邮箱和密码。反代配置：

- 同机 Nginx：转发到 `http://127.0.0.1:18080`。
- 同机容器 NPM：`.env` 设置 `COMPOSE_FILE=compose.yml:compose.npm.yml`、`NPM_NETWORK=实际网络名`，重新启动；转发到 `http://lightimg-app:8080`。
- 异机 NPM：`BIND_IP` 填图床的内网/VPN IP；走公网则填 `0.0.0.0`，并用云防火墙限制 18080 仅允许 NPM 出口 IP。转发到 `http://图床服务器IP:18080`。

域名和 HTTPS 配置：

1. 将域名的 DNS A 记录指向反代服务器的公网 IP；异机 NPM 填 NPM 服务器的 IP。
2. 在反代服务器为该域名配置有效的 HTTPS 证书；NPM 可在 SSL 页面申请 Let's Encrypt 证书并开启 Force SSL。
3. Nginx 配置 `client_max_body_size 25m;`；NPM 可在该代理的 Advanced 中填写同一行，为网页上传请求留出余量。
4. 如果开启 Cloudflare 橙云代理，在 NPM 的域名证书有效后，将 Cloudflare 的 SSL/TLS 加密模式设为 Full (strict)，让 Cloudflare 通过 HTTPS 连接 NPM 并验证证书。仅使用 DNS 解析时无需此设置。

## 使用

- 网页上传：登录后上传 JPEG、PNG、GIF、WebP，单图最多 20 MiB、每批 20 张；网页暂不支持上传视频。图库支持搜索、删除、复制直链及 Markdown/HTML/BBCode。
- 管理员配置 SMTP 后通过邮箱邀请用户，不开放注册；可管理全站图片和账号。
- Telegram Bot：填写 BotFather 的 Token 和管理员数字 ID。ID 未知时先填 Token、开启并保存，私聊 Bot 发送 `/id`，将返回数字填回后台。仅指定管理员可上传；保留原图请以文件模式发送。
- Telegram 文件限制：图片支持 JPEG、PNG、GIF、WebP，视频仅支持 MP4；图片和视频每个文件均最多 20 MB（20,000,000 字节）。该限制来自 [Telegram 官方 Bot API 下载接口](https://core.telegram.org/bots/api#getfile)，当前版本不支持更大视频或其他视频格式。

更新前运行 `sh backup.sh`，更新源码后执行 `docker compose up -d --build`。停止用 `docker compose down`，不要加 `-v`。保留原 `.env`、`APP_SECRET`、Compose 项目名称和数据卷；备份含密钥，勿公开。

# ohimg

自托管的邀请制图床：图片存储在 VPS 本地，外链公开，图库须登录。支持批量、拖拽、粘贴上传，以及管理员通过 Telegram Bot 保存图片和 MP4、获取外链。

## 技术栈

Vue 3 · TypeScript · Fastify · SQLite · Node.js 24 · Docker Compose。

## 部署

准备 Docker Compose、域名和 HTTPS 反向代理，在源码目录执行：

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

DNS 指向反代服务器，配置 HTTPS 证书和 `25m` 上传上限。使用 Cloudflare 代理时，源站有有效证书后选择 Full (strict)。

## 使用

- 登录上传 JPEG、PNG、GIF、WebP，单图最多 20 MiB、每批 20 张；图库支持搜索、删除、复制直链及 Markdown/HTML/BBCode。
- 管理员配置 SMTP 后通过邮箱邀请用户，不开放注册；可管理全站图片和账号。
- Telegram Bot 设置中填写 BotFather 的 Token 和管理员数字 ID。ID 未知时先填 Token、开启并保存，私聊 Bot 发送 `/id`，将返回数字填回后台。仅指定管理员可上传图片及 MP4，单文件最多 20 MB；保留原图请以文件模式发送。

更新前运行 `sh backup.sh`，更新源码后执行 `docker compose up -d --build`。停止用 `docker compose down`，不要加 `-v`。保留原 `.env`、`APP_SECRET`、Compose 项目名称和数据卷；备份含密钥，勿公开。

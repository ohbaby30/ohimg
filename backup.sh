#!/bin/sh
# Consistent offline backup, using the application's UID for all SQLite access.
set -eu
cd "$(dirname "$0")"
umask 077
backup_target=${1:-"backups/$(date +%Y%m%d-%H%M%S)"}
if [ -e "$backup_target" ]; then echo '备份目标已经存在，拒绝覆盖' >&2; exit 1; fi
mkdir -p "$backup_target"
backup_target=$(cd "$backup_target" && pwd)
backup_snapshot=".backup-$(date +%Y%m%d-%H%M%S)-$$.sqlite"
backup_created=0
app_running=$(docker compose ps --status running --services)
finish_backup() {
 if [ "$backup_created" = 1 ]; then docker compose run --rm --no-deps -T app node -e 'const fs=require("node:fs"); if(fs.existsSync(process.argv[1]))fs.unlinkSync(process.argv[1])' "/data/db/$backup_snapshot" >/dev/null 2>&1 || true; fi
 if [ "$app_running" = app ]; then docker compose up -d --no-build app; fi
}
trap finish_backup EXIT
docker compose stop app
docker compose run --rm --no-deps -T app node dist/server/cli.js backup "/data/db/$backup_snapshot"
backup_created=1
docker compose run --rm --no-deps -T app sh -c 'cat "$1"' sh "/data/db/$backup_snapshot" > "$backup_target/database.sqlite"
docker compose run --rm --no-deps -T app tar -C /data/images -czf - . > "$backup_target/images.tar.gz"
cp .env "$backup_target/environment.env"
chmod 600 "$backup_target/environment.env"
echo "备份完成：$backup_target（包含配置密钥，请妥善保管）"

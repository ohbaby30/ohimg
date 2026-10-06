#!/bin/sh
# Restore only into an empty project. Never overwrite an existing database/images.
set -eu
cd "$(dirname "$0")"
[ "$#" -eq 1 ] || { echo '用法：sh restore.sh 备份目录' >&2; exit 1; }
restore_source=$(cd "$1" && pwd)
[ -f "$restore_source/database.sqlite" ] && [ -f "$restore_source/images.tar.gz" ] || { echo '备份文件不完整' >&2; exit 1; }
app_running=$(docker compose ps --status running --services)
[ -z "$app_running" ] || { echo '应用正在运行。请在全新的恢复目录操作。' >&2; exit 1; }
docker compose run --rm --no-deps --user 0 --cap-add DAC_OVERRIDE --cap-add CHOWN --volume "$restore_source:/backup:ro" app sh -c '
 if [ -n "$(ls -A /data/db)" ] || [ -n "$(ls -A /data/images)" ]; then echo "目标卷非空，拒绝覆盖" >&2; exit 1; fi
 cp /backup/database.sqlite /data/db/lightimg.sqlite
 tar --no-same-owner -C /data/images -xzf /backup/images.tar.gz
 chown -R node:node /data/db /data/images
'
echo '恢复完成。确认 .env 中 APP_SECRET 与备份一致后，运行 docker compose up -d。'

#!/bin/sh
set -eu

if [ "$(id -u)" = 0 ]; then
  mkdir -p /data/db /data/images
  chown -R --no-dereference node:node /data/db /data/images
  exec gosu node "$@"
fi

exec "$@"

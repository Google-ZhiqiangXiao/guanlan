#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/check-node.mjs
if [[ ! -d node_modules ]]; then
  echo "正在根据 package-lock.json 安装依赖…"
  npm ci
fi
export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-47291}"
echo "构建观澜。进程只监听 ${HOST}:${PORT}。"
echo "这个地址属于你正在操作的这台电脑。它不是云端虚拟机，也不是给别人打开的公网链接。"
npm run build
echo "启动后，在这台电脑的浏览器打开 http://${HOST}:${PORT}"
exec npm run start

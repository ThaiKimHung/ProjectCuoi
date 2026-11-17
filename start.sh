#!/bin/bash
# Khởi chạy Wedding Photo Curator: cài thư viện và build giao diện khi cần, rồi chạy server.
set -eu

# Về thư mục gốc dự án, kể cả khi script được gọi qua symlink.
src="${BASH_SOURCE[0]:-$0}"
while [ -L "$src" ]; do
  dir="$(cd -P "$(dirname "$src")" && pwd)"
  src="$(readlink "$src")"
  case "$src" in /*) ;; *) src="$dir/$src" ;; esac
done
cd -P "$(dirname "$src")"

if ! command -v npm >/dev/null 2>&1; then
  echo "❌ Không tìm thấy Node.js (npm). Hãy cài Node.js rồi chạy lại." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "📦 Đang cài thư viện cho server..."
  npm install
fi
if [ ! -d client/node_modules ]; then
  echo "📦 Đang cài thư viện cho giao diện..."
  npm install --prefix client
fi

# Build giao diện lần đầu, hoặc khi mã nguồn mới hơn bản build hiện có.
dist=client/dist/index.html
if [ ! -f "$dist" ] || [ -n "$(find client/src client/index.html client/package.json \
    client/vite.config.js client/tailwind.config.js client/postcss.config.js \
    -type f -newer "$dist" -print -quit 2>/dev/null)" ]; then
  echo "🛠  Đang build giao diện..."
  npm run build
fi

# Cổng thực tế do server quyết định: PORT trong môi trường, rồi trong .env, mặc định 3001.
port="$(node --input-type=module -e "import { PORT } from './server/env.js'; console.log(PORT)")"
url="http://127.0.0.1:$port"

# Có phản hồi trên cổng nghĩa là cổng đã bị chiếm (thường là ứng dụng đang chạy sẵn).
probe() { curl --noproxy '*' -s -o /dev/null "$@" "$url"; }
have_curl=false
if command -v curl >/dev/null 2>&1; then have_curl=true; fi
if $have_curl && probe; then
  echo "⚠️  Cổng $port đang được dùng (có thể ứng dụng đã chạy). Mở $url hoặc chạy với PORT=<cổng khác>." >&2
  exit 1
fi

echo "💍 Đang khởi động Wedding Photo Curator (Local)..."
echo "🌐 Ứng dụng sẽ chạy tại: $url"

# Mở trình duyệt khi server đã sẵn sàng (giống start.bat).
opener="$(command -v open || command -v xdg-open || true)"
if $have_curl && [ -n "$opener" ]; then
  (
    i=0
    while [ "$i" -lt 60 ]; do
      if probe -f; then "$opener" "$url"; exit 0; fi
      sleep 0.5
      i=$((i + 1))
    done
  ) >/dev/null 2>&1 &
fi

exec npm start

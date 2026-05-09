#!/bin/bash
# 雙擊此檔啟動本地伺服器
cd "$(dirname "$0")"

# 找一個空的 port（從 8102 起試到 8110）
PORT=""
for try in 8102 8103 8104 8105 8106 8107 8108 8109 8110; do
  if ! lsof -ti :"$try" > /dev/null 2>&1; then
    PORT=$try
    break
  fi
done

if [ -z "$PORT" ]; then
  echo ""
  echo "  ⚠️ 8102~8110 都被佔住，可能有殘留伺服器。"
  echo "     執行：lsof -ti :8102 | xargs kill -9"
  echo ""
  read -p "  按 Enter 關閉..." dummy
  exit 1
fi

LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
echo "──────────────────────────────────────"
echo "  單字學習器啟動中... (port $PORT)"
echo "──────────────────────────────────────"
echo ""
echo "  💻 電腦：http://localhost:$PORT"
if [ -n "$LAN_IP" ]; then
  echo "  📱 手機：http://$LAN_IP:$PORT"
fi
echo ""
echo "  關閉：按 Ctrl+C"
echo "──────────────────────────────────────"
echo ""
python3 -m http.server "$PORT"

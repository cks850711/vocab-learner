# 單字學習器

個人英文單字學習網頁 app，支援電腦 Chrome 與手機瀏覽器。

## 功能

- 貼上一段英文（CNN 報導、YT 逐字稿等），自動解析單字
- 已知單字（GEPT 表內）→ 字卡複習，輸入字義+詞性比對正解
- 生字 → 自動加入個人單字庫，下次複習
- 等級重設機制：依「初級/中級/中高級」設定不同重學週期
- 學習熱力圖：13 週活動視覺化
- 真人發音：Web Speech API（macOS 可下載「進階版」語音）
- 學習紀錄存瀏覽器 localStorage，可匯入/匯出 JSON 跨設備

## 技術

純前端 HTML/JS，無 build step，無框架。詞形還原用 [compromise.js](https://github.com/spencermountain/compromise) (CDN)。

## 本機運行

```bash
./start.command          # macOS 雙擊啟動
# 或
python3 -m http.server 8102
```

開啟 `http://localhost:8102`。

## 字典來源

`gept.json` 為 GEPT 全民英檢初級/中級/中高級詞彙表，共 7824 個獨立單字。

# Claude Code 指引

## 語言規範

- 所有程式碼註解、commit message、文件皆使用**繁體中文**
- 變數名稱使用英文

## 專案說明

PromptFill 短網址服務 - Cloudflare Workers + D1（KV 只留著讀舊碼）

### API

| 端點 | 方法 | 說明 |
|------|------|------|
| `/api/short-url` | POST | 建立短網址（存儲模板 JSON） |
| `/api/template/:code` | GET | 取得模板資料 |
| `/s/:code` | GET | 依 `app` 重定向到對應站台 |

### 支援的 app

| `app` | 目的地 | state 必填欄位 |
|-------|--------|----------------|
| 未指定 | PromptFill | `template.name`、`template.content` |
| `line-chat-maker` | LINE 對話製造機 | `state.messages` |
| `glitch-music` | glitch-music | `state.title`、`state.src` |

分享一首歌時，音檔本身**不進資料庫**，`state.src` 只存音檔原本的網址；歌詞與 metadata 才存進來。

### 安全設定

- Origin 白名單：僅允許 `yazelin.github.io`
- CORS 設定已配置

### 部署

```bash
npx wrangler deploy
```

# Claude Code 指引

## 語言規範

- 所有程式碼註解、commit message、文件皆使用**繁體中文**
- 變數名稱使用英文

## 專案說明

PromptFill 短網址服務 - 使用 Cloudflare Workers + KV

### API

| 端點 | 方法 | 說明 |
|------|------|------|
| `/api/short-url` | POST | 建立短網址（存儲模板 JSON） |
| `/api/template/:code` | GET | 取得模板資料 |
| `/s/:code` | GET | 重定向到 PromptFill |

### 安全設定

- Origin 白名單：僅允許 `yazelin.github.io`
- CORS 設定已配置

### 部署

```bash
npx wrangler deploy
```

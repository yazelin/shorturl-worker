# ShortURL Worker

PromptFill 短網址服務 - 使用 Cloudflare Workers + KV

## 功能

- 建立短網址，存儲完整模板 JSON
- 短網址重新導向到 PromptFill
- Rate Limiting 防護（每 IP 每分鐘 10 次）
- GitHub Actions 自動部署

## 部署方式

### 自動部署（目前使用）

Push 到 `main` 分支會自動透過 GitHub Actions 部署。

需要設定 GitHub Secret：
- `CLOUDFLARE_API_TOKEN`：從 [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) 建立

### 手動部署

```bash
npm install
npx wrangler login
npx wrangler deploy
```

## 首次設定（已完成）

1. 註冊 Cloudflare：https://dash.cloudflare.com/sign-up
2. 建立 KV：`npx wrangler kv:namespace create "URLS"`
3. 更新 `wrangler.toml` 的 KV id

## API 說明

### 建立短網址

```http
POST /api/short-url
Content-Type: application/json

{
  "template": {
    "name": "模板名稱",
    "content": "模板內容"
  },
  "banks": {},
  "defaults": {}
}
```

回應：
```json
{
  "shortUrl": "https://shorturl.yazelinj303.workers.dev/s/abc123",
  "code": "abc123",
  "expiresIn": "1 year"
}
```

### 取得模板資料

```http
GET /api/template/:code
```

### 短網址重新導向

```
GET /s/:code  →  302 重新導向到 PromptFill/?id=code
```

## 免費額度

Cloudflare Workers 免費方案：
- **請求數**：每天 100,000 次
- **KV 儲存**：1 GB
- **KV 讀取**：每天 100,000 次
- **KV 寫入**：每天 1,000 次

## 安全機制

- **Origin 白名單**：僅允許 `yazelin.github.io`
- **Rate Limiting**：每 IP 每 60 秒最多 10 次請求

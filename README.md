# ShortURL Worker

PromptFill 短網址服務 - 使用 Cloudflare Workers + KV

## 功能

- 建立短網址，存儲完整模板 JSON
- 短網址重新導向到 PromptFill
- CORS 圖片代理（繞過跨域限制）
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

## 首次設定

如果要從零開始建立此專案，請依照以下步驟：

### 1. 註冊 Cloudflare（免費）

前往 https://dash.cloudflare.com/sign-up 註冊帳號

### 2. 安裝相依套件

```bash
cd shorturl-worker
npm install
```

### 3. 登入 Cloudflare

```bash
npx wrangler login
```

會開啟瀏覽器進行授權。

### 4. 建立 KV 儲存空間

```bash
npx wrangler kv:namespace create "URLS"
```

會輸出類似：
```
{ binding = "URLS", id = "abc123xxxxxxxxx" }
```

### 5. 更新設定

編輯 `wrangler.toml`，把 id 換成上一步取得的值：

```toml
[[kv_namespaces]]
binding = "URLS"
id = "abc123xxxxxxxxx"  # <-- 換成你的 id
```

### 6. 本機測試

```bash
npm run dev
```

### 7. 部署到 Cloudflare

```bash
npx wrangler deploy
```

部署成功後會顯示 Worker URL，例如：
```
https://shorturl.your-subdomain.workers.dev
```

### 8. 設定 GitHub Actions 自動部署（選用）

1. 前往 [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) 建立 Token
   - 使用「Edit Cloudflare Workers」範本
2. 在 GitHub Repo → Settings → Secrets and variables → Actions
3. 新增 Secret：`CLOUDFLARE_API_TOKEN`

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

### CORS 圖片代理

繞過跨域限制，代理取得外部圖片：

```http
GET /api/proxy?url=https://example.com/image.jpg
```

回應：
- 原始圖片內容
- 附加 CORS headers
- 快取 1 天

安全限制：
- 僅允許 `yazelin.github.io` Origin
- 只允許 http/https 協議

## 免費額度

Cloudflare Workers 免費方案：
- **請求數**：每天 100,000 次
- **KV 儲存**：1 GB
- **KV 讀取**：每天 100,000 次
- **KV 寫入**：每天 1,000 次

## 安全機制

- **Origin 白名單**：僅允許 `yazelin.github.io`
- **Rate Limiting**：每 IP 每 60 秒最多 10 次請求

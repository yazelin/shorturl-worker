# ShortURL Worker

PromptFill 短網址服務 - 使用 Cloudflare Workers + KV

## 部署步驟

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

會開啟瀏覽器讓你授權。

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
npm run deploy
```

部署成功後會顯示 Worker URL：
```
https://shorturl.your-account.workers.dev
```

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
  "shortUrl": "https://shorturl.xxx.workers.dev/s/abc123",
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

個人使用完全足夠！

## 自訂網域（選用）

如果你有自己的網域，可以在 Cloudflare Dashboard 設定：

1. Workers & Pages → 你的 Worker → Settings → Triggers
2. Add Custom Domain
3. 輸入你的網域（如 `s.yourdomain.com`）

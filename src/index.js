/**
 * ShortURL Worker - PromptFill 模板分享服務
 *
 * 直接存儲模板 JSON 資料到 KV，不需要壓縮到 URL
 *
 * API:
 *   POST /api/short-url      - 建立短網址（存儲模板資料）
 *   GET  /api/template/:code - 取得模板資料
 *   GET  /s/:code            - 重定向到 PromptFill
 */

// 允許的來源
const ALLOWED_ORIGINS = [
  'https://yazelin.github.io',
];

// PromptFill 網址
const PROMPTFILL_URL = 'https://yazelin.github.io/PromptFill/';

// ====== Rate Limiting（記憶體方案）======
const RATE_LIMIT = 10;          // 每個 IP 在時間窗口內最多請求次數
const RATE_WINDOW_MS = 60000;   // 時間窗口：60 秒
const rateLimitMap = new Map();

/**
 * 檢查是否超過請求限制
 */
function checkRateLimit(ip) {
  const now = Date.now();

  // 定期清理過期記錄（約 1% 機率）
  if (Math.random() < 0.01) {
    for (const [key, val] of rateLimitMap) {
      if (now - val.start > RATE_WINDOW_MS) {
        rateLimitMap.delete(key);
      }
    }
  }

  const record = rateLimitMap.get(ip);

  // 新 IP 或已過期，重置計數
  if (!record || now - record.start > RATE_WINDOW_MS) {
    rateLimitMap.set(ip, { start: now, count: 1 });
    return true;
  }

  // 超過限制
  if (record.count >= RATE_LIMIT) {
    return false;
  }

  // 增加計數
  record.count++;
  return true;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    // CORS 預檢請求
    if (request.method === 'OPTIONS') {
      return handleCORS(origin);
    }

    // POST /api/short-url - 建立短網址（存儲模板資料）
    if (request.method === 'POST' && url.pathname === '/api/short-url') {
      if (!isAllowedOrigin(origin)) {
        return jsonResponse({ error: 'Forbidden: Origin not allowed' }, 403, origin);
      }
      return handleCreateShortUrl(request, env, url, origin);
    }

    // GET /api/template/:code - 取得模板資料
    if (request.method === 'GET' && url.pathname.startsWith('/api/template/')) {
      return handleGetTemplate(request, env, url, origin);
    }

    // GET /s/:code - 重定向到 PromptFill
    if (url.pathname.startsWith('/s/')) {
      return handleRedirect(request, env, url);
    }

    // GET / - 首頁狀態
    if (url.pathname === '/') {
      return jsonResponse({
        service: 'PromptFill ShortURL',
        status: 'ok',
        endpoints: {
          create: 'POST /api/short-url',
          getTemplate: 'GET /api/template/:code',
          redirect: 'GET /s/:code'
        }
      }, 200, origin);
    }

    return new Response('Not Found', { status: 404 });
  }
};

/**
 * 檢查來源是否允許
 */
function isAllowedOrigin(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGINS.some(allowed => origin.startsWith(allowed));
}

/**
 * 處理 CORS
 */
function handleCORS(origin) {
  const allowedOrigin = isAllowedOrigin(origin) ? origin : ALLOWED_ORIGINS[0];
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    }
  });
}

/**
 * 建立短網址 - 存儲完整模板資料
 */
async function handleCreateShortUrl(request, env, url, origin) {
  // Rate Limiting 檢查
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!checkRateLimit(ip)) {
    return jsonResponse({ error: 'Too many requests. Please try again later.' }, 429, origin);
  }

  try {
    const body = await request.json();

    // 驗證必要欄位
    if (!body.template || !body.template.name || !body.template.content) {
      return jsonResponse({ error: 'Missing required fields: template.name, template.content' }, 400, origin);
    }

    // 生成唯一短碼
    let code;
    let attempts = 0;
    const maxAttempts = 5;

    do {
      code = generateCode(6);
      const existing = await env.URLS.get(code);
      if (!existing) break;
      attempts++;
    } while (attempts < maxAttempts);

    if (attempts >= maxAttempts) {
      return jsonResponse({ error: 'Failed to generate unique code' }, 500, origin);
    }

    // 準備存儲的資料
    const storedData = {
      template: body.template,
      banks: body.banks || {},
      defaults: body.defaults || {},
      createdAt: new Date().toISOString(),
    };

    // 存入 KV（保存 1 年）
    await env.URLS.put(code, JSON.stringify(storedData), {
      expirationTtl: 365 * 24 * 60 * 60
    });

    // 回傳短網址
    const shortUrl = `${url.origin}/s/${code}`;

    return jsonResponse({
      shortUrl,
      code,
      expiresIn: '1 year'
    }, 200, origin);

  } catch (err) {
    console.error('Create short URL error:', err);
    return jsonResponse({ error: 'Internal server error' }, 500, origin);
  }
}

/**
 * 取得模板資料
 */
async function handleGetTemplate(request, env, url, origin) {
  const code = url.pathname.replace('/api/template/', '').replace('/', '');

  if (!code) {
    return jsonResponse({ error: 'Missing code' }, 400, origin);
  }

  const data = await env.URLS.get(code);

  if (!data) {
    return jsonResponse({ error: 'Template not found or expired' }, 404, origin);
  }

  try {
    const parsed = JSON.parse(data);
    return jsonResponse(parsed, 200, origin);
  } catch {
    return jsonResponse({ error: 'Invalid stored data' }, 500, origin);
  }
}

/**
 * 處理重定向 - 跳轉到 PromptFill 並帶上 id 參數
 */
async function handleRedirect(request, env, url) {
  const code = url.pathname.replace('/s/', '').replace('/', '');

  if (!code) {
    return new Response('Missing code', { status: 400 });
  }

  // 檢查資料是否存在
  const data = await env.URLS.get(code);

  if (!data) {
    return new Response('Short URL not found or expired', { status: 404 });
  }

  // 重定向到 PromptFill，帶上 id 參數
  const redirectUrl = `${PROMPTFILL_URL}?id=${code}`;
  return Response.redirect(redirectUrl, 302);
}

/**
 * 生成隨機短碼
 */
function generateCode(length = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  for (let i = 0; i < length; i++) {
    code += chars[array[i] % chars.length];
  }
  return code;
}

/**
 * JSON 回應
 */
function jsonResponse(data, status = 200, origin = '') {
  const allowedOrigin = isAllowedOrigin(origin) ? origin : ALLOWED_ORIGINS[0];
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': allowedOrigin,
    }
  });
}

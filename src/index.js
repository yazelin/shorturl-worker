/**
 * ShortURL Worker - PromptFill 模板分享服務 + Image Bed 圖床代理
 *
 * 直接存儲模板 JSON 資料到 KV，不需要壓縮到 URL
 *
 * API:
 *   POST /api/short-url        - 建立短網址（存儲模板資料）
 *   GET  /api/template/:code   - 取得模板資料
 *   GET  /api/proxy?url=...    - CORS 圖片代理
 *   POST /api/upload-release   - GitHub Release 上傳代理（圖床用）
 *   GET  /s/:code              - 重定向到對應的 app（PromptFill / line-chat-maker / glitch-music）
 */

// 允許的圖床 Repo（安全限制）
const ALLOWED_IMAGE_REPOS = [
  'yazelin/image-bed',
];

// 允許的來源
const ALLOWED_ORIGINS = [
  'https://yazelin.github.io',
];

// PromptFill 網址
const PROMPTFILL_URL = 'https://yazelin.github.io/PromptFill/';

// LINE 對話製造機網址
const LINE_CHAT_MAKER_URL = 'https://yazelin.github.io/line-chat-maker/';

// glitch-music 網址（分享一首歌：點開就播，帶歌詞）
const GLITCH_MUSIC_URL = 'https://yazelin.github.io/glitch-music/';

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

    // GET /api/proxy?url=... - CORS 圖片代理
    if (request.method === 'GET' && url.pathname === '/api/proxy') {
      if (!isAllowedOrigin(origin)) {
        return new Response('Forbidden: Origin not allowed', { status: 403 });
      }
      return handleProxy(request, url, origin);
    }

    // POST /api/upload-release - GitHub Release 上傳代理（圖床用）
    if (request.method === 'POST' && url.pathname === '/api/upload-release') {
      if (!isAllowedOrigin(origin)) {
        return jsonResponse({ error: 'Forbidden: Origin not allowed' }, 403, origin);
      }
      return handleUploadRelease(request, origin);
    }

    // DELETE /api/delete-asset - GitHub Release 刪除代理（圖床用）
    if (request.method === 'DELETE' && url.pathname === '/api/delete-asset') {
      if (!isAllowedOrigin(origin)) {
        return jsonResponse({ error: 'Forbidden: Origin not allowed' }, 403, origin);
      }
      return handleDeleteAsset(request, url, origin);
    }

    // GET /s/:code - 重定向到 PromptFill
    if (url.pathname.startsWith('/s/')) {
      return handleRedirect(request, env, url);
    }

    // GET / - 首頁狀態
    if (url.pathname === '/') {
      return jsonResponse({
        service: 'PromptFill ShortURL + Image Bed Proxy',
        status: 'ok',
        endpoints: {
          create: 'POST /api/short-url',
          getTemplate: 'GET /api/template/:code',
          proxy: 'GET /api/proxy?url=...',
          uploadRelease: 'POST /api/upload-release?repo=...&releaseId=...&filename=...&token=...',
          deleteAsset: 'DELETE /api/delete-asset?repo=...&assetId=...&token=...',
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
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    }
  });
}

/**
 * 建立短網址 - 存儲完整模板資料
 */
// ====== D1 儲存層(2026-07 遷移:寫入走 D1+內容去重;KV 只留舊碼回退)======
async function contentCode(content) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function getStored(env, code) {
  const row = await env.DB.prepare('SELECT data, expires_at FROM shorturls WHERE code = ?').bind(code).first();
  if (row) {
    if (row.expires_at && row.expires_at < new Date().toISOString()) {
      await env.DB.prepare('DELETE FROM shorturls WHERE code = ?').bind(code).run();
      return null;
    }
    return row.data;
  }
  // 舊短碼回退(KV,自帶 TTL)
  return env.URLS.get(code);
}

async function handleCreateShortUrl(request, env, url, origin) {
  // Rate Limiting 檢查
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!checkRateLimit(ip)) {
    return jsonResponse({ error: 'Too many requests. Please try again later.' }, 429, origin);
  }

  try {
    const body = await request.json();

    // line-chat-maker 分享:存 {app, state}
    let storedData = null;
    if (body.app === 'line-chat-maker') {
      if (!body.state || !Array.isArray(body.state.messages)) {
        return jsonResponse({ error: 'Missing required fields: state.messages' }, 400, origin);
      }
      if (JSON.stringify(body.state).length > 2000000) {
        return jsonResponse({ error: 'State too large (max 2MB)' }, 400, origin);
      }
      storedData = { app: 'line-chat-maker', state: body.state, createdAt: new Date().toISOString() };
    } else if (body.app === 'glitch-music') {
      // 分享一首歌:state 存曲目 metadata 與歌詞,音檔本身留在原本的網址
      // (3 MB 的 mp3 不進資料庫,只存 src)
      if (!body.state || !body.state.title || !body.state.src) {
        return jsonResponse({ error: 'Missing required fields: state.title, state.src' }, 400, origin);
      }
      if (JSON.stringify(body.state).length > 200000) {
        return jsonResponse({ error: 'State too large (max 200KB)' }, 400, origin);
      }
      storedData = { app: 'glitch-music', state: body.state, createdAt: new Date().toISOString() };
    } else if (!body.template || !body.template.name || !body.template.content) {
      // 預設(PromptFill)驗證
      return jsonResponse({ error: 'Missing required fields: template.name, template.content' }, 400, origin);
    }

    // 內容雜湊短碼:同內容永遠同碼(去重,省寫入與儲存)
    const isStateApp = body.app === 'line-chat-maker' || body.app === 'glitch-music';
    const contentJson = isStateApp
      ? JSON.stringify(body.state)
      : JSON.stringify({ template: body.template, banks: body.banks || {}, defaults: body.defaults || {} });
    const fullHash = await contentCode(contentJson);
    let code = null;
    for (const len of [8, 12, 16]) {
      const cand = fullHash.slice(0, len);
      const row = await env.DB.prepare('SELECT data FROM shorturls WHERE code = ?').bind(cand).first();
      if (!row) { code = cand; break; }
      try {
        const parsed = JSON.parse(row.data);
        const storedIsStateApp = parsed.app === 'line-chat-maker' || parsed.app === 'glitch-music';
        const stored = storedIsStateApp
          ? JSON.stringify(parsed.state)
          : JSON.stringify({ template: parsed.template, banks: parsed.banks || {}, defaults: parsed.defaults || {} });
        if (stored === contentJson) {
          // 內容相同:直接回舊碼,不重寫
          return jsonResponse({ shortUrl: `${url.origin}/s/${cand}`, code: cand, expiresIn: '1 year', dedup: true }, 200, origin);
        }
      } catch {}
    }
    if (!code) {
      return jsonResponse({ error: 'Failed to generate unique code' }, 500, origin);
    }

    // 準備存儲的資料(PromptFill 預設)
    if (!storedData) {
      storedData = {
        template: body.template,
        banks: body.banks || {},
        defaults: body.defaults || {},
        createdAt: new Date().toISOString(),
      };
    }

    // 存入 D1(保存 1 年;寫入額度 10 萬/天,不再吃 KV 的 1 千/天)
    const nowIso = new Date().toISOString();
    const expIso = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare('INSERT INTO shorturls (code, data, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(code, JSON.stringify(storedData), nowIso, expIso).run();

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

  const data = await getStored(env, code);

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

  // 檢查資料是否存在(D1 優先,KV 舊碼回退)
  const data = await getStored(env, code);

  if (!data) {
    return new Response('Short URL not found or expired', { status: 404 });
  }

  // 依 app 決定目的地(預設 PromptFill)
  let target = PROMPTFILL_URL;
  try {
    const parsed = JSON.parse(data);
    if (parsed.app === 'line-chat-maker') target = LINE_CHAT_MAKER_URL;
    else if (parsed.app === 'glitch-music') target = GLITCH_MUSIC_URL;
  } catch {}
  const redirectUrl = `${target}?id=${code}`;
  return Response.redirect(redirectUrl, 302);
}

/**
 * CORS 圖片代理 - 繞過跨域限制
 */
async function handleProxy(request, url, origin) {
  const targetUrl = url.searchParams.get('url');

  if (!targetUrl) {
    return new Response('Missing url parameter', { status: 400 });
  }

  // 驗證是否為有效的 URL
  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return new Response('Invalid URL', { status: 400 });
  }

  // 只允許 http/https 協議
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return new Response('Only HTTP/HTTPS URLs are allowed', { status: 400 });
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'PromptFill-Proxy/1.0',
      },
    });

    if (!response.ok) {
      return new Response(`Upstream error: ${response.status}`, { status: response.status });
    }

    const contentType = response.headers.get('Content-Type') || 'application/octet-stream';

    return new Response(response.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': origin,
        'Cache-Control': 'public, max-age=86400', // 快取 1 天
      },
    });
  } catch (err) {
    console.error('Proxy fetch error:', err);
    return new Response('Failed to fetch resource', { status: 502 });
  }
}

/**
 * GitHub Release Asset 刪除代理 - 繞過 CORS 限制（圖床用）
 */
async function handleDeleteAsset(request, url, origin) {
  // Rate Limiting 檢查
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!checkRateLimit(ip)) {
    return jsonResponse({ error: 'Too many requests. Please try again later.' }, 429, origin);
  }

  try {
    const repo = url.searchParams.get('repo');
    const assetId = url.searchParams.get('assetId');
    const token = url.searchParams.get('token');

    // 驗證必要參數
    if (!repo || !assetId || !token) {
      return jsonResponse({ error: 'Missing required parameters: repo, assetId, token' }, 400, origin);
    }

    // 安全檢查：只允許特定 repo
    if (!ALLOWED_IMAGE_REPOS.includes(repo)) {
      return jsonResponse({ error: 'Forbidden: Repository not allowed' }, 403, origin);
    }

    // 轉發刪除請求到 GitHub
    const deleteUrl = `https://api.github.com/repos/${repo}/releases/assets/${assetId}`;

    const githubRes = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'ImageBed-Worker/1.0',
      },
    });

    // 204 = 成功刪除
    if (githubRes.status === 204) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': origin,
        },
      });
    }

    // 其他狀態
    const responseData = await githubRes.json().catch(() => ({}));
    return new Response(JSON.stringify(responseData), {
      status: githubRes.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin,
      },
    });

  } catch (err) {
    console.error('Delete asset error:', err);
    return jsonResponse({ error: 'Delete failed: ' + err.message }, 500, origin);
  }
}

/**
 * GitHub Release 上傳代理 - 繞過 CORS 限制（圖床用）
 */
async function handleUploadRelease(request, origin) {
  // Rate Limiting 檢查
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!checkRateLimit(ip)) {
    return jsonResponse({ error: 'Too many requests. Please try again later.' }, 429, origin);
  }

  try {
    // 從 URL 參數取得 metadata
    const url = new URL(request.url);
    const repo = url.searchParams.get('repo');
    const releaseId = url.searchParams.get('releaseId');
    const filename = url.searchParams.get('filename');
    const token = url.searchParams.get('token');

    // 驗證必要參數
    if (!repo || !releaseId || !filename || !token) {
      return jsonResponse({ error: 'Missing required parameters: repo, releaseId, filename, token' }, 400, origin);
    }

    // 安全檢查：只允許特定 repo
    if (!ALLOWED_IMAGE_REPOS.includes(repo)) {
      return jsonResponse({ error: 'Forbidden: Repository not allowed' }, 403, origin);
    }

    // 取得檔案內容
    const fileData = await request.arrayBuffer();
    const contentType = request.headers.get('Content-Type') || 'application/octet-stream';

    // 轉發到 GitHub
    const uploadUrl = `https://uploads.github.com/repos/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(filename)}`;

    const githubRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Content-Type': contentType,
        'Content-Length': fileData.byteLength.toString(),
      },
      body: fileData,
    });

    // 回傳 GitHub 的回應
    const responseData = await githubRes.json();

    return new Response(JSON.stringify(responseData), {
      status: githubRes.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin,
      },
    });

  } catch (err) {
    console.error('Upload release error:', err);
    return jsonResponse({ error: 'Upload failed: ' + err.message }, 500, origin);
  }
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

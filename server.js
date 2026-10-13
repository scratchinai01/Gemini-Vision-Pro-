// Gemini Vision Pro — Cloud Run 伺服器
// 提供 public/ 的網頁，並代為呼叫 Gemini API（金鑰只存在伺服器環境變數，不會送到瀏覽器）
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = (process.env.GEMINI_API_KEY || "").trim();
const MODELS = {
  text: process.env.GEMINI_MODEL || "gemini-3.8-flash",
  tts: process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-lite-tts",
};
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS) || 120_000;
// 文字模型的思考程度：low 最快；可設 medium / high 換取更深入的內容
const THINKING_LEVEL = process.env.GEMINI_THINKING_LEVEL || "low";
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN) || 30;

// 通行碼：多組請用逗號分隔，例如 ACCESS_CODES=7A-star,7B-moon。留空代表不需要通行碼。
const ACCESS_CODES = (process.env.ACCESS_CODES || "").split(",").map((c) => c.trim()).filter(Boolean);
const SESSION_DAYS = Number(process.env.SESSION_DAYS) || 30;
const COOKIE = "gvp_pass";
// 更換通行碼時，舊的登入狀態會自動失效
const SECRET = crypto
  .createHash("sha256")
  .update((process.env.SESSION_SECRET || API_KEY || "gvp") + "|" + ACCESS_CODES.join(","))
  .digest();

function sign(value) {
  return crypto.createHmac("sha256", SECRET).update(value).digest("base64url");
}
function makeToken(code) {
  const exp = Date.now() + SESSION_DAYS * 86400_000;
  const idx = ACCESS_CODES.indexOf(code);
  const payload = `${exp}.${idx}`;
  return `${payload}.${sign(payload)}`;
}
function readCookie(req, name) {
  const m = (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : "";
}
function isAuthed(req) {
  if (ACCESS_CODES.length === 0) return true;
  const [exp, idx, sig] = readCookie(req, COOKIE).split(".");
  if (!exp || !sig) return false;
  const expected = sign(`${exp}.${idx}`);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  return Number(exp) > Date.now();
}
function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: "請先輸入通行碼。", needCode: true });
}
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

if (!API_KEY) console.warn("⚠️ 尚未設定 GEMINI_API_KEY 環境變數，AI 功能將無法使用。");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true); // Cloud Run 在負載平衡器後面
app.use(express.json({ limit: "20mb" }));

// 簡易流量限制：避免公開網址被濫用、燒光 API 額度
const hits = new Map();
setInterval(() => hits.clear(), 60_000).unref();
function rateLimit(req, res, next) {
  const ip = req.ip || "unknown";
  const n = (hits.get(ip) || 0) + 1;
  hits.set(ip, n);
  if (n > RATE_LIMIT_PER_MIN) return res.status(429).json({ error: "使用太頻繁，請稍等一分鐘再試。" });
  next();
}

app.get("/healthz", (_req, res) => res.send("ok"));

// 通行碼登入
const loginTries = new Map();
setInterval(() => loginTries.clear(), 10 * 60_000).unref();
app.get("/api/auth", (req, res) => res.json({ required: ACCESS_CODES.length > 0, ok: isAuthed(req) }));
app.post("/api/auth", (req, res) => {
  if (ACCESS_CODES.length === 0) return res.json({ ok: true });
  const ip = req.ip || "unknown";
  const tries = (loginTries.get(ip) || 0) + 1;
  loginTries.set(ip, tries);
  if (tries > 10) return res.status(429).json({ error: "嘗試次數太多，請 10 分鐘後再試。" });
  const code = String(req.body?.code || "").trim();
  const match = ACCESS_CODES.find((c) => safeEqual(c, code));
  if (!match) return res.status(401).json({ error: "通行碼錯誤，請再確認一次。" });
  loginTries.delete(ip);
  res.cookie(COOKIE, makeToken(match), {
    httpOnly: true,
    secure: req.secure,
    sameSite: "lax",
    maxAge: SESSION_DAYS * 86400_000,
  });
  res.json({ ok: true });
});

app.post("/api/gemini/:kind", requireAuth, rateLimit, async (req, res) => {
  const model = MODELS[req.params.kind];
  if (!model) return res.status(404).json({ error: "未知的 API" });
  if (!API_KEY) return res.status(500).json({ error: "伺服器尚未設定 GEMINI_API_KEY。" });

  const body = req.body || {};
  if (req.params.kind === "text" && THINKING_LEVEL) {
    body.generationConfig = { ...(body.generationConfig || {}) };
    body.generationConfig.thinkingConfig ??= { thinkingLevel: THINKING_LEVEL };
  }

  const callGemini = async (payload) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      return { upstream: r, data: await r.json().catch(() => ({})) };
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const started = Date.now();
    let { upstream, data } = await callGemini(body);
    // 若模型不支援 thinkingConfig，移除後再試一次
    if (upstream.status === 400 && /thinking/i.test(data?.error?.message || "") && body.generationConfig?.thinkingConfig) {
      delete body.generationConfig.thinkingConfig;
      ({ upstream, data } = await callGemini(body));
    }
    console.log(`[${req.params.kind}] ${upstream.status} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    if (!upstream.ok) {
      const msg = data?.error?.message || `Gemini API 錯誤 (${upstream.status})`;
      console.error(`[${req.params.kind}] ${upstream.status}: ${msg}`);
      let friendly = msg;
      if (/API key not valid|API_KEY_INVALID/i.test(msg)) friendly = "伺服器上的 API 金鑰無效。";
      else if (upstream.status === 429) friendly = "已超過 Gemini API 使用額度，請稍後再試。";
      return res.status(upstream.status).json({ error: friendly });
    }
    res.json(data);
  } catch (err) {
    if (err?.name === "AbortError") {
      console.error(`[${req.params.kind}] timeout after ${UPSTREAM_TIMEOUT_MS / 1000}s`);
      return res.status(504).json({ error: "AI 回應逾時，請換一張較簡單的圖片或稍後再試。" });
    }
    console.error(err);
    res.status(502).json({ error: "無法連線到 Gemini API" });
  }
});

app.use(
  express.static(path.join(__dirname, "public"), {
    // HTML 不快取，重新部署後學生馬上拿到新版
    setHeaders: (res, file) => res.setHeader("Cache-Control", file.endsWith(".html") ? "no-cache" : "public, max-age=300"),
  })
);

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => console.log(`Gemini Vision Pro listening on :${port}`));

// Gemini Vision Pro — Cloud Run 伺服器
// 提供 public/ 的網頁，並代為呼叫 Gemini API（金鑰只存在伺服器環境變數，不會送到瀏覽器）
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = (process.env.GEMINI_API_KEY || "").trim();
const MODELS = {
  text: process.env.GEMINI_MODEL || "gemini-3.8-flash",
  tts: process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-lite-tts",
};
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN) || 30;

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

app.post("/api/gemini/:kind", rateLimit, async (req, res) => {
  const model = MODELS[req.params.kind];
  if (!model) return res.status(404).json({ error: "未知的 API" });
  if (!API_KEY) return res.status(500).json({ error: "伺服器尚未設定 GEMINI_API_KEY。" });

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
        body: JSON.stringify(req.body),
      }
    );
    const data = await upstream.json().catch(() => ({}));
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
    console.error(err);
    res.status(502).json({ error: "無法連線到 Gemini API" });
  }
});

app.use(express.static(path.join(__dirname, "public"), { maxAge: "5m" }));

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => console.log(`Gemini Vision Pro listening on :${port}`));

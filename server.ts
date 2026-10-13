import express, { type Request, type Response } from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";

// 依序讀取 .env.local 與 .env（.env.local 優先），兩者都已被 .gitignore 排除，不會上傳到 GitHub
dotenv.config({ path: ".env.local" });
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === "production";

const VISION_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const TTS_MODEL = process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-lite-tts";
const ALLOWED_VOICES = new Set(["Kore", "Puck", "Fenrir", "Zephyr", "Charon"]);
const MAX_THEME_LENGTH = 200;
const MAX_TTS_LENGTH = 1000;

const envApiKey = process.env.GEMINI_API_KEY?.trim();
const hasEnvKey = !!envApiKey && envApiKey !== "MY_GEMINI_API_KEY";
if (!hasEnvKey) {
  console.warn("⚠️  伺服器未設定 GEMINI_API_KEY，使用者需在網頁的「API 金鑰設定」中輸入自己的金鑰。");
}

// 依金鑰快取 client，避免每次請求都重新建立
const clients = new Map<string, GoogleGenAI>();
function getClient(req: Request): GoogleGenAI {
  const headerKey = String(req.header("x-gemini-api-key") || "").trim();
  const key = headerKey || (hasEnvKey ? envApiKey! : "");
  if (!key) {
    throw Object.assign(new Error("尚未設定 Gemini API 金鑰，請點右上角「API 金鑰設定」輸入金鑰。"), { status: 401 });
  }
  let client = clients.get(key);
  if (!client) {
    if (clients.size > 50) clients.clear();
    client = new GoogleGenAI({ apiKey: key });
    clients.set(key, client);
  }
  return client;
}

/** 把前端傳來的圖片（data URL 或 http(s) 網址）轉成 base64 與 mimeType */
async function resolveImage(image: string): Promise<{ data: string; mimeType: string }> {
  const dataUrl = image.match(/^data:(image\/[\w.+-]+);base64,(.+)$/s);
  if (dataUrl) return { mimeType: dataUrl[1], data: dataUrl[2] };

  if (/^https?:\/\//i.test(image)) {
    const res = await fetch(image);
    if (!res.ok) throw new Error(`無法下載範本圖片（HTTP ${res.status}）`);
    const mimeType = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
    if (!mimeType.startsWith("image/")) throw new Error("網址內容不是圖片");
    const buf = Buffer.from(await res.arrayBuffer());
    return { mimeType, data: buf.toString("base64") };
  }

  throw Object.assign(new Error("圖片格式不正確"), { status: 400 });
}

/** Gemini TTS 回傳的是原始 PCM（audio/L16），瀏覽器無法直接播放，需包上 WAV 檔頭 */
function pcmToWav(pcm: Buffer, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function sendError(res: Response, error: any, fallback: string) {
  const status = error?.status && error.status >= 400 && error.status < 600 ? error.status : 500;
  let message: string = error?.message || fallback;
  if (/API key not valid|API_KEY_INVALID/i.test(message)) message = "API 金鑰無效，請重新確認後再輸入。";
  else if (/quota|RESOURCE_EXHAUSTED|429/i.test(message)) message = "已超過 API 使用額度，請稍後再試。";
  res.status(status).json({ error: message });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "20mb" }));

  // 讓前端知道伺服器是否已有預設金鑰（不會回傳金鑰本身）
  app.get("/api/config", (_req, res) => {
    res.json({ hasServerKey: hasEnvKey, visionModel: VISION_MODEL, ttsModel: TTS_MODEL });
  });

  // 分析型錄圖片
  app.post("/api/analyze", async (req, res) => {
    try {
      const { image, theme } = req.body ?? {};
      if (!image || typeof image !== "string") {
        return res.status(400).json({ error: "請提供圖片" });
      }
      const safeTheme = String(theme || "產品核心特點與功能導覽").slice(0, MAX_THEME_LENGTH);
      const ai = getClient(req);
      const { data, mimeType } = await resolveImage(image);

      const prompt = `請分析這張型錄、海報或介面截圖。將其精確切割成 3 到 6 個「完整且獨立」的重點視覺區塊，區塊之間盡量不要重疊，並依照閱讀動線（由上而下、由左而右）排序。
主題需求：${safeTheme}

對於每一個區塊，請回傳：
1. title: 簡短精確的區塊標題（繁體中文，12 字以內）
2. bounding_box: 座標 [ymin, xmin, ymax, xmax]，數值範圍從 0 到 1000（相對整張圖的千分比）
3. speech: 專業、生動且流暢的導覽口白解說（約 40-70 字，繁體中文）
4. takeaways: 3 個關鍵特色條列（字串陣列，每項 20 字以內）`;

      const response = await ai.models.generateContent({
        model: VISION_MODEL,
        contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data } }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              segments: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    bounding_box: {
                      type: Type.ARRAY,
                      items: { type: Type.INTEGER },
                      description: "[ymin, xmin, ymax, xmax] from 0 to 1000",
                    },
                    speech: { type: Type.STRING },
                    takeaways: { type: Type.ARRAY, items: { type: Type.STRING } },
                  },
                  required: ["title", "bounding_box", "speech", "takeaways"],
                },
              },
            },
            required: ["segments"],
          },
        },
      });

      const text = response.text;
      if (!text) throw new Error("Gemini 沒有回傳內容");
      const parsed = JSON.parse(text);

      // 清理座標：確保四個數字、在 0–1000 之間、min < max
      const clamp = (n: number) => Math.max(0, Math.min(1000, Math.round(Number(n) || 0)));
      const segments = (Array.isArray(parsed.segments) ? parsed.segments : [])
        .filter((s: any) => Array.isArray(s?.bounding_box) && s.bounding_box.length === 4)
        .map((s: any) => {
          const [a, b, c, d] = s.bounding_box.map(clamp);
          return {
            title: String(s.title || "未命名區塊"),
            bounding_box: [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)],
            speech: String(s.speech || ""),
            takeaways: Array.isArray(s.takeaways) ? s.takeaways.map(String).slice(0, 5) : [],
          };
        })
        .filter((s: any) => s.bounding_box[2] - s.bounding_box[0] > 5 && s.bounding_box[3] - s.bounding_box[1] > 5);

      res.json({ segments });
    } catch (error: any) {
      console.error("Analysis error:", error?.message || error);
      sendError(res, error, "圖片解析失敗");
    }
  });

  // 文字轉語音
  app.post("/api/tts", async (req, res) => {
    try {
      const { text, voiceName = "Kore" } = req.body ?? {};
      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "請提供要朗讀的文字" });
      }
      const voice = ALLOWED_VOICES.has(voiceName) ? voiceName : "Kore";
      const ai = getClient(req);

      const response = await ai.models.generateContent({
        model: TTS_MODEL,
        contents: [
          {
            role: "user",
            parts: [{ text: `請用專業、親切、適合導覽解說的語氣，以台灣華語朗讀：\n${text.slice(0, MAX_TTS_LENGTH)}` }],
          },
        ],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      });

      const part = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      const base64Audio = part?.inlineData?.data;
      if (!base64Audio) throw new Error("語音生成失敗，沒有收到音訊");

      const mime = part?.inlineData?.mimeType || "";
      let audio = base64Audio;
      if (!/wav|mpeg|mp3|ogg/i.test(mime)) {
        const rate = Number(mime.match(/rate=(\d+)/)?.[1]) || 24000;
        audio = pcmToWav(Buffer.from(base64Audio, "base64"), rate).toString("base64");
      }
      res.json({ audio, mimeType: /mpeg|mp3/i.test(mime) ? "audio/mpeg" : /ogg/i.test(mime) ? "audio/ogg" : "audio/wav" });
    } catch (error: any) {
      console.error("TTS error:", error?.message || error);
      sendError(res, error, "語音生成失敗");
    }
  });

  if (isProd) {
    // 正式環境：提供 vite build 產生的靜態檔
    const dist = path.join(__dirname, "dist");
    app.use(express.static(dist));
    app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${port} (${isProd ? "production" : "development"})`);
  });
}

startServer();

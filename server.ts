import express from "express";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn("WARNING: GEMINI_API_KEY is not set in environment variables!");
}

const ai = new GoogleGenAI({
  apiKey: apiKey || "dummy-key",
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "50mb" }));

  // API Route: Analyze Catalog Image
  app.post("/api/analyze", async (req, res) => {
    try {
      const { image, theme } = req.body;
      if (!image) {
        return res.status(400).json({ error: "Image data is required" });
      }

      // Extract base64 part if data url format
      const base64Data = image.includes(",") ? image.split(",")[1] : image;
      const mimeMatch = image.match(/data:(.*?);base64,/);
      const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";

      const prompt = `請分析這張型錄、海報或介面截圖。將其精確切割成 3 到 6 個「完整且獨立」的重點視覺區塊。
主題需求：${theme || "產品核心特點與功能導覽"}

對於每一個區塊，請回傳：
1. title: 簡短精確的區塊標題（繁體中文）
2. bounding_box: 座標 [ymin, xmin, ymax, xmax]，數值範圍從 0 到 1000（對應整張圖的百分比千分比）
3. speech: 專業、生動且流暢的導覽口白解說（約 40-70 字，繁體中文）
4. takeaways: 3個關鍵特色條列（字串陣列）`;

      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: mimeType,
                  data: base64Data,
                },
              },
            ],
          },
        ],
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
                    takeaways: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                  },
                  required: ["title", "bounding_box", "speech", "takeaways"],
                },
              },
            },
            required: ["segments"],
          },
        },
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error("No response from Gemini API");
      }

      const data = JSON.parse(responseText);
      res.json(data);
    } catch (error: any) {
      console.error("Analysis error:", error);
      res.status(500).json({ error: error.message || "Failed to analyze image" });
    }
  });

  // API Route: Generate TTS audio for a script
  app.post("/api/tts", async (req, res) => {
    try {
      const { text, voiceName = "Kore" } = req.body;
      if (!text) {
        return res.status(400).json({ error: "Text is required for TTS" });
      }

      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash-lite-tts",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: text,
                speechMetadata: {
                  style: "Professional, engaging voice guide",
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voiceName },
            },
          },
        },
      });

      const base64Audio =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        throw new Error("Failed to generate audio output");
      }

      res.json({ audio: base64Audio });
    } catch (error: any) {
      console.error("TTS error:", error);
      res.status(500).json({ error: error.message || "Failed to generate speech" });
    }
  });

  // Setup Vite middleware in development
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });

  app.use(vite.middlewares);

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

startServer();

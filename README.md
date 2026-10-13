# Gemini Vision Pro 2.1

智慧區塊標定與高畫質無縫導覽生成器：上傳型錄、海報或介面截圖，Gemini 會自動切出重點區塊、寫好導覽口白，並能用 AI 語音自動播放整段導覽。

## 本機執行

需要 Node.js 20 以上。

```bash
npm install
npm run dev
```

打開 http://localhost:3000

## 設定 Gemini API 金鑰

到 [Google AI Studio](https://aistudio.google.com/apikey) 取得金鑰後，任選一種方式：

**方式一：在網頁輸入（最簡單）**
點右上角「API 金鑰設定」，貼上金鑰後按「儲存」。金鑰只存在這台電腦的瀏覽器裡。

**方式二：寫在伺服器的 `.env.local`**

```bash
cp .env.example .env.local
# 編輯 .env.local，填入 GEMINI_API_KEY=你的金鑰
```

設定後所有使用者都會共用這把金鑰，網頁上就不必再輸入。

> ⚠️ 這個儲存庫是公開的。`.env.local`、`.env` 已被 `.gitignore` 排除，**請勿把金鑰寫進任何程式碼檔案**。

## 正式部署

```bash
npm run build
npm start
```

## 可調整的環境變數

| 變數 | 預設值 | 說明 |
| --- | --- | --- |
| `GEMINI_API_KEY` | （無） | 伺服器預設金鑰 |
| `GEMINI_MODEL` | `gemini-3.8-flash` | 圖片解析模型 |
| `GEMINI_TTS_MODEL` | `gemini-3.8-flash-lite-tts` | 語音模型 |
| `PORT` | `3000` | 伺服器埠號 |

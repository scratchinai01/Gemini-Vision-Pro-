# Gemini Vision Pro

沉浸式知識策展與導覽生成系統：上傳圖片後，Gemini 會推薦故事主題、切出重點區塊、用說書人語氣寫旁白，還能合成語音並匯出 `.webm` 導覽影片。

- `public/index.html`：網頁本體
- `server.js`：提供網頁，並代為呼叫 Gemini API（**金鑰只存在伺服器，網頁原始碼裡沒有金鑰**）

> React 版保留在 [`react-v2`](../../tree/react-v2) 分支。

## 部署到 Google Cloud Run（用 Cloud Shell）

1. 開啟 [Google Cloud Console](https://console.cloud.google.com/?project=payfirebase)，點右上角的「啟用 Cloud Shell」圖示 `>_`。
2. 在 Cloud Shell 依序貼上：

```bash
git clone https://github.com/scratchinai01/Gemini-Vision-Pro-.git
cd Gemini-Vision-Pro-
read -s -p "貼上 Gemini API 金鑰後按 Enter：" GEMINI_KEY; echo
gcloud run deploy gemini-vision-pro \
  --source . \
  --project payfirebase \
  --region asia-east1 \
  --allow-unauthenticated \
  --set-env-vars GEMINI_API_KEY="$GEMINI_KEY"
```

3. 第一次部署時，如果詢問是否啟用 API 或建立 Artifact Registry 存放區，都輸入 `Y`。
4. 完成後會顯示 `Service URL: https://gemini-vision-pro-xxxx.asia-east1.run.app`，這就是網站網址。

### 之後更新程式

```bash
cd ~/Gemini-Vision-Pro- && git pull
gcloud run deploy gemini-vision-pro --source . --project payfirebase --region asia-east1
```

（金鑰設定會保留，不用重新輸入。）

### 更換 API 金鑰

```bash
read -s -p "新金鑰：" GEMINI_KEY; echo
gcloud run services update gemini-vision-pro --region asia-east1 --project payfirebase \
  --update-env-vars GEMINI_API_KEY="$GEMINI_KEY"
```

## 本機測試

```bash
cp .env.example .env.local   # 填入 GEMINI_API_KEY
npm install
npm run dev                  # http://localhost:8080
```

## 環境變數

| 變數 | 預設值 | 說明 |
| --- | --- | --- |
| `GEMINI_API_KEY` | （必填） | Gemini API 金鑰 |
| `GEMINI_MODEL` | `gemini-3.8-flash` | 圖片解析與文字模型 |
| `GEMINI_TTS_MODEL` | `gemini-3.8-flash-lite-tts` | 語音模型 |
| `RATE_LIMIT_PER_MIN` | `30` | 每個 IP 每分鐘可呼叫次數，避免網址被濫用 |

> ⚠️ 這個儲存庫是公開的，請勿把金鑰寫進任何檔案。

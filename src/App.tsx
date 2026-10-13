import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Camera, Sparkles, Volume2, Edit3, Play, Pause, CheckCircle, AlertCircle, Layers,
  Image as ImageIcon, FileText, X, ChevronRight, ChevronLeft, KeyRound, Eye, EyeOff, Loader2,
} from "lucide-react";

interface Segment {
  title: string;
  bounding_box: [number, number, number, number]; // [ymin, xmin, ymax, xmax] 0-1000
  speech: string;
  takeaways: string[];
}

type ToastType = "success" | "warning" | "default";

const PRESET_IMAGES = [
  {
    name: "智慧手錶型錄 (Smart Watch)",
    url: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=1000&q=80",
    theme: "介紹這款智慧手錶的核心工藝、健康監測與長效續航特點",
  },
  {
    name: "行動 App 介面導覽 (Mobile App UI)",
    url: "https://images.unsplash.com/photo-1551650975-87deedd944c3?auto=format&fit=crop&w=1000&q=80",
    theme: "展示應用程式的主要導覽功能與數據儀表板設計",
  },
  {
    name: "科技海報設計 (Tech Poster)",
    url: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1000&q=80",
    theme: "解構次世代人工智慧晶片與運算架構創新",
  },
];

const VOICES = [
  { id: "Kore", label: "Kore (專業知性女聲)" },
  { id: "Puck", label: "Puck (活潑男聲)" },
  { id: "Fenrir", label: "Fenrir (磁性沉穩男聲)" },
  { id: "Zephyr", label: "Zephyr (溫柔舒緩女聲)" },
  { id: "Charon", label: "Charon (沉著旁白)" },
];

const API_KEY_STORAGE = "gvp_gemini_api_key";
const MAX_UPLOAD_SIDE = 1600;

// localStorage 在無痕模式或封鎖時可能拋錯，一律包起來
const storage = {
  get(key: string) {
    try { return localStorage.getItem(key) || ""; } catch { return ""; }
  },
  set(key: string, value: string) {
    try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

/** 上傳前先縮圖，避免大圖拖慢上傳與 API 計費 */
function downscaleImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("讀取檔案失敗"));
    reader.onload = () => {
      const src = reader.result as string;
      const img = new Image();
      img.onerror = () => reject(new Error("無法解析這張圖片"));
      img.onload = () => {
        const scale = Math.min(1, MAX_UPLOAD_SIDE / Math.max(img.width, img.height));
        if (scale === 1 && file.size < 2 * 1024 * 1024) return resolve(src);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(src);
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.9));
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

const boxStyle = ([ymin, xmin, ymax, xmax]: number[]) => ({
  top: `${ymin / 10}%`,
  left: `${xmin / 10}%`,
  height: `${(ymax - ymin) / 10}%`,
  width: `${(xmax - xmin) / 10}%`,
});

export default function App() {
  const [originalImage, setOriginalImage] = useState<string | null>(PRESET_IMAGES[0].url);
  const [presetIndex, setPresetIndex] = useState<number>(0);
  const [theme, setTheme] = useState<string>(PRESET_IMAGES[0].theme);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [toasts, setToasts] = useState<{ id: number; message: string; type: ToastType }[]>([]);

  // API 金鑰
  const [apiKey, setApiKey] = useState<string>(() => storage.get(API_KEY_STORAGE));
  const [hasServerKey, setHasServerKey] = useState<boolean>(false);
  const [isKeyModalOpen, setIsKeyModalOpen] = useState<boolean>(false);
  const [keyDraft, setKeyDraft] = useState<string>("");
  const [showKey, setShowKey] = useState<boolean>(false);

  // 重新框選
  const [isRedrawing, setIsRedrawing] = useState<boolean>(false);
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  const [tempBox, setTempBox] = useState<{ ymin: number; xmin: number; ymax: number; xmax: number } | null>(null);

  // 導覽播放
  const [isWalkthroughOpen, setIsWalkthroughOpen] = useState<boolean>(false);
  const [walkthroughStep, setWalkthroughStep] = useState<number>(0);
  const [isAutoPlay, setIsAutoPlay] = useState<boolean>(true);
  const [selectedVoice, setSelectedVoice] = useState<string>("Kore");

  // 語音
  const [isTtsLoading, setIsTtsLoading] = useState<boolean>(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsCacheRef = useRef<Map<string, string>>(new Map());

  // 打字機效果
  const [displayedSpeech, setDisplayedSpeech] = useState<string>("");
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const typeTimerRef = useRef<number | null>(null);

  const stageImgRef = useRef<HTMLImageElement | null>(null);
  const toastIdRef = useRef(0);

  const keyReady = !!apiKey || hasServerKey;

  // 讀取伺服器設定，判斷是否需要使用者輸入金鑰
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg) => {
        setHasServerKey(!!cfg.hasServerKey);
        if (!cfg.hasServerKey && !storage.get(API_KEY_STORAGE)) setIsKeyModalOpen(true);
      })
      .catch(() => { /* 離線時略過 */ });
  }, []);

  useEffect(() => () => { if (typeTimerRef.current) clearInterval(typeTimerRef.current); }, []);

  const showToast = useCallback((message: string, type: ToastType = "default") => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  const apiHeaders = useCallback((): HeadersInit => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) h["x-gemini-api-key"] = apiKey;
    return h;
  }, [apiKey]);

  const requireKey = () => {
    if (keyReady) return true;
    showToast("請先設定 Gemini API 金鑰", "warning");
    openKeyModal();
    return false;
  };

  const openKeyModal = () => {
    setKeyDraft(apiKey);
    setShowKey(false);
    setIsKeyModalOpen(true);
  };

  const saveKey = () => {
    const k = keyDraft.trim();
    setApiKey(k);
    storage.set(API_KEY_STORAGE, k);
    ttsCacheRef.current.clear();
    setIsKeyModalOpen(false);
    showToast(k ? "API 金鑰已儲存在這台電腦的瀏覽器中" : "已清除 API 金鑰", "success");
  };

  const stopAudio = () => {
    const a = audioRef.current;
    if (a) { a.pause(); a.onended = null; }
  };

  const resetResults = () => {
    stopAudio();
    setSegments([]);
    setActiveIndex(-1);
    setDisplayedSpeech("");
    setIsRedrawing(false);
    setTempBox(null);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 允許重複選同一張
    if (!file) return;
    if (!file.type.startsWith("image/")) return showToast("請選擇圖片檔", "warning");
    try {
      const dataUrl = await downscaleImage(file);
      setOriginalImage(dataUrl);
      setPresetIndex(-1);
      resetResults();
      showToast("圖片上傳成功！請輸入主題並開始結構解析", "success");
    } catch (err: any) {
      showToast(err.message || "圖片讀取失敗", "warning");
    }
  };

  const handleSelectPreset = (idx: number) => {
    const preset = PRESET_IMAGES[idx];
    if (!preset) return;
    setPresetIndex(idx);
    setOriginalImage(preset.url);
    setTheme(preset.theme);
    resetResults();
    showToast(`已載入預設型錄：${preset.name}`, "success");
  };

  const triggerTypewriter = (text: string) => {
    if (typeTimerRef.current) clearInterval(typeTimerRef.current);
    setDisplayedSpeech("");
    setIsTyping(true);
    let i = 0;
    typeTimerRef.current = window.setInterval(() => {
      i++;
      setDisplayedSpeech(text.slice(0, i));
      if (i >= text.length) {
        if (typeTimerRef.current) clearInterval(typeTimerRef.current);
        typeTimerRef.current = null;
        setIsTyping(false);
      }
    }, 15);
  };

  const analyzeCatalog = async () => {
    if (!originalImage || !theme.trim()) return showToast("請確認已上傳圖片並輸入導覽主題", "warning");
    if (!requireKey()) return;

    setIsLoading(true);
    stopAudio();
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ image: originalImage, theme: theme.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401) openKeyModal();
        throw new Error(data.error || "解析失敗");
      }
      if (data.segments?.length > 0) {
        setSegments(data.segments);
        setActiveIndex(0);
        triggerTypewriter(data.segments[0].speech);
        showToast(`成功解析出 ${data.segments.length} 個重點視覺區塊`, "success");
      } else {
        showToast("未偵測到有效區塊，請嘗試更換主題或圖片", "warning");
      }
    } catch (err: any) {
      showToast(err.message || "解析失敗，請確認網路與 API 金鑰設定", "warning");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectBlock = (index: number) => {
    if (isRedrawing) return;
    setActiveIndex(index);
    if (segments[index]) triggerTypewriter(segments[index].speech);
  };

  /** 取得語音（有快取就不重打 API），回傳可播放的 data URL */
  const fetchSpeech = async (text: string): Promise<string> => {
    const cacheKey = `${selectedVoice}::${text}`;
    const cached = ttsCacheRef.current.get(cacheKey);
    if (cached) return cached;
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ text, voiceName: selectedVoice }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) openKeyModal();
      throw new Error(data.error || "語音生成失敗");
    }
    const url = `data:${data.mimeType || "audio/wav"};base64,${data.audio}`;
    ttsCacheRef.current.set(cacheKey, url);
    return url;
  };

  const playSpeech = async (text: string, onEnded?: () => void) => {
    const a = audioRef.current;
    if (!a) return;
    stopAudio();
    setIsTtsLoading(true);
    try {
      const url = await fetchSpeech(text);
      a.src = url;
      a.onended = () => onEnded?.();
      await a.play();
    } finally {
      setIsTtsLoading(false);
    }
  };

  const previewCurrentBlockAudio = async () => {
    const seg = segments[activeIndex];
    if (!seg || !requireKey()) return;
    try {
      await playSpeech(seg.speech);
    } catch (err: any) {
      showToast("語音生成失敗：" + err.message, "warning");
    }
  };

  // ---- 重新框選（支援滑鼠與觸控） ----
  const pointToCoord = (e: React.PointerEvent) => {
    const rect = stageImgRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1000, ((e.clientX - rect.left) / rect.width) * 1000)),
      y: Math.max(0, Math.min(1000, ((e.clientY - rect.top) / rect.height) * 1000)),
    };
  };

  const startRedraw = () => {
    if (activeIndex === -1) return;
    setIsRedrawing(true);
    showToast("請在圖片上按住並拖曳，重新框選範圍（按 Esc 取消）", "warning");
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isRedrawing || !stageImgRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pointToCoord(e);
    drawStartRef.current = p;
    setTempBox({ ymin: p.y, xmin: p.x, ymax: p.y, xmax: p.x });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = drawStartRef.current;
    if (!isRedrawing || !start || !stageImgRef.current) return;
    const p = pointToCoord(e);
    setTempBox({
      ymin: Math.min(start.y, p.y), xmin: Math.min(start.x, p.x),
      ymax: Math.max(start.y, p.y), xmax: Math.max(start.x, p.x),
    });
  };

  const handlePointerUp = () => {
    if (!isRedrawing || !tempBox) return;
    if (tempBox.xmax - tempBox.xmin > 20 && tempBox.ymax - tempBox.ymin > 20) {
      const box: Segment["bounding_box"] = [
        Math.round(tempBox.ymin), Math.round(tempBox.xmin), Math.round(tempBox.ymax), Math.round(tempBox.xmax),
      ];
      setSegments((prev) => prev.map((s, i) => (i === activeIndex ? { ...s, bounding_box: box } : s)));
      showToast("區塊範圍已成功更新！", "success");
    } else {
      showToast("框選範圍太小，請再試一次", "warning");
    }
    drawStartRef.current = null;
    setIsRedrawing(false);
    setTempBox(null);
  };

  // ---- 導覽播放 ----
  const closeWalkthrough = () => {
    stopAudio();
    setIsWalkthroughOpen(false);
  };

  const goStep = (next: number) => {
    stopAudio();
    if (next >= segments.length) {
      closeWalkthrough();
      showToast("導覽播放完畢！", "success");
      return;
    }
    setWalkthroughStep(Math.max(0, next));
  };

  // 自動播放：每一步朗讀完自動進到下一步
  useEffect(() => {
    if (!isWalkthroughOpen || !isAutoPlay) return;
    const seg = segments[walkthroughStep];
    if (!seg) return;
    let cancelled = false;
    playSpeech(seg.speech, () => {
      if (!cancelled) setTimeout(() => !cancelled && goStep(walkthroughStep + 1), 600);
    }).catch((err) => {
      if (cancelled) return;
      setIsAutoPlay(false);
      showToast("自動旁白暫停：" + err.message, "warning");
    });
    return () => { cancelled = true; stopAudio(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWalkthroughOpen, isAutoPlay, walkthroughStep]);

  // 鍵盤快捷鍵
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isRedrawing) { setIsRedrawing(false); setTempBox(null); drawStartRef.current = null; }
        else if (isWalkthroughOpen) closeWalkthrough();
        else if (isKeyModalOpen && keyReady) setIsKeyModalOpen(false);
      }
      if (isWalkthroughOpen) {
        if (e.key === "ArrowRight") goStep(walkthroughStep + 1);
        if (e.key === "ArrowLeft") goStep(walkthroughStep - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const exportScript = () => {
    if (segments.length === 0) return;
    const text = segments
      .map((s, idx) => `【區塊 ${idx + 1}: ${s.title}】\n導覽口白：${s.speech}\n重點摘要：\n${s.takeaways.map((t) => ` - ${t}`).join("\n")}`)
      .join("\n\n------------------------------------\n\n");
    const blob = new Blob([`主題：${theme}\n\n${text}`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gemini_vision_walkthrough_script.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("導覽文案腳本已成功匯出", "success");
  };

  const activeSeg = activeIndex !== -1 ? segments[activeIndex] : undefined;

  return (
    <div className="min-h-screen bg-[#0f1214] text-[#e3e3e3] flex flex-col items-center p-4 md:p-8">
      {/* Toast */}
      <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[100000] flex flex-col gap-2 pointer-events-none w-[calc(100%-2rem)] max-w-md">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`toast-in pointer-events-auto px-5 py-3 rounded-2xl text-sm font-medium shadow-2xl backdrop-blur-md border flex items-center gap-3 ${
              toast.type === "success"
                ? "bg-[#1e2923]/90 border-[#81c995]/30 text-[#81c995]"
                : toast.type === "warning"
                ? "bg-[#2a2419]/90 border-[#fbbc04]/30 text-[#fbbc04]"
                : "bg-[#1e1f20]/90 border-white/10 text-white"
            }`}
          >
            {toast.type === "success" ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
            {toast.message}
          </div>
        ))}
      </div>

      {/* Header */}
      <header className="w-full max-w-[1300px] flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 bg-[#16181a] p-6 rounded-3xl border border-white/5 shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 via-purple-600 to-pink-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight flex items-center gap-2">
              Gemini <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">Vision Pro 2.0</span>
            </h1>
            <p className="text-gray-400 text-xs md:text-sm">智慧區塊標定與高畫質無縫導覽生成器</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-[#202225] px-3 py-2 rounded-xl border border-white/15 text-sm">
            <span className="text-gray-400 text-xs">範本：</span>
            <select
              aria-label="選擇範本"
              className="bg-transparent text-white outline-none cursor-pointer"
              value={presetIndex}
              onChange={(e) => handleSelectPreset(Number(e.target.value))}
            >
              {presetIndex === -1 && <option value={-1} className="bg-[#1e1f20]">自訂圖片</option>}
              {PRESET_IMAGES.map((p, i) => (
                <option key={i} value={i} className="bg-[#1e1f20] text-white">{p.name}</option>
              ))}
            </select>
          </div>

          <label className="cursor-pointer bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl font-semibold text-sm flex items-center gap-2 shadow-lg shadow-blue-600/25 transition-all">
            <Camera className="w-4 h-4" />
            上傳自訂圖片
            <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
          </label>

          <button
            onClick={openKeyModal}
            className={`px-4 py-2.5 rounded-xl font-semibold text-sm flex items-center gap-2 border transition-all cursor-pointer ${
              keyReady
                ? "bg-[#1e2923] border-[#81c995]/30 text-[#81c995] hover:bg-[#24322a]"
                : "bg-[#2a2419] border-[#fbbc04]/40 text-[#fbbc04] hover:bg-[#332c1e] animate-pulse"
            }`}
          >
            <KeyRound className="w-4 h-4" />
            API 金鑰設定
            <span className={`w-2 h-2 rounded-full ${keyReady ? "bg-[#81c995]" : "bg-[#fbbc04]"}`} />
          </button>
        </div>
      </header>

      {/* Main */}
      <div className="w-full max-w-[1300px] grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Viewport */}
        <div className="lg:col-span-8 bg-[#16181a] rounded-3xl p-4 md:p-6 border border-white/5 shadow-2xl flex flex-col gap-4">
          <div
            className={`w-full h-[420px] md:h-[600px] bg-black/80 rounded-2xl relative flex items-center justify-center overflow-hidden border-2 ${
              isRedrawing ? "border-amber-400 cursor-crosshair shadow-lg shadow-amber-400/20 touch-none" : "border-white/5"
            } transition-all`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            {!originalImage ? (
              <div className="text-center text-gray-500 flex flex-col items-center">
                <ImageIcon className="w-16 h-16 mb-3 opacity-20" />
                <p>請上傳或選擇一張圖片以開始 AI 分析</p>
              </div>
            ) : (
              <div className="relative max-w-full max-h-full flex items-center justify-center">
                <img
                  ref={stageImgRef}
                  src={originalImage}
                  alt="型錄圖片"
                  draggable={false}
                  className="max-h-[400px] md:max-h-[580px] max-w-full object-contain rounded-lg select-none"
                />

                <div className="absolute inset-0">
                  {segments.map((seg, i) => {
                    const isActive = activeIndex === i;
                    return (
                      <button
                        key={i}
                        type="button"
                        aria-label={`區塊 ${i + 1}：${seg.title}`}
                        onClick={(e) => { e.stopPropagation(); handleSelectBlock(i); }}
                        className={`absolute border-2 rounded-md transition-all duration-200 ${
                          isRedrawing ? "pointer-events-none opacity-40" : "cursor-pointer"
                        } ${
                          isActive
                            ? "border-purple-400 bg-purple-500/20 shadow-[0_0_25px_rgba(197,138,249,0.5)] z-20"
                            : "border-blue-400/80 bg-blue-500/10 hover:bg-blue-500/20 hover:border-white z-10"
                        }`}
                        style={boxStyle(seg.bounding_box)}
                      >
                        <span
                          className={`absolute left-0 px-2.5 py-0.5 text-xs font-bold tracking-wider shadow-md whitespace-nowrap ${
                            seg.bounding_box[0] < 40 ? "top-0 rounded-br-md" : "-top-6 rounded-t-md"
                          } ${isActive ? "bg-purple-600 text-white" : "bg-blue-600 text-blue-100"}`}
                        >
                          {i + 1}. {seg.title}
                        </span>
                      </button>
                    );
                  })}

                  {tempBox && (
                    <div
                      className="absolute border-2 border-dashed border-amber-400 bg-amber-400/20 pointer-events-none z-30 rounded-md"
                      style={boxStyle([tempBox.ymin, tempBox.xmin, tempBox.ymax, tempBox.xmax])}
                    />
                  )}
                </div>
              </div>
            )}

            {isLoading && (
              <div className="absolute inset-0 bg-black/70 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
                <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <p className="mt-4 text-blue-400 font-mono tracking-widest font-bold animate-pulse">GEMINI VISION AI 解析中...</p>
              </div>
            )}
          </div>

          <form
            className="flex flex-col md:flex-row items-center gap-3 mt-1"
            onSubmit={(e) => { e.preventDefault(); analyzeCatalog(); }}
          >
            <input
              type="text"
              value={theme}
              maxLength={200}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="輸入導覽主題（例如：核心科技、規格亮點、UI互動設計...）"
              className="flex-1 w-full bg-[#202225] border border-white/10 rounded-2xl px-4 py-3.5 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none text-sm transition-all shadow-inner"
            />
            <button
              type="submit"
              disabled={isLoading || !originalImage}
              className="w-full md:w-auto px-6 py-3.5 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold rounded-2xl shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
            >
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
              開始 AI 結構解析
            </button>
          </form>
        </div>

        {/* Right: Side Panel */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          <div className="bg-[#16181a] rounded-3xl p-6 border border-white/5 shadow-2xl flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-blue-400 uppercase tracking-wider flex items-center gap-2">
                <Layers className="w-4 h-4" />
                區塊解說與預覽
              </h3>
              {segments.length > 0 && (
                <span className="text-xs bg-blue-500/10 text-blue-400 px-2.5 py-1 rounded-full font-mono">
                  {activeIndex + 1} / {segments.length} 區塊
                </span>
              )}
            </div>

            <div className="bg-black/30 rounded-2xl p-4 border-l-4 border-blue-500 min-h-[110px] text-sm text-gray-200 leading-relaxed shadow-inner">
              {activeSeg ? (
                <>
                  <div className="font-bold text-white mb-1">{activeSeg.title}</div>
                  <p className="text-gray-300">
                    {displayedSpeech}
                    {isTyping && <span className="inline-block w-1.5 h-4 bg-blue-400 ml-1 align-middle animate-pulse" />}
                  </p>
                </>
              ) : (
                <span className="text-gray-500 italic">點選畫面上任一藍色區塊，即可查看 AI 產生的專業導覽口白...</span>
              )}
            </div>

            {activeSeg?.takeaways?.length ? (
              <div className="flex flex-col gap-2">
                <span className="text-xs text-gray-400 font-medium">重點特色摘要：</span>
                <ul className="space-y-1.5">
                  {activeSeg.takeaways.map((t, idx) => (
                    <li key={idx} className="text-xs bg-[#202225] px-3 py-2 rounded-xl text-gray-300 flex items-start gap-2 border border-white/5">
                      <span className="text-purple-400 font-bold">•</span> {t}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {activeSeg && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <button
                  onClick={isRedrawing ? () => { setIsRedrawing(false); setTempBox(null); } : startRedraw}
                  className="py-2.5 px-3 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-xl font-semibold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  {isRedrawing ? "取消重繪" : "重新繪製範圍"}
                </button>
                <button
                  onClick={previewCurrentBlockAudio}
                  disabled={isTtsLoading}
                  className="py-2.5 px-3 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-xl font-semibold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isTtsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Volume2 className="w-3.5 h-3.5" />}
                  單獨試聽口白
                </button>
              </div>
            )}
          </div>

          <div className="bg-[#16181a] rounded-3xl p-6 border border-white/5 shadow-2xl flex flex-col gap-4">
            <h3 className="text-sm font-bold text-purple-400 uppercase tracking-wider flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              導覽與影音合成
            </h3>

            <div className="flex items-center gap-2 bg-[#202225] p-3 rounded-xl border border-white/10 text-xs">
              <span className="text-gray-400">旁白語音角色：</span>
              <select
                aria-label="旁白語音角色"
                value={selectedVoice}
                onChange={(e) => setSelectedVoice(e.target.value)}
                className="bg-transparent text-white font-medium outline-none cursor-pointer flex-1"
              >
                {VOICES.map((v) => (
                  <option key={v.id} value={v.id} className="bg-[#1e1f20]">{v.label}</option>
                ))}
              </select>
            </div>

            <button
              onClick={() => {
                if (segments.length === 0) return showToast("請先執行 AI 結構解析", "warning");
                setWalkthroughStep(0);
                setIsAutoPlay(keyReady);
                setIsWalkthroughOpen(true);
              }}
              disabled={segments.length === 0}
              className="w-full py-3.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold rounded-2xl shadow-lg shadow-purple-600/25 flex items-center justify-center gap-2 transition-all disabled:opacity-40 cursor-pointer text-sm"
            >
              <Play className="w-4 h-4 fill-white" />
              🎬 播放互動導覽影片
            </button>

            <button
              onClick={exportScript}
              disabled={segments.length === 0}
              className="w-full py-3 bg-[#202225] hover:bg-[#282a2d] text-gray-300 font-semibold rounded-2xl border border-white/10 flex items-center justify-center gap-2 transition-all disabled:opacity-40 cursor-pointer text-xs"
            >
              <FileText className="w-4 h-4 text-gray-400" />
              📝 匯出社群與文案腳本 (.txt)
            </button>
          </div>
        </div>
      </div>

      {/* Walkthrough Modal */}
      {isWalkthroughOpen && segments[walkthroughStep] && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-xl z-[99999] flex flex-col items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-4xl bg-[#16181a] border border-white/10 rounded-3xl p-4 md:p-6 shadow-2xl flex flex-col gap-5">
            <div className="flex justify-between items-center gap-3">
              <div>
                <h2 className="text-lg md:text-xl font-bold text-white flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-400" />
                  🎬 互動式導覽簡報播放中
                </h2>
                <p className="text-gray-400 text-xs">← → 切換段落，Esc 關閉</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => (isAutoPlay ? (setIsAutoPlay(false), stopAudio()) : requireKey() && setIsAutoPlay(true))}
                  className="h-10 px-3 rounded-full bg-white/10 hover:bg-white/20 flex items-center gap-1.5 text-white text-xs font-semibold transition-all cursor-pointer"
                >
                  {isTtsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : isAutoPlay ? <Pause className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  {isAutoPlay ? "暫停旁白" : "自動旁白"}
                </button>
                <button
                  onClick={closeWalkthrough}
                  aria-label="關閉"
                  className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="w-full h-[300px] md:h-[400px] bg-black rounded-2xl relative flex items-center justify-center overflow-hidden border border-white/10">
              <div className="relative max-w-full max-h-full flex items-center justify-center">
                <img src={originalImage!} alt="導覽畫面" className="max-h-[280px] md:max-h-[380px] max-w-full object-contain" />
                <div
                  className="absolute border-4 border-purple-400 bg-purple-500/20 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.55),0_0_40px_rgba(197,138,249,0.8)] transition-all duration-700 ease-out"
                  style={boxStyle(segments[walkthroughStep].bounding_box)}
                >
                  <div
                    className={`absolute left-0 bg-purple-600 text-white px-3 py-1 rounded-md text-sm font-bold shadow-lg whitespace-nowrap ${
                      segments[walkthroughStep].bounding_box[0] < 60 ? "top-1 left-1" : "-top-9"
                    }`}
                  >
                    {walkthroughStep + 1}. {segments[walkthroughStep].title}
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-[#202225] rounded-2xl p-4 border border-white/10 flex flex-col gap-2">
              <div className="text-xs text-purple-400 font-mono font-bold">段落 {walkthroughStep + 1} / {segments.length}</div>
              <p className="text-white text-base leading-relaxed">{segments[walkthroughStep].speech}</p>
            </div>

            <div className="flex justify-between items-center">
              <button
                onClick={() => goStep(walkthroughStep - 1)}
                disabled={walkthroughStep === 0}
                className="px-4 md:px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl font-semibold text-sm disabled:opacity-30 cursor-pointer flex items-center gap-1"
              >
                <ChevronLeft className="w-4 h-4" />
                上一步
              </button>
              <div className="flex gap-2">
                {segments.map((_, idx) => (
                  <button
                    key={idx}
                    aria-label={`跳到段落 ${idx + 1}`}
                    onClick={() => goStep(idx)}
                    className={`h-3 rounded-full transition-all cursor-pointer ${walkthroughStep === idx ? "bg-purple-500 w-8" : "bg-white/30 w-3"}`}
                  />
                ))}
              </div>
              <button
                onClick={() => goStep(walkthroughStep + 1)}
                className="px-4 md:px-6 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-purple-600/30 cursor-pointer flex items-center gap-1.5"
              >
                {walkthroughStep === segments.length - 1 ? "完成導覽" : "下一步"}
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* API Key Modal */}
      {isKeyModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[99999] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={(e) => { e.preventDefault(); saveKey(); }}
            className="w-full max-w-md bg-[#16181a] border border-white/10 rounded-3xl p-6 shadow-2xl flex flex-col gap-4"
          >
            <div className="flex justify-between items-start">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-blue-400" />
                API 金鑰設定
              </h2>
              {keyReady && (
                <button type="button" onClick={() => setIsKeyModalOpen(false)} aria-label="關閉" className="text-gray-400 hover:text-white cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>

            <p className="text-sm text-gray-400 leading-relaxed">
              請貼上你的 Gemini API 金鑰。金鑰只會儲存在<strong className="text-gray-200">這台電腦的瀏覽器</strong>，不會上傳到 GitHub。
              {hasServerKey && <span className="block mt-1 text-[#81c995]">伺服器已設定預設金鑰，此欄可留空。</span>}
            </p>

            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                placeholder="AIza..."
                autoComplete="off"
                spellCheck={false}
                autoFocus
                className="w-full bg-[#202225] border border-white/10 rounded-2xl pl-4 pr-12 py-3.5 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none text-sm font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? "隱藏金鑰" : "顯示金鑰"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white cursor-pointer"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-400 hover:underline"
            >
              還沒有金鑰？到 Google AI Studio 免費取得 →
            </a>

            <div className="flex gap-2 justify-end">
              {apiKey && (
                <button
                  type="button"
                  onClick={() => setKeyDraft("")}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-white/5 hover:bg-white/10 text-gray-300 cursor-pointer"
                >
                  清除
                </button>
              )}
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl text-sm font-bold bg-blue-600 hover:bg-blue-500 text-white cursor-pointer"
              >
                儲存
              </button>
            </div>
          </form>
        </div>
      )}

      <audio ref={audioRef} className="hidden" />
    </div>
  );
}

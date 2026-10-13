import React, { useState, useRef, useEffect } from "react";
import { 
  Camera, Sparkles, Volume2, Download, RefreshCw, Edit3, Trash2, Play, 
  CheckCircle, AlertCircle, Layers, Image as ImageIcon, FileText, X, ChevronRight, 
  Settings, Award, Cpu, ShieldCheck
} from "lucide-react";

interface Segment {
  title: string;
  bounding_box: [number, number, number, number]; // [ymin, xmin, ymax, xmax] 0-1000
  speech: string;
  takeaways: string[];
}

const PRESET_IMAGES = [
  {
    name: "智慧手錶型錄 (Smart Watch)",
    url: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=1000&q=80",
    theme: "介紹這款智慧手錶的核心工藝、健康監測與長效續航特點"
  },
  {
    name: "行動 App 介面導覽 (Mobile App UI)",
    url: "https://images.unsplash.com/photo-1551650975-87deedd944c3?auto=format&fit=crop&w=1000&q=80",
    theme: "展示應用程式的主要導覽功能與數據儀表板設計"
  },
  {
    name: "科技海報設計 (Tech Poster)",
    url: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1000&q=80",
    theme: "解構次世代人工智慧晶片與運算架構創新"
  }
];

export default function App() {
  const [originalImage, setOriginalImage] = useState<string | null>(PRESET_IMAGES[0].url);
  const [originalWidth, setOriginalWidth] = useState<number>(1000);
  const [originalHeight, setOriginalHeight] = useState<number>(1000);
  const [theme, setTheme] = useState<string>(PRESET_IMAGES[0].theme);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingText, setLoadingText] = useState<string>("AI ANALYZING...");
  const [toasts, setToasts] = useState<{ id: number; message: string; type: 'success' | 'warning' | 'default' }[]>([]);

  // Redraw state
  const [isRedrawing, setIsRedrawing] = useState<boolean>(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [tempBox, setTempBox] = useState<{ ymin: number; xmin: number; ymax: number; xmax: number } | null>(null);

  // Walkthrough Modal state
  const [isWalkthroughOpen, setIsWalkthroughOpen] = useState<boolean>(false);
  const [walkthroughStep, setWalkthroughStep] = useState<number>(0);
  const [isPlayingWalkthrough, setIsPlayingWalkthrough] = useState<boolean>(false);
  const [selectedVoice, setSelectedVoice] = useState<string>("Kore");

  // Audio player state
  const [isPlayingAudio, setIsPlayingAudio] = useState<boolean>(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Typewriter effect state
  const [displayedSpeech, setDisplayedSpeech] = useState<string>("");

  const stageImgRef = useRef<HTMLImageElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  // Load image dimensions on change
  useEffect(() => {
    if (!originalImage) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      setOriginalWidth(img.width || 800);
      setOriginalHeight(img.height || 600);
    };
    img.src = originalImage;
  }, [originalImage]);

  // Toast helper
  const showToast = (message: string, type: 'success' | 'warning' | 'default' = 'default') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  };

  // Handle Image Upload
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setOriginalImage(event.target.result as string);
        setSegments([]);
        setActiveIndex(-1);
        setDisplayedSpeech("請點選畫面上的區塊，查看 AI 產生的導覽解說...");
        showToast("圖片上傳成功！請輸入主題並開始結構解析", "success");
      }
    };
    reader.readAsDataURL(file);
  };

  // Select Preset
  const handleSelectPreset = (preset: typeof PRESET_IMAGES[0]) => {
    setOriginalImage(preset.url);
    setTheme(preset.theme);
    setSegments([]);
    setActiveIndex(-1);
    setDisplayedSpeech("請點選畫面上的區塊，查看 AI 產生的導覽解說...");
    showToast(`已載入預設型錄：${preset.name}`, "success");
  };

  // Analyze Catalog via Server API
  const analyzeCatalog = async () => {
    if (!originalImage || !theme.trim()) {
      showToast("請確認已上傳圖片並輸入導覽主題", "warning");
      return;
    }

    setIsLoading(true);
    setLoadingText("GEMINI VISION AI 解析中...");

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: originalImage, theme }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to analyze image");
      }

      if (data.segments && data.segments.length > 0) {
        setSegments(data.segments);
        setActiveIndex(0);
        triggerTypewriter(data.segments[0].speech);
        showToast(`成功解析出 ${data.segments.length} 個重點視覺區塊`, "success");
      } else {
        showToast("未偵測到有效區塊，請嘗試更換主題或圖片", "warning");
      }
    } catch (err: any) {
      console.error(err);
      showToast(err.message || "解析失敗，請確認網路與 API Key 設定", "warning");
    } finally {
      setIsLoading(false);
    }
  };

  // Typewriter effect for speech
  const triggerTypewriter = (text: string) => {
    setDisplayedSpeech("");
    let i = 0;
    const timer = setInterval(() => {
      if (i < text.length) {
        setDisplayedSpeech(text.substring(0, i + 1));
        i++;
      } else {
        clearInterval(timer);
      }
    }, 15);
  };

  // Select Block
  const handleSelectBlock = (index: number) => {
    setActiveIndex(index);
    if (segments[index]) {
      triggerTypewriter(segments[index].speech);
    }
  };

  // Preview TTS Audio for current block
  const previewCurrentBlockAudio = async () => {
    if (activeIndex === -1 || !segments[activeIndex]) return;
    const textToSpeak = segments[activeIndex].speech;

    showToast("正在生成語音導覽...", "default");
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: textToSpeak, voiceName: selectedVoice }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "TTS failed");

      const audioDataUrl = `data:audio/wav;base64,${data.audio}`;
      if (audioRef.current) {
        audioRef.current.src = audioDataUrl;
        audioRef.current.play();
        setIsPlayingAudio(true);
        audioRef.current.onended = () => setIsPlayingAudio(false);
      }
      showToast("語音導覽播放中 🔊", "success");
    } catch (err: any) {
      console.error(err);
      showToast("語音生成失敗：" + err.message, "warning");
    }
  };

  // Redraw handling
  const startRedraw = () => {
    if (activeIndex === -1) return;
    setIsRedrawing(true);
    showToast("請在圖片上按住並拖曳以重新框選範圍", "warning");
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isRedrawing || !stageImgRef.current) return;
    const rect = stageImgRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1000, ((e.clientX - rect.left) / rect.width) * 1000));
    const y = Math.max(0, Math.min(1000, ((e.clientY - rect.top) / rect.height) * 1000));
    setDrawStart({ x, y });
    setTempBox({ ymin: y, xmin: x, ymax: y, xmax: x });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isRedrawing || !tempBox || !stageImgRef.current) return;
    const rect = stageImgRef.current.getBoundingClientRect();
    const currX = Math.max(0, Math.min(1000, ((e.clientX - rect.left) / rect.width) * 1000));
    const currY = Math.max(0, Math.min(1000, ((e.clientY - rect.top) / rect.height) * 1000));

    const ymin = Math.min(drawStart.y, currY);
    const xmin = Math.min(drawStart.x, currX);
    const ymax = Math.max(drawStart.y, currY);
    const xmax = Math.max(drawStart.x, currX);

    setTempBox({ ymin, xmin, ymax, xmax });
  };

  const handleMouseUp = () => {
    if (!isRedrawing || !tempBox) return;
    if (tempBox.xmax - tempBox.xmin > 20 && tempBox.ymax - tempBox.ymin > 20) {
      const updated = [...segments];
      updated[activeIndex].bounding_box = [
        Math.round(tempBox.ymin),
        Math.round(tempBox.xmin),
        Math.round(tempBox.ymax),
        Math.round(tempBox.xmax),
      ];
      setSegments(updated);
      showToast("區塊範圍已成功更新！", "success");
    }
    setIsRedrawing(false);
    setTempBox(null);
  };

  // Export script
  const exportScript = () => {
    if (segments.length === 0) return;
    const text = segments.map((s, idx) => `【區塊 ${idx + 1}: ${s.title}】\n導覽口白：${s.speech}\n重點摘要：\n${s.takeaways.map(t => ` - ${t}`).join('\n')}`).join('\n\n------------------------------------\n\n');
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gemini_vision_walkthrough_script.txt";
    a.click();
    showToast("導覽文案腳本已成功匯出", "success");
  };

  return (
    <div className="min-h-screen bg-[#0f1214] text-[#e3e3e3] flex flex-col items-center p-4 md:p-8">
      {/* Toast Notification Container */}
      <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 pointer-events-none">
        {toasts.map(toast => (
          <div 
            key={toast.id}
            className={`pointer-events-auto px-5 py-3 rounded-2xl text-sm font-medium shadow-2xl backdrop-blur-md border flex items-center gap-3 transition-all animate-bounce ${
              toast.type === 'success' 
                ? 'bg-[#1e2923]/90 border-[#81c995]/30 text-[#81c995]' 
                : toast.type === 'warning'
                ? 'bg-[#2a2419]/90 border-[#fbbc04]/30 text-[#fbbc04]'
                : 'bg-[#1e1f20]/90 border-white/10 text-white'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
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
          {/* Preset dropdown */}
          <div className="flex items-center gap-2 bg-[#202225] px-3 py-2 rounded-xl border border-white/15 text-sm">
            <span className="text-gray-400 text-xs">範本：</span>
            <select 
              className="bg-transparent text-white outline-none cursor-pointer"
              onChange={(e) => {
                const idx = Number(e.target.value);
                if (!isNaN(idx)) handleSelectPreset(PRESET_IMAGES[idx]);
              }}
              defaultValue={0}
            >
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
        </div>
      </header>

      {/* Main Grid Layout */}
      <div className="w-full max-w-[1300px] grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left: Interactive Viewport (8 Cols) */}
        <div className="lg:col-span-8 bg-[#16181a] rounded-3xl p-6 border border-white/5 shadow-2xl flex flex-col gap-4">
          
          {/* Viewport Box */}
          <div 
            ref={viewportRef}
            className={`w-full h-[520px] md:h-[600px] bg-black/80 rounded-2xl relative flex items-center justify-center overflow-hidden border-2 ${isRedrawing ? 'border-amber-400 cursor-crosshair shadow-lg shadow-amber-400/20' : 'border-white/5'} transition-all`}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          >
            {!originalImage ? (
              <div className="text-center text-gray-500 flex flex-col items-center">
                <ImageIcon className="w-16 h-16 mb-3 opacity-20" />
                <p>請上傳或選擇一張圖片以開始 AI 分析</p>
              </div>
            ) : (
              <div id="image-wrapper" className="relative max-w-full max-h-full flex items-center justify-center">
                <img 
                  ref={stageImgRef}
                  src={originalImage} 
                  alt="Catalog Stage" 
                  className="max-h-[580px] max-w-full object-contain rounded-lg select-none"
                />

                {/* Render Bounding Boxes */}
                <div className="absolute inset-0 pointer-events-auto">
                  {segments.map((seg, i) => {
                    const [ymin, xmin, ymax, xmax] = seg.bounding_box;
                    const isActive = activeIndex === i;
                    return (
                      <div
                        key={i}
                        onClick={(e) => { e.stopPropagation(); handleSelectBlock(i); }}
                        className={`absolute border-2 rounded-md cursor-pointer transition-all duration-200 group ${
                          isActive 
                            ? 'border-purple-400 bg-purple-500/20 shadow-[0_0_25px_rgba(197,138,249,0.5)] z-20 scale-[1.01]' 
                            : 'border-blue-400/80 bg-blue-500/10 hover:bg-blue-500/20 hover:border-white z-10'
                        }`}
                        style={{
                          top: `${ymin / 10}%`,
                          left: `${xmin / 10}%`,
                          height: `${(ymax - ymin) / 10}%`,
                          width: `${(xmax - xmin) / 10}%`,
                        }}
                      >
                        <div className={`absolute -top-7 left-0 px-2.5 py-0.5 rounded-t-md text-xs font-bold tracking-wider shadow-md whitespace-nowrap ${
                          isActive ? 'bg-purple-600 text-white' : 'bg-blue-600 text-blue-100'
                        }`}>
                          {i + 1}. {seg.title}
                        </div>
                      </div>
                    );
                  })}

                  {/* Temp redrawn box */}
                  {tempBox && (
                    <div 
                      className="absolute border-2 border-dashed border-amber-400 bg-amber-400/20 pointer-events-none z-30 rounded-md"
                      style={{
                        top: `${tempBox.ymin / 10}%`,
                        left: `${tempBox.xmin / 10}%`,
                        height: `${(tempBox.ymax - tempBox.ymin) / 10}%`,
                        width: `${(tempBox.xmax - tempBox.xmin) / 10}%`,
                      }}
                    />
                  )}
                </div>
              </div>
            )}

            {/* AI Scanning Loader Overlay */}
            {isLoading && (
              <div className="absolute inset-0 bg-black/70 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
                <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                <p className="mt-4 text-blue-400 font-mono tracking-widest font-bold animate-pulse">{loadingText}</p>
              </div>
            )}
          </div>

          {/* Theme & Analyze Control Bar */}
          <div className="flex flex-col md:flex-row items-center gap-3 mt-1">
            <div className="relative flex-1 w-full">
              <input 
                type="text" 
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                placeholder="輸入導覽主題（例如：核心科技、規格亮點、UI互動設計...）"
                className="w-full bg-[#202225] border border-white/10 rounded-2xl px-4 py-3.5 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none text-sm transition-all shadow-inner"
              />
            </div>
            <button 
              onClick={analyzeCatalog}
              disabled={isLoading || !originalImage}
              className="w-full md:w-auto px-6 py-3.5 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold rounded-2xl shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
            >
              <Sparkles className="w-5 h-5" />
              開始 AI 結構解析
            </button>
          </div>

        </div>

        {/* Right: Side Panel & Details (4 Cols) */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          
          {/* Block Detail & Speech Card */}
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

            {/* Speech Box */}
            <div className="bg-black/30 rounded-2xl p-4 border-l-4 border-blue-500 min-h-[110px] text-sm text-gray-200 leading-relaxed font-sans shadow-inner relative">
              {activeIndex !== -1 && segments[activeIndex] ? (
                <>
                  <div className="font-bold text-white mb-1 flex items-center justify-between">
                    <span>{segments[activeIndex].title}</span>
                  </div>
                  <p className="text-gray-300">{displayedSpeech}<span className="inline-block w-1.5 h-4 bg-blue-400 ml-1 animate-pulse"></span></p>
                </>
              ) : (
                <span className="text-gray-500 italic">點選畫面上任一藍色區塊，即可查看 AI 產生的專業導覽口白...</span>
              )}
            </div>

            {/* Key Takeaways */}
            {activeIndex !== -1 && segments[activeIndex]?.takeaways && (
              <div className="flex flex-col gap-2">
                <span className="text-xs text-gray-400 font-medium">重點特色摘要：</span>
                <ul className="space-y-1.5">
                  {segments[activeIndex].takeaways.map((t, idx) => (
                    <li key={idx} className="text-xs bg-[#202225] px-3 py-2 rounded-xl text-gray-300 flex items-start gap-2 border border-white/5">
                      <span className="text-purple-400 font-bold">•</span> {t}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Block Controls */}
            {activeIndex !== -1 && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <button 
                  onClick={startRedraw}
                  className="py-2.5 px-3 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-xl font-semibold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  重新繪製範圍
                </button>
                <button 
                  onClick={previewCurrentBlockAudio}
                  className="py-2.5 px-3 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-xl font-semibold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  單獨試聽口白
                </button>
              </div>
            )}
          </div>

          {/* Export & Walkthrough Card */}
          <div className="bg-[#16181a] rounded-3xl p-6 border border-white/5 shadow-2xl flex flex-col gap-4">
            <h3 className="text-sm font-bold text-purple-400 uppercase tracking-wider flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              導覽與影音合成
            </h3>

            <div className="flex items-center gap-2 bg-[#202225] p-3 rounded-xl border border-white/10 text-xs">
              <span className="text-gray-400">旁白語音角色：</span>
              <select 
                value={selectedVoice} 
                onChange={(e) => setSelectedVoice(e.target.value)}
                className="bg-transparent text-white font-medium outline-none cursor-pointer flex-1"
              >
                <option value="Kore" className="bg-[#1e1f20]">Kore (專業知性女聲)</option>
                <option value="Puck" className="bg-[#1e1f20]">Puck (活潑男聲)</option>
                <option value="Fenrir" className="bg-[#1e1f20]">Fenrir (磁性沉穩男聲)</option>
                <option value="Zephyr" className="bg-[#1e1f20]">Zephyr (溫柔舒緩女聲)</option>
                <option value="Charon" className="bg-[#1e1f20]">Charon (沉著旁白)</option>
              </select>
            </div>

            <button 
              onClick={() => {
                if (segments.length === 0) {
                  showToast("請先執行 AI 結構解析", "warning");
                  return;
                }
                setIsWalkthroughOpen(true);
                setWalkthroughStep(0);
                setIsPlayingWalkthrough(true);
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

      {/* Walkthrough Cinematic Modal */}
      {isWalkthroughOpen && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-xl z-[99999] flex flex-col items-center justify-center p-4">
          <div className="w-full max-w-4xl bg-[#16181a] border border-white/10 rounded-3xl p-6 shadow-2xl flex flex-col gap-6 relative">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-400" />
                  🎬 互動式導覽簡報播放中
                </h2>
                <p className="text-gray-400 text-xs">正在依照 AI 解析順序進行無縫鏡頭導覽</p>
              </div>
              <button 
                onClick={() => { setIsWalkthroughOpen(false); setIsPlayingWalkthrough(false); }}
                className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Cinematic Stage */}
            <div className="w-full h-[400px] bg-black rounded-2xl relative flex items-center justify-center overflow-hidden border border-white/10">
              {originalImage && segments[walkthroughStep] && (
                <div className="relative max-w-full max-h-full flex items-center justify-center">
                  <img src={originalImage} alt="Walkthrough" className="max-h-[380px] max-w-full object-contain" />
                  
                  {/* Highlight box */}
                  {(() => {
                    const [ymin, xmin, ymax, xmax] = segments[walkthroughStep].bounding_box;
                    return (
                      <div 
                        className="absolute border-4 border-purple-400 bg-purple-500/30 rounded-lg shadow-[0_0_40px_rgba(197,138,249,0.8)] transition-all duration-500 animate-pulse"
                        style={{
                          top: `${ymin / 10}%`,
                          left: `${xmin / 10}%`,
                          height: `${(ymax - ymin) / 10}%`,
                          width: `${(xmax - xmin) / 10}%`,
                        }}
                      >
                        <div className="absolute -top-9 left-0 bg-purple-600 text-white px-3 py-1 rounded-md text-sm font-bold shadow-lg">
                          {walkthroughStep + 1}. {segments[walkthroughStep].title}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Subtitle / Script Box */}
            <div className="bg-[#202225] rounded-2xl p-4 border border-white/10 flex flex-col gap-2">
              <div className="text-xs text-purple-400 font-mono font-bold">
                段落 {walkthroughStep + 1} / {segments.length}
              </div>
              <p className="text-white text-base leading-relaxed">
                {segments[walkthroughStep]?.speech}
              </p>
            </div>

            {/* Controls */}
            <div className="flex justify-between items-center">
              <button 
                onClick={() => setWalkthroughStep(prev => Math.max(0, prev - 1))}
                disabled={walkthroughStep === 0}
                className="px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl font-semibold text-sm disabled:opacity-30 cursor-pointer"
              >
                上一步
              </button>
              <div className="flex gap-2">
                {segments.map((_, idx) => (
                  <button 
                    key={idx}
                    onClick={() => setWalkthroughStep(idx)}
                    className={`w-3 h-3 rounded-full transition-all ${walkthroughStep === idx ? 'bg-purple-500 w-8' : 'bg-white/30'}`}
                  />
                ))}
              </div>
              <button 
                onClick={() => {
                  if (walkthroughStep < segments.length - 1) {
                    setWalkthroughStep(prev => prev + 1);
                  } else {
                    setIsWalkthroughOpen(false);
                    showToast("導覽播放完畢！", "success");
                  }
                }}
                className="px-6 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-purple-600/30 cursor-pointer flex items-center gap-1.5"
              >
                {walkthroughStep === segments.length - 1 ? "完成導覽" : "下一步"}
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden Audio Element */}
      <audio ref={audioRef} className="hidden" />
    </div>
  );
}

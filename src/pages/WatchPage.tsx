import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Hls from "hls.js";
import mpegts from "mpegts.js";
import { getProxyUrl } from "@/lib/playlist";
import { useChannels } from "@/hooks/useChannels";
import {
  Loader2,
  ArrowLeft,
  ExternalLink,
  RotateCcw,
  Copy,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

/* ─── Types ─── */
type StreamKind = "hls" | "mpegts" | "native";

function detectKind(url: string): StreamKind {
  const u = url.toLowerCase().split("?")[0];
  if (u.endsWith(".m3u8")) return "hls";
  if (
    u.endsWith(".ts") ||
    u.endsWith(".mpegts") ||
    u.endsWith(".m2ts") ||
    u.endsWith(".flv")
  )
    return "mpegts";
  return "native";
}

/* ─── Inline player ─── */
function InlinePlayer({
  channelUrl,
  channelId,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  prevName,
  nextName,
}: {
  channelUrl: string;
  channelId: string;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  prevName: string;
  nextName: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsRef = useRef<ReturnType<typeof mpegts.createPlayer> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingStream, setLoadingStream] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [isCopied, setIsCopied] = useState(false);
  const [isEmbedCopied, setIsEmbedCopied] = useState(false);

  const kind = detectKind(channelUrl);
  const forceProxy = kind === "mpegts" || channelUrl.startsWith("http://");
  const playUrl = forceProxy ? getProxyUrl(channelUrl) : channelUrl;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setError(null);
    setLoadingStream(true);

    const cleanup = () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (mpegtsRef.current) {
        try {
          mpegtsRef.current.pause();
          mpegtsRef.current.unload();
          mpegtsRef.current.detachMediaElement();
          mpegtsRef.current.destroy();
        } catch {
          /* noop */
        }
        mpegtsRef.current = null;
      }
    };

    const onPlaying = () => setLoadingStream(false);
    video.addEventListener("playing", onPlaying);

    const setupHls = () => {
      if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
        hlsRef.current = hls;
        hls.loadSource(playUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal)
            setError("HLS stream failed. Try Retry or open in VLC.");
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = playUrl;
      } else {
        setError("HLS not supported in this browser.");
      }
    };

    const setupMpegts = () => {
      if (!mpegts.getFeatureList().mseLivePlayback) {
        setError("Browser doesn't support MSE for live TS playback.");
        return;
      }
      const player = mpegts.createPlayer(
        { type: "mpegts", isLive: true, url: playUrl },
        {
          enableWorker: true,
          enableStashBuffer: false,
          stashInitialSize: 128,
          liveBufferLatencyChasing: true,
          liveBufferLatencyMaxLatency: 6,
          liveBufferLatencyMinRemain: 1,
        }
      );
      mpegtsRef.current = player;
      player.attachMediaElement(video);
      player.load();
      Promise.resolve(player.play()).catch(() => {});
      player.on(mpegts.Events.ERROR, () =>
        setError(
          "Stream failed to load. Source may be offline or geo-blocked."
        )
      );
    };

    const setupNative = () => {
      video.src = playUrl;
      video.addEventListener(
        "error",
        () =>
          setError(
            "This stream can't play in the browser. Try Retry or open in VLC."
          ),
        { once: true }
      );
      video.play().catch(() => {});
    };

    if (kind === "hls") setupHls();
    else if (kind === "mpegts") setupMpegts();
    else setupNative();

    return () => {
      video.removeEventListener("playing", onPlaying);
      cleanup();
      video.removeAttribute("src");
      video.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playUrl, kind, attempt]);

  const retry = () => {
    setError(null);
    setLoadingStream(true);
    setAttempt((a) => a + 1);
  };

  const copyUrl = () => {
    navigator.clipboard.writeText(channelUrl).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };

  const copyEmbed = () => {
    const embedUrl = `https://starsportsallold.vercel.app/embed/${channelId}`;
    const iframeCode = `<iframe src="${embedUrl}" width="100%" height="100%" frameborder="0" allowfullscreen allow="autoplay; fullscreen"></iframe>`;
    navigator.clipboard.writeText(iframeCode).then(() => {
      setIsEmbedCopied(true);
      setTimeout(() => setIsEmbedCopied(false), 2500);
    });
  };

  const openInNewTab = () => {
    window.open(channelUrl, "_blank", "noopener,noreferrer");
  };

  // Keyboard ← → for prev/next
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && hasPrev) onPrev();
      if (e.key === "ArrowRight" && hasNext) onNext();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [hasPrev, hasNext, onPrev, onNext]);

  return (
    <div className="flex flex-col w-full">
      {/* Video */}
      <div className="relative w-full bg-black" style={{ aspectRatio: "16/9" }}>
        <video
          ref={videoRef}
          controls
          playsInline
          autoPlay
          className="absolute inset-0 w-full h-full"
        />
        {loadingStream && !error && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="h-12 w-12 rounded-full border-4 border-red-600/30 border-t-red-600 animate-spin" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center bg-black/90">
            <AlertTriangle className="h-10 w-10 text-red-500" />
            <p className="text-sm text-white/90 max-w-md">{error}</p>
            <div className="flex items-center gap-3">
              <button
                onClick={retry}
                className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded text-xs font-bold uppercase tracking-wider hover:bg-red-700 transition-colors"
              >
                <RotateCcw className="h-4 w-4" /> Retry
              </button>
              {hasNext && (
                <button
                  onClick={onNext}
                  className="flex items-center gap-2 bg-neutral-800 text-white px-4 py-2 rounded text-xs font-bold uppercase tracking-wider hover:bg-neutral-700 transition-colors"
                >
                  Next <ChevronRight className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        )}
        {/* watermark */}
        <div className="absolute top-3 right-3 pointer-events-none opacity-20 text-white font-black tracking-widest text-lg select-none">
          zestyytv
        </div>

        {/* Prev / Next overlays on video edges */}
        {hasPrev && (
          <button
            onClick={onPrev}
            className="absolute left-0 top-0 h-full w-14 flex items-center justify-start pl-2 opacity-0 hover:opacity-100 transition-opacity group bg-gradient-to-r from-black/60 to-transparent z-10"
            title={`Previous: ${prevName}`}
          >
            <div className="bg-black/70 rounded-full p-2 group-hover:bg-black transition-colors">
              <ChevronLeft className="h-5 w-5 text-white" />
            </div>
          </button>
        )}
        {hasNext && (
          <button
            onClick={onNext}
            className="absolute right-0 top-0 h-full w-14 flex items-center justify-end pr-2 opacity-0 hover:opacity-100 transition-opacity group bg-gradient-to-l from-black/60 to-transparent z-10"
            title={`Next: ${nextName}`}
          >
            <div className="bg-black/70 rounded-full p-2 group-hover:bg-black transition-colors">
              <ChevronRight className="h-5 w-5 text-white" />
            </div>
          </button>
        )}
      </div>

      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-0 bg-neutral-900 border-t border-white/5 text-xs">
        {/* Prev channel */}
        <button
          onClick={onPrev}
          disabled={!hasPrev}
          className={`flex items-center gap-1.5 px-4 py-3 font-bold uppercase tracking-wider border-r border-white/5 transition-colors min-w-0 ${
            hasPrev
              ? "text-neutral-400 hover:text-white hover:bg-white/5"
              : "text-neutral-700 cursor-not-allowed"
          }`}
          title={hasPrev ? `Previous: ${prevName}` : "No previous channel"}
        >
          <ChevronLeft className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden sm:inline truncate max-w-[100px]">
            {hasPrev ? prevName : "Start"}
          </span>
        </button>

        {/* Actions */}
        <div className="flex items-center gap-4 px-4 py-3 flex-1">
          <button
            onClick={retry}
            className="flex items-center gap-1.5 text-neutral-400 hover:text-white transition-colors font-bold uppercase tracking-wider"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reload
          </button>
          <button
            onClick={copyUrl}
            className={`flex items-center gap-1.5 font-bold uppercase tracking-wider transition-colors ${
              isCopied ? "text-green-400" : "text-neutral-400 hover:text-white"
            }`}
          >
            <Copy className="h-3.5 w-3.5" />{" "}
            {isCopied ? "Copied!" : "Copy URL"}
          </button>
          <button
            onClick={copyEmbed}
            className={`flex items-center gap-1.5 font-bold uppercase tracking-wider transition-colors ${
              isEmbedCopied ? "text-green-400" : "text-neutral-400 hover:text-white"
            }`}
            title="Copy iframe embed code"
          >
            <Copy className="h-3.5 w-3.5" />{" "}
            {isEmbedCopied ? "Embed Copied!" : "Copy Embed"}
          </button>
          <button
            onClick={openInNewTab}
            className="flex items-center gap-1.5 text-neutral-400 hover:text-white transition-colors font-bold uppercase tracking-wider"
            title="Open stream URL in new tab"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Open in Tab
          </button>
          <span className="ml-auto text-neutral-700 font-mono truncate max-w-[200px] hidden lg:block">
            {channelUrl}
          </span>
        </div>

        {/* Next channel */}
        <button
          onClick={onNext}
          disabled={!hasNext}
          className={`flex items-center gap-1.5 px-4 py-3 font-bold uppercase tracking-wider border-l border-white/5 transition-colors min-w-0 ${
            hasNext
              ? "text-neutral-400 hover:text-white hover:bg-white/5"
              : "text-neutral-700 cursor-not-allowed"
          }`}
          title={hasNext ? `Next: ${nextName}` : "No next channel"}
        >
          <span className="hidden sm:inline truncate max-w-[100px]">
            {hasNext ? nextName : "End"}
          </span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        </button>
      </div>
    </div>
  );
}

/* ─── Main page ─── */
const WatchPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { channels, loading, error: loadError } = useChannels();

  const currentIndex = useMemo(
    () => channels.findIndex((c) => c.id === id),
    [channels, id]
  );

  const channel = currentIndex >= 0 ? channels[currentIndex] : null;
  const prevChannel = currentIndex > 0 ? channels[currentIndex - 1] : null;
  const nextChannel =
    currentIndex >= 0 && currentIndex < channels.length - 1
      ? channels[currentIndex + 1]
      : null;

  const goToPrev = useCallback(() => {
    if (prevChannel) navigate(`/channel/${prevChannel.id}`, { replace: true });
  }, [prevChannel, navigate]);

  const goToNext = useCallback(() => {
    if (nextChannel) navigate(`/channel/${nextChannel.id}`, { replace: true });
  }, [nextChannel, navigate]);

  if (loading && !channel) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center gap-4 text-neutral-500">
        <Loader2 className="h-8 w-8 animate-spin text-red-600" />
        <p className="text-xs font-bold uppercase tracking-widest">
          Loading stream…
        </p>
      </div>
    );
  }

  if (loadError || !channel) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center gap-4 text-center px-6">
        <p className="text-red-500 font-bold text-lg">
          {loadError
            ? `Failed to load playlist: ${loadError}`
            : "Channel not found."}
        </p>
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 bg-red-600 text-white text-xs font-black px-4 py-2 rounded uppercase tracking-widest hover:bg-red-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to channels
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="min-h-screen bg-neutral-950 text-white font-sans flex flex-col selection:bg-red-600 selection:text-white">
        {/* Nav */}
        <nav className="flex items-center justify-between px-4 sm:px-6 lg:px-12 py-4 bg-black/80 border-b border-white/5 z-30">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-neutral-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-red-600 ml-1 text-xl font-black tracking-tighter uppercase italic">
              ZESTYY<span className="text-white">TV</span>
            </span>
          </button>

          <div className="flex items-center gap-2 min-w-0">
            <span className="badge-live text-[9px] shrink-0">
              <span className="live-dot" /> LIVE
            </span>
            <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest truncate max-w-[140px] sm:max-w-[300px]">
              {channel.name}
            </span>
          </div>

          <a
            href="https://www.instagram.com/nikkk.exe"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 bg-red-600 text-white text-[10px] font-black px-3 py-1.5 rounded shadow-lg shadow-red-600/20 uppercase tracking-tighter hover:bg-red-700 transition-colors"
          >
            <span className="hidden sm:inline">DEVELOPER</span>
            <ExternalLink className="w-3 h-3 opacity-70" />
          </a>
        </nav>

        {/* Channel info + position indicator */}
        <div className="px-4 sm:px-6 lg:px-12 py-4 flex items-center justify-between border-b border-white/5">
          <div className="flex flex-col gap-1 min-w-0">
            <h1 className="text-lg sm:text-2xl font-black uppercase tracking-tighter leading-none truncate">
              {channel.name}
            </h1>
            <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">
              {channel.group} · HD
            </p>
          </div>
          {channels.length > 0 && (
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-[10px] font-bold text-neutral-600 uppercase tracking-widest">
                {currentIndex + 1} / {channels.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={goToPrev}
                  disabled={!prevChannel}
                  className={`p-1.5 rounded border transition-all ${
                    prevChannel
                      ? "border-white/10 text-neutral-400 hover:border-red-500/40 hover:text-white"
                      : "border-white/5 text-neutral-700 cursor-not-allowed"
                  }`}
                  title={prevChannel ? prevChannel.name : ""}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={goToNext}
                  disabled={!nextChannel}
                  className={`p-1.5 rounded border transition-all ${
                    nextChannel
                      ? "border-white/10 text-neutral-400 hover:border-red-500/40 hover:text-white"
                      : "border-white/5 text-neutral-700 cursor-not-allowed"
                  }`}
                  title={nextChannel ? nextChannel.name : ""}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Player */}
        <main className="flex-1 flex flex-col max-w-[1400px] w-full mx-auto px-0 sm:px-6 lg:px-12 py-0 sm:py-8 gap-6">
          <div className="w-full rounded-none sm:rounded-xl overflow-hidden border-0 sm:border border-white/10 shadow-2xl">
            <InlinePlayer
              channelUrl={channel.url}
              channelId={channel.id}
              onPrev={goToPrev}
              onNext={goToNext}
              hasPrev={!!prevChannel}
              hasNext={!!nextChannel}
              prevName={prevChannel?.name ?? ""}
              nextName={nextChannel?.name ?? ""}
            />
          </div>
        </main>

        {/* Footer */}
        <footer className="w-full border-t border-white/10 py-6 px-6 flex flex-col items-center justify-center gap-4 text-center text-neutral-400 bg-neutral-900/50">
          <p className="text-sm font-bold">
            Stream by <span className="text-red-500">Zestyy</span>
            <span className="text-white">TV</span>
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <a
              href="https://instagram.com/nikkk.exe"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 bg-neutral-800 hover:bg-neutral-700 text-white text-[11px] font-black px-4 py-2 rounded-full uppercase tracking-wider transition-colors border border-white/10"
            >
              💬 Suggestions
            </a>
            <a
              href="https://zestyyflix.vercel.app"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-[11px] font-black px-4 py-2 rounded-full uppercase tracking-wider transition-colors shadow-lg shadow-red-600/20"
            >
              🎬 More from ZestyyFlix
            </a>
          </div>
        </footer>
      </div>
    </>
  );
};

export default WatchPage;

import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Hls from "hls.js";
import mpegts from "mpegts.js";
import { getProxyUrl } from "@/lib/playlist";
import { useChannels } from "@/hooks/useChannels";
import { RotateCcw, AlertTriangle } from "lucide-react";

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

const EmbedPage = () => {
  const { id } = useParams<{ id: string }>();
  const { channels, loading } = useChannels();

  const channel = channels.find((c) => c.id === id) ?? null;

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsRef = useRef<ReturnType<typeof mpegts.createPlayer> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingStream, setLoadingStream] = useState(true);
  const [attempt, setAttempt] = useState(0);

  const channelUrl = channel?.url ?? "";
  const kind = channelUrl ? detectKind(channelUrl) : "native";
  const forceProxy = kind === "mpegts" || channelUrl.startsWith("http://");
  const playUrl =
    channelUrl && forceProxy ? getProxyUrl(channelUrl) : channelUrl;

  useEffect(() => {
    if (!channelUrl) return;
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
          if (data.fatal) setError("HLS stream failed. Try reloading.");
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
        setError("Stream failed to load. Source may be offline or geo-blocked.")
      );
    };

    const setupNative = () => {
      video.src = playUrl;
      video.addEventListener(
        "error",
        () => setError("This stream can't play in the browser."),
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

  if (loading) {
    return (
      <div className="w-full h-screen bg-black flex items-center justify-center">
        <div className="h-10 w-10 rounded-full border-4 border-red-600/30 border-t-red-600 animate-spin" />
      </div>
    );
  }

  if (!channel) {
    return (
      <div className="w-full h-screen bg-black flex items-center justify-center text-white text-sm font-bold">
        Channel not found.
      </div>
    );
  }

  return (
    <div className="w-full h-screen bg-black relative overflow-hidden">
      <video
        ref={videoRef}
        controls
        playsInline
        autoPlay
        className="absolute inset-0 w-full h-full"
      />

      {/* Spinner */}
      {loadingStream && !error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="h-12 w-12 rounded-full border-4 border-red-600/30 border-t-red-600 animate-spin" />
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center bg-black/90">
          <AlertTriangle className="h-10 w-10 text-red-500" />
          <p className="text-sm text-white/90 max-w-md">{error}</p>
          <button
            onClick={retry}
            className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded text-xs font-bold uppercase tracking-wider hover:bg-red-700 transition-colors"
          >
            <RotateCcw className="h-4 w-4" /> Retry
          </button>
        </div>
      )}

      {/* Watermark */}
      <div className="absolute top-3 right-3 pointer-events-none opacity-20 text-white font-black tracking-widest text-base select-none">
        zestyytv
      </div>
    </div>
  );
};

export default EmbedPage;

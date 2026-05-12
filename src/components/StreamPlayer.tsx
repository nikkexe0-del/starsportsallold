import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import mpegts from "mpegts.js";
import { Button } from "@/components/ui/button";
import { Copy, ExternalLink, X, AlertTriangle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import type { Channel } from "@/lib/playlist";
import { getProxyUrl } from "@/lib/playlist";

interface Props {
  channel: Channel;
  useProxy: boolean;
  onClose: () => void;
}

type StreamKind = "hls" | "mpegts" | "native";

function detectKind(url: string): StreamKind {
  const u = url.toLowerCase().split("?")[0];
  if (u.endsWith(".m3u8")) return "hls";
  if (u.endsWith(".ts") || u.endsWith(".mpegts") || u.endsWith(".m2ts")) return "mpegts";
  if (u.endsWith(".flv")) return "mpegts";
  return "native";
}

export const StreamPlayer = ({ channel, useProxy, onClose }: Props) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsRef = useRef<ReturnType<typeof mpegts.createPlayer> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  const kind = detectKind(channel.url);
  // TS streams MUST go through the proxy (mixed-content + CORS), regardless of toggle.
  const forceProxy = kind === "mpegts" || channel.url.startsWith("http://");
  const playUrl = useProxy || forceProxy ? getProxyUrl(channel.url) : channel.url;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setError(null);
    setLoading(true);

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
          // noop
        }
        mpegtsRef.current = null;
      }
    };

    const onPlaying = () => setLoading(false);
    video.addEventListener("playing", onPlaying);

    const setupHls = () => {
      if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
        hlsRef.current = hls;
        hls.loadSource(playUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) {
            setError("HLS stream failed. Try the Retry button or open in VLC.");
          }
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = playUrl;
      } else {
        setError("HLS not supported in this browser.");
      }
    };

    const setupMpegts = () => {
      if (!mpegts.getFeatureList().mseLivePlayback) {
        setError("Your browser doesn't support Media Source Extensions for live TS playback.");
        return;
      }
      const player = mpegts.createPlayer(
        {
          type: "mpegts",
          isLive: true,
          url: playUrl,
        },
        {
          enableWorker: true,
          enableStashBuffer: false,
          stashInitialSize: 128,
          liveBufferLatencyChasing: true,
          liveBufferLatencyMaxLatency: 6,
          liveBufferLatencyMinRemain: 1,
        },
      );
      mpegtsRef.current = player;
      player.attachMediaElement(video);
      player.load();
      Promise.resolve(player.play()).catch(() => {});
      player.on(mpegts.Events.ERROR, (_type, _detail) => {
        setError("Stream failed to load. The source may be offline or geo-blocked.");
      });
    };

    const setupNative = () => {
      video.src = playUrl;
      const onErr = () => setError("This stream can't play in the browser. Try Retry or open in VLC.");
      video.addEventListener("error", onErr, { once: true });
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
    setLoading(true);
    setAttempt((a) => a + 1);
  };

  const copyUrl = async () => {
    await navigator.clipboard.writeText(channel.url);
    toast.success("Stream URL copied");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm p-2 sm:p-6 animate-fade-up">
      <div className="relative w-full max-w-5xl bg-gradient-card border border-border rounded-xl overflow-hidden shadow-card">
        <div className="flex items-center justify-between gap-3 p-4 border-b border-border">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="live-dot" />
              <span className="text-xs font-bold tracking-widest text-accent">LIVE</span>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                · {kind === "mpegts" ? "MPEG-TS" : kind === "hls" ? "HLS" : "Direct"}
              </span>
            </div>
            <h2 className="font-display text-xl sm:text-2xl truncate">{channel.name}</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close player">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="relative aspect-video bg-black">
          <video
            ref={videoRef}
            controls
            playsInline
            autoPlay
            className="absolute inset-0 h-full w-full"
          />
          {loading && !error && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="h-12 w-12 rounded-full border-4 border-primary/30 border-t-primary animate-spin" />
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center bg-black/80">
              <AlertTriangle className="h-10 w-10 text-accent" />
              <p className="text-sm text-foreground/90 max-w-md">{error}</p>
              <Button variant="default" size="sm" onClick={retry} className="bg-gradient-gold text-primary-foreground">
                <RotateCcw className="h-4 w-4 mr-2" /> Retry
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 p-4 border-t border-border">
          <Button variant="secondary" size="sm" onClick={retry}>
            <RotateCcw className="h-4 w-4 mr-2" /> Reload
          </Button>
          <Button variant="secondary" size="sm" onClick={copyUrl}>
            <Copy className="h-4 w-4 mr-2" /> Copy URL
          </Button>
          <a href={`vlc://${channel.url}`}>
            <Button variant="outline" size="sm">
              <ExternalLink className="h-4 w-4 mr-2" /> VLC
            </Button>
          </a>
          <span className="ml-auto text-xs text-muted-foreground">
            {forceProxy ? "Routed via proxy" : useProxy ? "Routed via proxy" : "Direct"}
          </span>
        </div>
      </div>
    </div>
  );
};

import { useEffect, useRef, useState } from "react";
import { servers } from "@/config";
import type { Server } from "@/types";

type PlayerType = "dash" | "hls" | "native";

export interface PlayerState {
  serverIndex: number;
  serverName: string;
  isPlaying: boolean;
  isReady: boolean;
  isLoading: boolean;
  error: string | null;
  volume: number;
  muted: boolean;
  currentTime: number;
  seekStart: number;
  seekEnd: number;
  seekTotal: number;
  buffered: number;
  isLive: boolean;
  isAtLiveEdge: boolean;
  qualities: number[];
  currentQuality: string;
  speed: number;
  playerType: PlayerType | null;
}

const initialState: PlayerState = {
  serverIndex: 0,
  serverName: servers[0]?.name ?? "",
  isPlaying: false,
  isReady: false,
  isLoading: false,
  error: null,
  volume: 1,
  muted: false,
  currentTime: 0,
  seekStart: 0,
  seekEnd: 0,
  seekTotal: 0,
  buffered: 0,
  isLive: false,
  isAtLiveEdge: true,
  qualities: [],
  currentQuality: "Auto",
  speed: 1,
  playerType: null,
};

interface SeekInfo {
  start: number;
  end: number;
  total: number;
}

/**
 * Owns the <video> element lifecycle, picks shaka-player (DASH) or hls.js (HLS),
 * applies ClearKey DRM, throttles UI updates for low-power KaiOS hardware, and
 * exposes cursor-free action functions (play, seek, volume, quality, speed).
 */
export function useKaiOSPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const shakaRef = useRef<any>(null);
  const hlsRef = useRef<any>(null);
  const typeRef = useRef<PlayerType | null>(null);
  const lastUi = useRef(0);
  const didInit = useRef(false);
  const stateRef = useRef<PlayerState>(initialState);

  const [state, setState] = useState<PlayerState>(initialState);
  stateRef.current = state;

  const patch = (p: Partial<PlayerState>) =>
    setState((s) => ({ ...s, ...p }));

  function detectType(url: string): PlayerType {
    const l = url.toLowerCase();
    if (l.includes(".m3u8")) return "hls";
    if (l.includes(".mpd")) return "dash";
    return "native";
  }

  function seekInfo(): SeekInfo | null {
    const v = videoRef.current;
    if (!v) return null;
    if (typeRef.current === "dash" && shakaRef.current) {
      try {
        const sr = shakaRef.current.seekRange();
        if (sr) return { start: sr.start, end: sr.end, total: sr.end - sr.start };
      } catch {
        /* ignore */
      }
    }
    if (v.seekable && v.seekable.length > 0) {
      const s = v.seekable.start(0);
      const e = v.seekable.end(0);
      return { start: s, end: e, total: e - s };
    }
    if (v.duration && isFinite(v.duration)) {
      return { start: 0, end: v.duration, total: v.duration };
    }
    return null;
  }

  function isLive(): boolean {
    const v = videoRef.current;
    if (!v) return false;
    if (typeRef.current === "dash" && shakaRef.current) {
      try {
        return shakaRef.current.isLive();
      } catch {
        /* ignore */
      }
    }
    if (typeRef.current === "hls" && hlsRef.current) return !!hlsRef.current.live;
    return v.duration === Infinity;
  }

  function onPlayerError(err: any) {
    let msg = (err && err.message) || "Stream failed to load.";
    if (err && typeof err.code === "number") msg = "Error " + err.code + ": " + msg;
    patch({ isLoading: false, isReady: false, error: msg });
  }

  async function safePlay(v: HTMLVideoElement) {
    try {
      await v.play();
    } catch {
      /* autoplay may be blocked until first user gesture */
    }
  }

  async function cleanup() {
    if (shakaRef.current) {
      try {
        await shakaRef.current.destroy();
      } catch {
        /* ignore */
      }
      shakaRef.current = null;
    }
    if (hlsRef.current) {
      try {
        hlsRef.current.destroy();
      } catch {
        /* ignore */
      }
      hlsRef.current = null;
    }
    const v = videoRef.current;
    if (v) {
      try {
        v.removeAttribute("src");
        v.load();
      } catch {
        /* ignore */
      }
    }
    typeRef.current = null;
  }

  const loadServer = async (index: number) => {
    const srv: Server | undefined = servers[index];
    if (!srv) return;
    const url = srv.url || "";
    if (!url) return;

    patch({
      serverIndex: index,
      serverName: srv.name,
      error: null,
      currentQuality: "Auto",
      qualities: [],
      isReady: false,
    });

    await cleanup();

    const type = detectType(url);
    typeRef.current = type;
    patch({ playerType: type, isLoading: true, isAtLiveEdge: true });

    const v = videoRef.current;
    if (!v) return;

    try {
      if (type === "dash") {
        const shaka = window.shaka;
        if (!shaka || !shaka.Player.isBrowserSupported())
          throw new Error("DASH playback not supported on this device");

        const player = new shaka.Player(v);
        shakaRef.current = player;
        player.addEventListener("error", (e: any) => onPlayerError(e.detail));

        const cfg: any = {
          streaming: { bufferingGoal: 15, rebufferingGoal: 3, bufferBehind: 5 },
        };
        if (srv.key) {
          const [kid, key] = srv.key.split(":");
          cfg.drm = { clearKeys: { [kid]: key } };
        }
        player.configure(cfg);

        await player.load(url);
        await safePlay(v);

        const tracks: any[] = player.getVariantTracks();
        const heights: number[] = [];
        const seen = new Set<number>();
        for (const t of tracks) {
          if (t.height && !seen.has(t.height)) {
            seen.add(t.height);
            heights.push(t.height);
          }
        }
        heights.sort((a, b) => b - a);
        patch({ qualities: heights, isLoading: false, isReady: true });
      } else if (type === "hls") {
        const Hls = window.Hls;
        if (Hls && Hls.isSupported()) {
          // Optimised for KaiOS: workers off, small buffers to avoid OOM crashes.
          const hls = new Hls({
            enableWorker: false,
            lowLatencyMode: false,
            maxBufferLength: 15,
            maxMaxBufferLength: 30,
          });
          hlsRef.current = hls;
          hls.loadSource(url);
          hls.attachMedia(v);

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            safePlay(v);
            const qs = hls.levels
              .map((l: any) => l.height)
              .filter(Boolean)
              .sort((a: number, b: number) => b - a);
            patch({ qualities: qs, isLoading: false, isReady: true });
          });
          hls.on(Hls.Events.ERROR, (_e: any, data: any) => {
            if (data.fatal) onPlayerError({ message: "HLS Fatal: " + data.type });
          });
        } else if (v.canPlayType("application/vnd.apple.mpegurl")) {
          v.src = url;
          await safePlay(v);
          patch({ isLoading: false, isReady: true });
        } else {
          throw new Error("HLS playback not supported on this device");
        }
      } else {
        v.src = url;
        await safePlay(v);
        patch({ isLoading: false, isReady: true });
      }
    } catch (e: any) {
      onPlayerError(e);
    }
  };

  // ---------- cursor-free action surface ----------
  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  const seekBy = (amt: number) => {
    const v = videoRef.current;
    if (!v) return;
    const sr = seekInfo();
    const max = sr
      ? sr.end
      : v.duration && isFinite(v.duration)
        ? v.duration
        : v.currentTime + amt;
    const nt = Math.max(0, Math.min(v.currentTime + amt, max));
    if (nt === v.currentTime) return;
    v.currentTime = nt;
    patch({ currentTime: nt });
  };

  const seekToFraction = (f: number) => {
    const v = videoRef.current;
    if (!v) return;
    const sr = seekInfo();
    if (!sr) return;
    const t = Math.max(sr.start, Math.min(sr.start + f * sr.total, sr.end));
    v.currentTime = t;
    patch({ currentTime: t });
  };

  const seekToLive = () => {
    const v = videoRef.current;
    if (!v) return;
    const sr = seekInfo();
    if (sr) v.currentTime = sr.end;
  };

  const changeVolume = (delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    const base = v.muted ? 0 : v.volume;
    const nv = Math.max(0, Math.min(1, base + delta));
    v.volume = nv;
    v.muted = nv === 0;
    patch({ volume: nv, muted: nv === 0 });
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    if (!v.muted && v.volume === 0) v.volume = 1;
    patch({ muted: v.muted, volume: v.volume });
  };

  const setSpeed = (s: number) => {
    const v = videoRef.current;
    if (v) v.playbackRate = s;
    patch({ speed: s });
  };

  const setQuality = (q: string) => {
    if (typeRef.current === "dash" && shakaRef.current) {
      const p = shakaRef.current;
      if (q === "Auto") p.configure({ abr: { enabled: true } });
      else {
        p.configure({ abr: { enabled: false } });
        const tr = p.getVariantTracks().find((t: any) => t.height == q);
        if (tr) p.selectVariantTrack(tr, true);
      }
    } else if (typeRef.current === "hls" && hlsRef.current) {
      const h = hlsRef.current;
      if (q === "Auto") h.currentLevel = -1;
      else {
        const idx = h.levels.findIndex((l: any) => l.height == q);
        if (idx !== -1) h.currentLevel = idx;
      }
    }
    patch({ currentQuality: q });
  };

  // ---------- video element listeners (attached once) ----------
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onPlay = () => patch({ isPlaying: true });
    const onPause = () => patch({ isPlaying: false });
    const onWaiting = () => {
      if (!stateRef.current.error) patch({ isLoading: true });
    };
    const onPlaying = () => patch({ isLoading: false });
    const onCanPlay = () => patch({ isLoading: false });
    const onVolume = () => patch({ volume: v.volume, muted: v.muted });
    const onLoaded = () => {
      const sr = seekInfo();
      if (sr) patch({ seekStart: sr.start, seekEnd: sr.end, seekTotal: sr.total });
    };

    const onTime = () => {
      const now = Date.now();
      if (now - lastUi.current < 250) return; // throttle to 4 updates/sec
      lastUi.current = now;

      if (v.seeking) return;
      const sr = seekInfo();
      if (!sr) return;

      const live = isLive();

      let maxBuffered = 0;
      if (v.buffered.length > 0) {
        for (let i = 0; i < v.buffered.length; i++) {
          if (v.buffered.start(i) <= v.currentTime && v.buffered.end(i) >= v.currentTime) {
            maxBuffered = v.buffered.end(i);
            break;
          }
        }
        if (maxBuffered === 0) maxBuffered = v.buffered.end(v.buffered.length - 1);
      }

      patch({
        currentTime: v.currentTime,
        seekStart: sr.start,
        seekEnd: sr.end,
        seekTotal: sr.total,
        buffered: maxBuffered,
        isLive: live,
        isAtLiveEdge: !live || sr.end - v.currentTime <= 5,
      });
    };

    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("playing", onPlaying);
    v.addEventListener("canplay", onCanPlay);
    v.addEventListener("volumechange", onVolume);
    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("durationchange", onLoaded);
    v.addEventListener("timeupdate", onTime);

    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("canplay", onCanPlay);
      v.removeEventListener("volumechange", onVolume);
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("durationchange", onLoaded);
      v.removeEventListener("timeupdate", onTime);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- boot: install shaka polyfills + load first server ----------
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    if (window.shaka) {
      try {
        window.shaka.polyfill.installAll();
      } catch {
        /* ignore */
      }
    }
    loadServer(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    state,
    videoRef,
    loadServer,
    togglePlay,
    seekBy,
    seekToFraction,
    seekToLive,
    changeVolume,
    toggleMute,
    setSpeed,
    setQuality,
  };
}

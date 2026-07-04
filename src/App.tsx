import { useEffect, useRef, useState } from "react";
import { useKaiOSPlayer } from "@/hooks/useKaiOSPlayer";
import PlayerView, { type PlayerUI } from "@/components/PlayerView";
import { servers, SPEEDS, CONTROLS_HIDE_MS } from "@/config";
import type { FlashState, MenuData, MenuKind } from "@/types";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

const isBackKey = (k: string) =>
  k === "Backspace" || k === "BrowserBack" || k === "GoBack" || k === "Escape";

export default function App() {
  const {
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
  } = useKaiOSPlayer();

  // ---- UI state ----
  const [menu, setMenu] = useState<MenuKind>("none");
  const [focus, setFocus] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [flash, setFlash] = useState<FlashState | null>(null);
  const [volOsd, setVolOsd] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  // ---- refs (read inside imperative key handler) ----
  const menuRef = useRef(menu);
  menuRef.current = menu;
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const playingRef = useRef(state.isPlaying);
  playingRef.current = state.isPlaying;
  const flashId = useRef(0);
  const hideTimer = useRef<number | undefined>(undefined);

  // ---- menu builders ----
  const buildServerMenu = (): MenuData => ({
    kind: "server",
    header: "Select Server",
    items: servers.map((s, i) => ({
      label: s.name,
      active: i === state.serverIndex,
      onSelect: () => {
        loadServer(i);
        setMenu("none");
      },
    })),
  });

  const buildSettingsMenu = (): MenuData => ({
    kind: "settings",
    header: "Settings",
    items: [
      {
        label: "Playback speed",
        value: state.speed === 1 ? "Normal" : state.speed + "x",
        onSelect: () => openMenu("speed"),
      },
      ...(state.qualities.length
        ? [
            {
              label: "Quality",
              value:
                state.currentQuality === "Auto"
                  ? "Auto"
                  : state.currentQuality + "p",
              onSelect: () => openMenu("quality"),
            },
          ]
        : []),
      {
        label: "Switch server",
        value: state.serverName,
        onSelect: () => openMenu("server"),
      },
      { label: "Full keymap", onSelect: () => setMenu("help") },
    ],
  });

  const buildSpeedMenu = (): MenuData => ({
    kind: "speed",
    header: "Playback Speed",
    sub: true,
    items: SPEEDS.map((s) => ({
      label: s === 1 ? "Normal" : s + "x",
      active: state.speed === s,
      onSelect: () => {
        setSpeed(s);
        setMenu("settings");
      },
    })),
  });

  const buildQualityMenu = (): MenuData => ({
    kind: "quality",
    header: "Quality",
    sub: true,
    items: [
      {
        label: "Auto",
        active: state.currentQuality === "Auto",
        onSelect: () => {
          setQuality("Auto");
          setMenu("settings");
        },
      },
      ...state.qualities.map((q) => ({
        label: q + "p",
        active: state.currentQuality === String(q),
        onSelect: () => {
          setQuality(String(q));
          setMenu("settings");
        },
      })),
    ],
  });

  let menuData: MenuData | null = null;
  if (menu === "server") menuData = buildServerMenu();
  else if (menu === "settings") menuData = buildSettingsMenu();
  else if (menu === "speed") menuData = buildSpeedMenu();
  else if (menu === "quality") menuData = buildQualityMenu();
  const menuDataRef = useRef<MenuData | null>(null);
  menuDataRef.current = menuData;

  // ---- menu open / close helpers ----
  const openMenu = (kind: "server" | "settings" | "speed" | "quality") => {
    let f = 0;
    if (kind === "server") f = state.serverIndex;
    else if (kind === "speed") {
      const i = SPEEDS.indexOf(state.speed);
      f = i < 0 ? 1 : i;
    } else if (kind === "quality") {
      f =
        state.currentQuality === "Auto"
          ? 0
          : state.qualities.indexOf(Number(state.currentQuality)) + 1;
    }
    setFocus(f >= 0 ? f : 0);
    setMenu(kind);
  };

  const goBackFromMenu = (m: MenuKind) => {
    if (m === "speed" || m === "quality") setMenu("settings");
    else setMenu("none");
  };

  // ---- transient feedback ----
  const flashPlayPause = () => {
    const v = videoRef.current;
    setFlash({ type: v && v.paused ? "pause" : "play", id: ++flashId.current });
  };
  const flashSeek = (amount: number, dir: "back" | "fwd") => {
    setFlash({
      type: dir === "back" ? "seekBack" : "seekFwd",
      amount,
      id: ++flashId.current,
    });
  };
  const flashVol = () => setVolOsd((n) => n + 1);

  const resetHide = () => {
    setControlsVisible(true);
    window.clearTimeout(hideTimer.current);
    if (playingRef.current)
      hideTimer.current = window.setTimeout(
        () => setControlsVisible(false),
        CONTROLS_HIDE_MS
      );
  };

  // ---- fullscreen ----
  const toggleFullscreen = () => {
    try {
      if (!document.fullscreenElement) {
        const el: any = document.documentElement;
        const p = el.requestFullscreen ? el.requestFullscreen() : undefined;
        Promise.resolve(p)
          .then(() => {
            try {
              const o: any = screen.orientation;
              if (o && o.lock) o.lock("landscape");
            } catch {
              /* ignore */
            }
          })
          .catch(() => {});
        setFullscreen(true);
      } else {
        const ex: any = document.exitFullscreen ? document.exitFullscreen() : undefined;
        Promise.resolve(ex).catch(() => {});
        setFullscreen(false);
      }
    } catch {
      setFullscreen((f) => !f);
    }
  };

  // ---- touch / click handlers (bonus for touch KaiOS devices) ----
  const onAreaTap = (region: "left" | "right" | "center") => {
    if (menu !== "none") return;
    if (region === "center") {
      togglePlay();
      flashPlayPause();
    } else if (region === "left") {
      seekBy(-10);
      flashSeek(10, "back");
    } else {
      seekBy(10);
      flashSeek(10, "fwd");
    }
    resetHide();
  };
  const onSeekFraction = (f: number) => {
    seekToFraction(f);
    resetHide();
  };
  const onLive = () => {
    seekToLive();
    resetHide();
  };
  const onItemActivate = (i: number) => {
    const md = menuDataRef.current;
    if (md) {
      setFocus(i);
      md.items[i]?.onSelect();
    }
  };

  // ---- soft keys ----
  const onSoftLeft = () => {
    if (menu === "none") {
      openMenu("server");
      return;
    }
    if (menu === "help") return;
    const md = menuDataRef.current;
    if (md) {
      const cur = clamp(focusRef.current, 0, Math.max(0, md.items.length - 1));
      md.items[cur]?.onSelect();
    }
  };
  const onSoftRight = () => {
    if (menu === "help") {
      setMenu("settings");
      return;
    }
    if (menu !== "none") {
      goBackFromMenu(menu);
      return;
    }
    openMenu("settings");
  };

  // ============================================================
  //  THE KAIOS KEYPAD HANDLER
  // ============================================================
  const handleKeyDown = (e: KeyboardEvent) => {
    const k = e.key;
    const m = menuRef.current;
    const md = menuDataRef.current;

    // --- Help screen: only Back closes it ---
    if (m === "help") {
      if (isBackKey(k) || k === "SoftRight" || k === "ArrowLeft") {
        e.preventDefault();
        setMenu("settings");
      }
      return;
    }

    // --- Menu navigation mode ---
    if (m !== "none" && md) {
      e.preventDefault();
      const len = md.items.length;
      if (k === "ArrowUp" || k === "2") {
        setFocus((p) => (p - 1 + len) % len);
      } else if (k === "ArrowDown" || k === "8") {
        setFocus((p) => (p + 1) % len);
      } else if (k === "Enter" || k === " " || k === "5" || k === "SoftLeft") {
        const cur = clamp(focusRef.current, 0, Math.max(0, len - 1));
        md.items[cur]?.onSelect();
      } else if (k === "ArrowRight") {
        const cur = clamp(focusRef.current, 0, Math.max(0, len - 1));
        md.items[cur]?.onSelect();
      } else if (isBackKey(k) || k === "SoftRight" || k === "ArrowLeft") {
        goBackFromMenu(m);
      }
      return;
    }

    // --- Playback mode ---
    e.preventDefault();
    switch (k) {
      case "Enter":
      case " ":
      case "5":
        togglePlay();
        flashPlayPause();
        resetHide();
        break;
      case "ArrowLeft":
      case "4":
        seekBy(-10);
        flashSeek(10, "back");
        resetHide();
        break;
      case "ArrowRight":
      case "6":
        seekBy(10);
        flashSeek(10, "fwd");
        resetHide();
        break;
      case "ArrowUp":
      case "2":
      case "VolumeUp":
        changeVolume(0.1);
        flashVol();
        resetHide();
        break;
      case "ArrowDown":
      case "8":
      case "VolumeDown":
        changeVolume(-0.1);
        flashVol();
        resetHide();
        break;
      case "1":
        seekBy(-30);
        flashSeek(30, "back");
        resetHide();
        break;
      case "3":
        seekBy(30);
        flashSeek(30, "fwd");
        resetHide();
        break;
      case "0":
        toggleMute();
        flashVol();
        resetHide();
        break;
      case "7":
        loadServer((state.serverIndex - 1 + servers.length) % servers.length);
        resetHide();
        break;
      case "9":
        loadServer((state.serverIndex + 1 + servers.length) % servers.length);
        resetHide();
        break;
      case "*":
      case "SoftLeft":
        openMenu("server");
        break;
      case "#":
      case "SoftRight":
        openMenu("settings");
        break;
      case "Call":
        toggleFullscreen();
        break;
      default:
        if (isBackKey(k)) setControlsVisible((v) => !v);
        break;
    }
  };

  // stable listener that always calls the freshest handler
  const handlerRef = useRef(handleKeyDown);
  handlerRef.current = handleKeyDown;

  useEffect(() => {
    const fn = (e: KeyboardEvent) => handlerRef.current(e);
    window.addEventListener("keydown", fn, { capture: false });
    const onCtx = (e: Event) => e.preventDefault();
    document.addEventListener("contextmenu", onCtx);
    return () => {
      window.removeEventListener("keydown", fn);
      document.removeEventListener("contextmenu", onCtx);
    };
  }, []);

  // show/hide controls react to play state
  useEffect(() => {
    resetHide();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isPlaying]);

  // keep controls visible while a menu is open; re-arm hide timer when it closes
  useEffect(() => {
    if (menu !== "none") {
      setControlsVisible(true);
      window.clearTimeout(hideTimer.current);
    } else {
      resetHide();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu]);

  // sync fullscreen state with the browser
  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // soft-key labels
  let softLeft = "";
  let softRight = "";
  if (menu === "help") {
    softRight = "Back";
  } else if (menu !== "none") {
    softLeft = "Select";
    softRight = "Back";
  } else {
    softLeft = "Servers";
    softRight = "Options";
  }

  const ui: PlayerUI = {
    menu,
    focus,
    controlsVisible,
    flash,
    volOsd,
    fullscreen,
    softLeft,
    softRight,
  };

  return (
    <PlayerView
      videoRef={videoRef}
      state={state}
      ui={ui}
      menuData={menuData}
      onAreaTap={onAreaTap}
      onSeekFraction={onSeekFraction}
      onLive={onLive}
      onItemActivate={onItemActivate}
      onSoftLeft={onSoftLeft}
      onSoftRight={onSoftRight}
    />
  );
}

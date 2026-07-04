import type { ComponentType } from "react";
import type { MenuData, MenuKind, FlashState } from "@/types";
import type { PlayerState } from "@/hooks/useKaiOSPlayer";
import { keymapLegend } from "@/config";
import {
  PlayIcon,
  PauseIcon,
  RewindIcon,
  ForwardIcon,
  DoubleLeftIcon,
  DoubleRightIcon,
  VolumeIcon,
  MuteIcon,
  SettingsIcon,
  FullscreenIcon,
  ChevronLeftIcon,
  TvIcon,
} from "./Icons";

export interface PlayerUI {
  menu: MenuKind;
  focus: number;
  controlsVisible: boolean;
  flash: FlashState | null;
  volOsd: number;
  fullscreen: boolean;
  softLeft: string;
  softRight: string;
}

export interface PlayerViewProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  state: PlayerState;
  ui: PlayerUI;
  menuData: MenuData | null;
  onAreaTap: (region: "left" | "right" | "center") => void;
  onSeekFraction: (f: number) => void;
  onLive: () => void;
  onItemActivate: (i: number) => void;
  onSoftLeft: () => void;
  onSoftRight: () => void;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const total = Math.floor(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export default function PlayerView(props: PlayerViewProps) {
  const { videoRef, state, ui, menuData } = props;
  const { controlsVisible, menu } = ui;

  const progressPct =
    state.seekTotal > 0
      ? clamp(((state.currentTime - state.seekStart) / state.seekTotal) * 100, 0, 100)
      : state.isLive
        ? 100
        : 0;
  const bufferPct =
    state.seekTotal > 0
      ? clamp(((state.buffered - state.seekStart) / state.seekTotal) * 100, 0, 100)
      : 0;

  const showChrome = controlsVisible || menu !== "none";

  return (
    <div className="relative h-full w-full overflow-hidden bg-black select-none">
      {/* Subtle ambient gradient backdrop (visible on letterbox edges) */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 0%, rgba(76,29,149,0.18), transparent 60%), #06080f",
        }}
      />

      {/* ---- Video ---- */}
      <video
        ref={videoRef}
        playsInline
        preload="auto"
        className="absolute inset-0 h-full w-full object-contain"
        style={{ pointerEvents: "none" }}
      />

      {/* ---- Tap / click layer (for touch KaiOS devices) ---- */}
      <div
        className="absolute inset-0"
        onClick={(e) => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const x = e.clientX - rect.left;
          const region =
            x < rect.width / 3 ? "left" : x > (rect.width * 2) / 3 ? "right" : "center";
          props.onAreaTap(region);
        }}
      />

      {/* ---- Top bar ---- */}
      <div
        className="trans-chrome absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-2 px-2.5 pb-3.5 pt-2"
        style={{
          opacity: showChrome ? 1 : 0,
          transform: showChrome ? "translateY(0)" : "translateY(-12px)",
          pointerEvents: showChrome ? "auto" : "none",
          background:
            "linear-gradient(to bottom, rgba(6,8,15,0.92) 0%, rgba(6,8,15,0.55) 55%, transparent 100%)",
        }}
      >
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px]"
              style={{
                background:
                  "linear-gradient(135deg, #6366f1, #8b5cf6)",
                boxShadow: "0 0 10px -1px rgba(139,92,246,0.7)",
              }}
            >
              <TvIcon className="text-[10px] text-white" />
            </span>
            <span className="truncate text-[11px] font-semibold tracking-tight text-white">
              {state.serverName || "Saoodify"}
            </span>
          </div>

          {/* Live / quality status pill */}
          <div className="flex shrink-0 items-center gap-1.5">
            {state.currentQuality !== "Auto" && (
              <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-violet-200">
                {state.currentQuality}p
              </span>
            )}
            {state.isLive && (
              <button
                onClick={props.onLive}
                className="trans-soft flex items-center gap-1 rounded-full px-1.5 py-0.5"
                style={{
                  touchAction: "manipulation",
                  background: state.isAtLiveEdge
                    ? "rgba(239,68,68,0.16)"
                    : "rgba(148,163,184,0.12)",
                }}
              >
                <span
                  className={
                    "inline-block h-1.5 w-1.5 rounded-full " +
                    (state.isAtLiveEdge ? "anim-live bg-red-500" : "bg-slate-400")
                  }
                />
                <span
                  className={
                    "text-[9px] font-bold uppercase tracking-wider " +
                    (state.isAtLiveEdge ? "text-red-200" : "text-slate-300")
                  }
                >
                  {state.isAtLiveEdge ? "Live" : "Go Live"}
                </span>
              </button>
            )}
          </div>
      </div>

      {/* ---- Loading spinner ---- */}
      {state.isLoading && !state.error && (
        <div className="anim-fade absolute inset-0 z-40 flex flex-col items-center justify-center gap-2">
          <div
            className="anim-spin h-10 w-10 rounded-full"
            style={{
              borderWidth: 3,
              borderStyle: "solid",
              borderColor: "rgba(139,92,246,0.16)",
              borderTopColor: "#8b5cf6",
              borderRightColor: "#6366f1",
            }}
          />
          <span className="text-[9px] font-medium uppercase tracking-[0.18em] text-slate-400">
            Loading
          </span>
        </div>
      )}

      {/* ---- Error ---- */}
      {state.error && (
        <div className="anim-up absolute inset-x-2 z-40 flex items-center justify-center">
          <div className="card-premium max-w-[220px] rounded-xl px-3 py-2.5 text-center"
            style={{ borderColor: "rgba(239,68,68,0.4)" }}
          >
            <div className="text-[11px] font-bold tracking-wide text-red-400">
              Server Error
            </div>
            <div className="mt-1 text-[10px] leading-snug text-red-100/90">
              {state.error}
            </div>
            <div className="mt-1.5 text-[9px] text-slate-400">
              Try another channel (7 / 9) or open Servers (*).
            </div>
          </div>
        </div>
      )}

      {/* ---- Idle play hint ---- */}
      {!state.isPlaying &&
        !state.isLoading &&
        !state.error &&
        state.isReady &&
        menu === "none" && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
            <div
              className="anim-fade flex h-14 w-14 items-center justify-center rounded-full text-white"
              style={{
                background: "rgba(6,8,15,0.55)",
                boxShadow: "0 0 0 1px rgba(255,255,255,0.12), 0 0 26px -6px rgba(139,92,246,0.8)",
              }}
            >
              <PlayIcon className="ml-0.5 text-[26px]" />
            </div>
          </div>
        )}

      {/* ---- Center play/pause flash ---- */}
      {ui.flash &&
        (ui.flash.type === "play" || ui.flash.type === "pause") && (
          <div
            key={"c" + ui.flash.id}
            className="anim-center pointer-events-none absolute left-1/2 top-1/2 z-50 flex h-16 w-16 items-center justify-center rounded-full text-violet-200"
            style={{
              background: "rgba(6,8,15,0.6)",
              boxShadow: "0 0 0 1.5px rgba(167,155,242,0.35), 0 0 30px -4px rgba(139,92,246,0.7)",
            }}
          >
            {ui.flash.type === "play" ? (
              <PlayIcon className="ml-0.5 text-[30px]" />
            ) : (
              <PauseIcon className="text-[30px]" />
            )}
          </div>
        )}

      {/* ---- Seek flashes ---- */}
      {ui.flash && ui.flash.type === "seekBack" && (
        <SeekBubble side="left" id={ui.flash.id} amount={ui.flash.amount ?? 10} Icon={DoubleLeftIcon} />
      )}
      {ui.flash && ui.flash.type === "seekFwd" && (
        <SeekBubble side="right" id={ui.flash.id} amount={ui.flash.amount ?? 10} Icon={DoubleRightIcon} />
      )}

      {/* ---- Volume OSD ---- */}
      {ui.volOsd > 0 && (
        <div
          key={"v" + ui.volOsd}
          className="anim-osd pointer-events-none absolute bottom-14 left-1/2 z-50 flex items-center gap-2 rounded-full px-3 py-1.5"
          style={{
            background: "rgba(10,12,20,0.82)",
            boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 8px 24px -8px rgba(0,0,0,0.8)",
          }}
        >
          {state.muted || state.volume === 0 ? (
            <MuteIcon className="text-[15px] text-slate-300" />
          ) : (
            <VolumeIcon className="text-[15px] text-violet-300" />
          )}
          <div className="flex h-1.5 w-22 items-center overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(state.muted ? 0 : state.volume) * 100}%`,
                background: "linear-gradient(90deg, #6366f1, #a855f7)",
              }}
            />
          </div>
          <span className="w-6 text-right font-mono text-[10px] font-bold text-white">
            {Math.round((state.muted ? 0 : state.volume) * 100)}
          </span>
        </div>
      )}

      {/* ---- Bottom controls ---- */}
      <div
        className="trans-chrome absolute inset-x-0 bottom-[26px] z-30 px-2.5 pb-2 pt-5"
        style={{
          opacity: controlsVisible ? 1 : 0,
          transform: controlsVisible ? "translateY(0)" : "translateY(14px)",
          pointerEvents: controlsVisible ? "auto" : "none",
          background:
            "linear-gradient(to top, rgba(6,8,15,0.97) 0%, rgba(6,8,15,0.82) 35%, rgba(6,8,15,0.25) 75%, transparent 100%)",
        }}
      >
          {/* Premium scrubber */}
          <div
            className="relative mb-2.5 h-2 w-full cursor-pointer rounded-full"
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const f = clamp((e.clientX - rect.left) / rect.width, 0, 1);
              props.onSeekFraction(f);
            }}
            style={{ background: "rgba(255,255,255,0.14)" }}
          >
            <div
              className="bar-trans absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${bufferPct}%`, background: "rgba(255,255,255,0.26)" }}
            />
            <div
              className="bar-trans absolute inset-y-0 left-0 rounded-full"
              style={{
                width: `${progressPct}%`,
                background: "linear-gradient(90deg, #6366f1 0%, #8b5cf6 60%, #a855f7 100%)",
                boxShadow: "0 0 12px -2px rgba(139,92,246,0.8)",
              }}
            />
            <div
              className="thumb-glow absolute top-1/2 h-3 w-3 rounded-full bg-white"
              style={{
                left: `${progressPct}%`,
                transform: "translate(-50%, -50%)",
                transition: "left 0.3s var(--ease-soft)",
              }}
            />
          </div>

          {/* Control row */}
          <div className="flex items-center justify-between text-white">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] text-violet-300">
                {state.isPlaying ? <PauseIcon /> : <PlayIcon />}
              </span>
              <span className="font-mono text-[10px] tabular-nums text-slate-200">
                {state.isLive
                  ? state.isAtLiveEdge
                    ? "LIVE"
                    : "-" + formatTime(state.seekEnd - state.currentTime)
                  : formatTime(state.currentTime) +
                    " / " +
                    formatTime(state.seekEnd)}
              </span>
            </div>

            <div className="flex items-center gap-2 text-slate-400">
              <ControlHint Icon={RewindIcon} label="10s" />
              <ControlHint Icon={ForwardIcon} label="10s" />
            </div>

            <div className="flex items-center gap-1 text-slate-400">
              <span className="text-[11px]">
                {state.muted || state.volume === 0 ? <MuteIcon /> : <VolumeIcon />}
              </span>
              <span className="font-mono text-[10px]">
                {state.muted ? "0" : Math.round(state.volume * 100)}
              </span>
            </div>
          </div>
      </div>

      {/* ---- Menus ---- */}
      {menuData && (
        <MenuPanel menuData={menuData} focus={ui.focus} onActivate={props.onItemActivate} />
      )}
      {menu === "help" && <HelpOverlay />}

      {/* ---- Soft-key bar ---- */}
      <div
        className="absolute inset-x-0 bottom-0 z-[60] flex h-[24px] items-center justify-between border-t px-2.5 text-[10px] font-semibold"
        style={{
          borderColor: "rgba(255,255,255,0.08)",
          background: "linear-gradient(180deg, rgba(16,18,30,0.96), rgba(8,10,18,0.98))",
        }}
      >
        <button
          onClick={props.onSoftLeft}
          className={"trans-soft max-w-[42%] truncate " + (ui.softLeft ? "text-violet-300" : "text-transparent")}
          style={{ touchAction: "manipulation" }}
        >
          {ui.softLeft || "·"}
        </button>
        <span className="truncate text-[9px] font-bold uppercase tracking-[0.16em] text-slate-500">
          {menu === "help" ? "Keymap" : "Saoodify"}
        </span>
        <button
          onClick={props.onSoftRight}
          className={"trans-soft max-w-[42%] truncate text-right " + (ui.softRight ? "text-violet-300" : "text-transparent")}
          style={{ touchAction: "manipulation" }}
        >
          {ui.softRight || "·"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function ControlHint({
  Icon,
  label,
}: {
  Icon: ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <span className="flex items-center gap-0.5 rounded-md px-1 py-0.5"
      style={{ background: "rgba(255,255,255,0.05)" }}
    >
      <Icon className="text-[11px]" />
      <span className="text-[8px] font-medium">{label}</span>
    </span>
  );
}

function SeekBubble({
  side,
  id,
  amount,
  Icon,
}: {
  side: "left" | "right";
  id: number;
  amount: number;
  Icon: ComponentType<{ className?: string }>;
}) {
  return (
    <div
      key={"s" + id}
      className="anim-side pointer-events-none absolute top-1/2 z-50 flex flex-col items-center justify-center rounded-full text-violet-200"
      style={{
        left: side === "left" ? "14%" : undefined,
        right: side === "right" ? "14%" : undefined,
        width: 52,
        height: 52,
        background: "rgba(6,8,15,0.62)",
        boxShadow: "0 0 0 1.5px rgba(167,155,242,0.3), 0 0 26px -6px rgba(139,92,246,0.7)",
      }}
    >
      <Icon className="text-[20px]" />
      <span className="text-[9px] font-bold">{amount}s</span>
    </div>
  );
}

function MenuPanel({
  menuData,
  focus,
  onActivate,
}: {
  menuData: MenuData;
  focus: number;
  onActivate: (i: number) => void;
}) {
  return (
    <div className="absolute inset-0 z-[55] flex items-end justify-center">
      <div className="anim-fade absolute inset-0" style={{ background: "rgba(4,6,12,0.6)" }} />
      <div className="anim-panel card-premium relative mb-[34px] w-[88%] max-w-[230px] overflow-hidden rounded-2xl">
        {/* gradient top accent line */}
        <div
          className="absolute inset-x-0 top-0 h-[2px]"
          style={{ background: "linear-gradient(90deg, #6366f1, #a855f7)" }}
        />
        <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-2">
          {menuData.sub && (
            <span className="text-[14px] leading-none text-violet-300">
              <ChevronLeftIcon />
            </span>
          )}
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-white">
            {menuData.header}
          </span>
        </div>
        <div className="no-scrollbar max-h-[240px] overflow-y-auto py-1">
          {menuData.items.map((item, i) => {
            const focused = i === focus;
            return (
              <div
                key={i}
                onClick={() => onActivate(i)}
                className={
                  "trans-soft mx-1 flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 " +
                  (focused ? "kai-focus" : "text-slate-200")
                }
              >
                <span className="truncate text-[11px] font-medium">{item.label}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {item.value && (
                    <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[9px] font-medium text-slate-300">
                      {item.value}
                    </span>
                  )}
                  {item.active && (
                    <span className="flex h-3.5 w-3.5 items-center justify-center">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{
                          background: "linear-gradient(135deg,#6366f1,#a855f7)",
                          boxShadow: "0 0 8px 0 rgba(139,92,246,0.7)",
                        }}
                      />
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function HelpOverlay() {
  return (
    <div className="anim-fade absolute inset-0 z-[55] flex flex-col"
      style={{ background: "#06080f" }}
    >
      <div
        className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5"
        style={{
          background: "linear-gradient(180deg, rgba(99,102,241,0.14), transparent)",
        }}
      >
        <span
          className="flex h-5 w-5 items-center justify-center rounded-md"
          style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}
        >
          <SettingsIcon className="text-[12px] text-white" />
        </span>
        <span className="text-[12px] font-bold tracking-tight text-white">
          Keypad Controls
        </span>
      </div>
      <div className="no-scrollbar flex-1 overflow-y-auto px-2.5 py-2.5 pb-[34px]">
        {keymapLegend.map((g) => (
          <div key={g.title} className="mb-3.5">
            <div className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-violet-300">
              {g.title}
            </div>
            <div
              className="overflow-hidden rounded-xl"
              style={{ background: "rgba(255,255,255,0.03)" }}
            >
              {g.items.map((it, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-2 border-b border-white/5 px-2 py-1.5 last:border-b-0"
                >
                  <div className="flex flex-wrap items-center gap-1">
                    {it.keys.map((k) => (
                      <span
                        key={k}
                        className="min-w-[20px] rounded-md px-1.5 py-0.5 text-center text-[9px] font-bold text-violet-100"
                        style={{
                          background: "linear-gradient(180deg, rgba(99,102,241,0.28), rgba(99,102,241,0.14))",
                          boxShadow: "inset 0 0 0 1px rgba(167,155,242,0.32)",
                        }}
                      >
                        {k}
                      </span>
                    ))}
                  </div>
                  <span className="text-right text-[10px] text-slate-300">
                    {it.action}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
        <div
          className="mt-1 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[9px] text-slate-400"
          style={{ background: "rgba(255,255,255,0.03)" }}
        >
          <FullscreenIcon className="text-[11px] text-violet-300" />
          <span>Tip: press RSK / Back to return.</span>
        </div>
      </div>
    </div>
  );
}

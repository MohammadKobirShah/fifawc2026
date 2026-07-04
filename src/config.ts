import type { Server } from "./types";

const PROXY = "https://fifaworldcupproxy.qazslfdgcnedfcnuyhbv.workers.dev/";

export const servers: Server[] = [
  {
    name: "FOX FIFA EVENT",
    url:
      PROXY +
      "https://otte.cache.aiv-cdn.net/bom-nitro/live/clients/dash/enc/ajfoeddkbz/out/v1/b78800b9b2304879b15843f455836829/cenc.mpd",
    key: "f6564ec2aee819046328a0e153be574d:ff46a8a1031eb27ef22576a077c98ab7",
  },
  {
    name: "World Cup Tv",
    url:
      PROXY +
      "https://qp-pldt-live-bpk-ucd-prod.akamaized.net/bpk-tv/fifa_ppv1/default/index.mpd",
    key: "2c338a117d434ce4bbe3569231af90f1:a9633d901ee8a3f4f58ac314b5c5f4fb",
  },
  {
    name: "FOX ONE",
    url:
      PROXY +
      "https://otte.cache.aiv-cdn.net/iad-nitro/live/clients/enc/nqon6hgp0k/out/v1/9e895e2c1c894a75ac6d21a4deddd5d3/cenc.mpd",
    key: "f6564ec2aee819046328a0e153be574d:ff46a8a1031eb27ef22576a077c98ab7",
  },
  {
    name: "TSN",
    url:
      PROXY +
      "https://otte.cache.aiv-cdn.net/bom-nitro/live/clients/dash/enc/w0rehjjrwe/out/v1/69a2a7041395406b970598f61680e7cf/cenc.mpd",
    key: "14eeabf30c14b7fbf3008c03099ce011:17d2ac8dbc5429bd70af3433aa12158d",
  },
  {
    name: "Somoy TV",
    url: PROXY + "https://live.thebosstv.com:30443/dwlive/Somoy-TV/chunks.m3u8",
  },
  {
    name: "TVP Sports",
    url:
      PROXY +
      "https://proxy.cors.sh/https://1nyaler.streamhostingcdn.top/stream/89/index.m3u8",
  },
];

/** How long the on-screen controls stay visible while playing (ms). */
export const CONTROLS_HIDE_MS = 4000;

/** Available playback speeds (order matters for the menu + keypad focus). */
export const SPEEDS = [0.5, 1, 1.25, 1.5, 2];

export interface KeyLegendItem {
  keys: string[];
  action: string;
}
export interface KeyLegendGroup {
  title: string;
  items: KeyLegendItem[];
}

/** Shown on the "Full Keymap" help screen. Mirrors the live keymap in App.tsx. */
export const keymapLegend: KeyLegendGroup[] = [
  {
    title: "Playback",
    items: [
      { keys: ["OK", "5"], action: "Play / Pause" },
      { keys: ["◄", "4"], action: "Skip back 10s" },
      { keys: ["►", "6"], action: "Skip forward 10s" },
      { keys: ["1"], action: "Skip back 30s" },
      { keys: ["3"], action: "Skip forward 30s" },
      { keys: ["▲", "2"], action: "Volume up" },
      { keys: ["▼", "8"], action: "Volume down" },
      { keys: ["0"], action: "Mute / Unmute" },
    ],
  },
  {
    title: "Channels",
    items: [
      { keys: ["*", "LSK"], action: "Server list" },
      { keys: ["#", "RSK"], action: "Settings" },
      { keys: ["7"], action: "Previous channel" },
      { keys: ["9"], action: "Next channel" },
    ],
  },
  {
    title: "Menu navigation",
    items: [
      { keys: ["▲", "▼"], action: "Move selection" },
      { keys: ["OK", "LSK"], action: "Select item" },
      { keys: ["◄", "Back", "RSK"], action: "Back / close" },
    ],
  },
  {
    title: "Display",
    items: [
      { keys: ["Call"], action: "Fullscreen" },
      { keys: ["Back"], action: "Show / hide controls" },
    ],
  },
];

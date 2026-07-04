export interface Server {
  name: string;
  url: string;
  /** ClearKey in "kid:key" hex form (DASH/PlayReady clearkey) */
  key?: string;
}

/** Active on-screen menu / panel. */
export type MenuKind =
  | "none"
  | "server"
  | "settings"
  | "speed"
  | "quality"
  | "help";

export interface MenuItem {
  label: string;
  /** Optional trailing value chip, e.g. "Auto" / "720p". */
  value?: string;
  /** Whether this row is the currently selected option. */
  active?: boolean;
  onSelect: () => void;
}

export interface MenuData {
  kind: Exclude<MenuKind, "none" | "help">;
  header: string;
  /** Sub-menus show a back arrow and return to "settings". */
  sub?: boolean;
  items: MenuItem[];
}

export type FlashState = {
  type: "play" | "pause" | "seekBack" | "seekFwd";
  amount?: number;
  id: number;
};

declare global {
  interface Window {
    shaka?: any;
    Hls?: any;
  }
}

export {};

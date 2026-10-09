import type { FioDesktop } from "../desktop/renderer/types";
declare global {
  interface Window {
    fioDesktop: FioDesktop;
  }
}
export {};

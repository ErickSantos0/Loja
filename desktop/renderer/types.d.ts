import type { PublicState } from "../../lib/pos";

export type DesktopFailure = { error: string; status: number };
export type DesktopMutation = {
  action: string;
  input: Record<string, unknown>;
  requestId: string;
};
export type DesktopInfo = {
  operator: string;
  databasePath: string;
  version: string;
};

export interface FioDesktop {
  loadState(): Promise<PublicState | DesktopFailure>;
  mutate(
    body: DesktopMutation,
  ): Promise<{ state: PublicState; result: unknown } | DesktopFailure>;
  getInfo(): Promise<DesktopInfo>;
  setOperator(name: string): Promise<{ operator: string }>;
  backup(): Promise<{ cancelled: boolean; path?: string }>;
  restoreBackup(): Promise<{ cancelled: boolean; restarted?: boolean }>;
  importWebExport(): Promise<{ cancelled: boolean }>;
  printReceipt(): Promise<void>;
  revealData(): Promise<void>;
  pending: {
    get(): Promise<string | null>;
    set(raw: string): Promise<void>;
    clear(): Promise<void>;
  };
}

declare global {
  interface Window {
    fioDesktop: FioDesktop;
  }
}

import type { PonyAbcApi } from '@shared/types';

declare global {
  interface Window {
    ponyabc: PonyAbcApi;
  }
}

export {};

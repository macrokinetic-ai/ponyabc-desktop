import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { PenRootResult } from '@shared/types';

interface PenRootState {
  result: PenRootResult;
  restoring: boolean;
  selectPenRoot: () => Promise<void>;
}

const PenRootContext = createContext<PenRootState | null>(null);

export function PenRootProvider({ children }: { children: ReactNode }) {
  const [result, setResult] = useState<PenRootResult>({ status: 'none' });
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    let cancelled = false;
    window.ponyabc.restorePenRoot().then((restored) => {
      if (!cancelled) {
        setResult(restored);
        setRestoring(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectPenRoot = useCallback(async () => {
    const next = await window.ponyabc.selectPenRoot();
    if (next.status !== 'cancelled') setResult(next);
  }, []);

  return <PenRootContext.Provider value={{ result, restoring, selectPenRoot }}>{children}</PenRootContext.Provider>;
}

export function usePenRoot(): PenRootState {
  const ctx = useContext(PenRootContext);
  if (!ctx) throw new Error('usePenRoot must be used within a PenRootProvider');
  return ctx;
}

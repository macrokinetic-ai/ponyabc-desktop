import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ComputerFolderResult } from '@shared/types';

interface ComputerFolderState {
  result: ComputerFolderResult;
  restoring: boolean;
  selectFolder: () => Promise<void>;
}

const ComputerFolderContext = createContext<ComputerFolderState | null>(null);

export function ComputerFolderProvider({ children }: { children: ReactNode }) {
  const [result, setResult] = useState<ComputerFolderResult>({ status: 'none' });
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    let cancelled = false;
    window.ponyabc.restoreComputerFolder().then((restored) => {
      if (!cancelled) {
        setResult(restored);
        setRestoring(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectFolder = useCallback(async () => {
    const next = await window.ponyabc.selectComputerFolder();
    if (next.status !== 'cancelled') setResult(next);
  }, []);

  return <ComputerFolderContext.Provider value={{ result, restoring, selectFolder }}>{children}</ComputerFolderContext.Provider>;
}

export function useComputerFolder(): ComputerFolderState {
  const ctx = useContext(ComputerFolderContext);
  if (!ctx) throw new Error('useComputerFolder must be used within a ComputerFolderProvider');
  return ctx;
}

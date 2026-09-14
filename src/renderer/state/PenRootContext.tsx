import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PenRootResult, PenVolumeCandidate } from '@shared/types';

interface PenRootState {
  result: PenRootResult;
  restoring: boolean;
  scanning: boolean;
  /** Populated only while the last scan found multiple candidates awaiting a user choice. */
  candidates: PenVolumeCandidate[] | null;
  rescan: () => Promise<void>;
  chooseCandidate: (index: number) => Promise<void>;
  selectPenRoot: () => Promise<void>;
}

const PenRootContext = createContext<PenRootState | null>(null);

export function PenRootProvider({ children }: { children: ReactNode }) {
  const [result, setResult] = useState<PenRootResult>({ status: 'none' });
  const [restoring, setRestoring] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [candidates, setCandidates] = useState<PenVolumeCandidate[] | null>(null);
  const scanningRef = useRef(false); // guards against overlapping scans (poll trigger + manual click)

  const rescan = useCallback(async () => {
    if (scanningRef.current) return;
    scanningRef.current = true;
    setScanning(true);
    try {
      const scanResult = await window.ponyabc.scanForPenRoot();
      if (scanResult.status === 'choose') {
        setCandidates(scanResult.candidates);
        setResult({ status: 'none' });
      } else if (scanResult.status === 'none') {
        setCandidates(null);
        setResult({ status: 'none' });
      } else if (scanResult.status === 'error') {
        setCandidates(null);
        setResult({ status: 'error', message: scanResult.message });
      } else {
        // auto-selected
        setCandidates(null);
        setResult(scanResult);
      }
    } finally {
      setScanning(false);
      scanningRef.current = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await rescan();
      if (!cancelled) setRestoring(false);
    })();
    const unsubscribe = window.ponyabc.onPenVolumesChanged(() => {
      void rescan();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chooseCandidate = useCallback(async (index: number) => {
    const next = await window.ponyabc.chooseCandidatePenRoot(index);
    setResult(next);
    if (next.status === 'ok') setCandidates(null);
  }, []);

  const selectPenRoot = useCallback(async () => {
    const next = await window.ponyabc.selectPenRoot();
    if (next.status !== 'cancelled') {
      setResult(next);
      setCandidates(null);
    }
  }, []);

  return (
    <PenRootContext.Provider value={{ result, restoring, scanning, candidates, rescan, chooseCandidate, selectPenRoot }}>
      {children}
    </PenRootContext.Provider>
  );
}

export function usePenRoot(): PenRootState {
  const ctx = useContext(PenRootContext);
  if (!ctx) throw new Error('usePenRoot must be used within a PenRootProvider');
  return ctx;
}

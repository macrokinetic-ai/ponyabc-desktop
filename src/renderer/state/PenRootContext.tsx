import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PenRootResult, PenVolumeCandidate, VolumeDiagnostic } from '@shared/types';

interface PenRootState {
  result: PenRootResult;
  restoring: boolean;
  scanning: boolean;
  /** Populated only while the last scan found multiple candidates awaiting a user choice. */
  candidates: PenVolumeCandidate[] | null;
  /** Volumes the last scan checked but rejected — surfaced so "nothing found" and "found a
   *  drive, but it's missing DIY" don't look identical. Cleared once a pen is selected. */
  diagnostics: VolumeDiagnostic[] | null;
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
  const [diagnostics, setDiagnostics] = useState<VolumeDiagnostic[] | null>(null);
  const scanningRef = useRef(false); // guards against overlapping scans (poll trigger + manual click)

  const rescan = useCallback(async () => {
    if (scanningRef.current) return;
    scanningRef.current = true;
    setScanning(true);
    try {
      const scanResult = await window.ponyabc.scanForPenRoot();
      if (scanResult.status === 'choose') {
        setCandidates(scanResult.candidates);
        setDiagnostics(null);
        setResult({ status: 'none' });
      } else if (scanResult.status === 'none') {
        setCandidates(null);
        setDiagnostics(scanResult.diagnostics ?? null);
        setResult({ status: 'none' });
      } else if (scanResult.status === 'error') {
        setCandidates(null);
        setDiagnostics(null);
        setResult({ status: 'error', message: scanResult.message });
      } else {
        // auto-selected
        setCandidates(null);
        setDiagnostics(null);
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
    if (next.status === 'ok') {
      setCandidates(null);
      setDiagnostics(null);
    }
  }, []);

  const selectPenRoot = useCallback(async () => {
    const next = await window.ponyabc.selectPenRoot();
    if (next.status !== 'cancelled') {
      setResult(next);
      setCandidates(null);
      setDiagnostics(null);
    }
  }, []);

  return (
    <PenRootContext.Provider value={{ result, restoring, scanning, candidates, diagnostics, rescan, chooseCandidate, selectPenRoot }}>
      {children}
    </PenRootContext.Provider>
  );
}

export function usePenRoot(): PenRootState {
  const ctx = useContext(PenRootContext);
  if (!ctx) throw new Error('usePenRoot must be used within a PenRootProvider');
  return ctx;
}

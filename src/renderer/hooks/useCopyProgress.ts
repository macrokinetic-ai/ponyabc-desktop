import { useEffect, useRef, useState } from 'react';
import type { CopyProgressEvent } from '@shared/types';

export function useCopyProgress() {
  const [progress, setProgress] = useState<CopyProgressEvent | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    unsubscribeRef.current = window.ponyabc.onCopyProgress(setProgress);
    return () => unsubscribeRef.current?.();
  }, []);

  const reset = () => setProgress(null);

  return { progress, reset };
}

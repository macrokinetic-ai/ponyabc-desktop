import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioPreviewResult, AudioSource } from '@shared/types';

export interface AudioPreviewState {
  source: AudioSource;
  fileName: string;
  status: 'loading' | 'ready' | 'error';
  errorStatus?: AudioPreviewResult['status'];
  playing: boolean;
  duration: number;
  currentTime: number;
}

/**
 * Owns exactly one shared <audio> element for both panes — playing a new file always stops
 * and releases whatever was playing before, per the "one file at a time" requirement. The
 * object URL is revoked on every stop/replace/unmount so nothing leaks. This hook never
 * touches disk itself; it only ever asks the main process (via readAudioPreview) for bytes
 * from an already-authorized location.
 */
export function useAudioPreview() {
  const [state, setState] = useState<AudioPreviewState | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  // Guards against a slow-resolving IPC call from a previous play() overwriting state after
  // a newer play()/stop() has already superseded it.
  const requestIdRef = useRef(0);

  const releaseUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    requestIdRef.current += 1;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    releaseUrl();
    setState(null);
  }, [releaseUrl]);

  const play = useCallback(
    async (source: AudioSource, fileName: string) => {
      requestIdRef.current += 1;
      const myRequestId = requestIdRef.current;
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
      releaseUrl();
      setState({ source, fileName, status: 'loading', playing: false, duration: 0, currentTime: 0 });

      const result = await window.ponyabc.readAudioPreview({ source, fileName });
      if (requestIdRef.current !== myRequestId) return; // superseded by a newer play()/stop()

      if (result.status !== 'ok') {
        setState({ source, fileName, status: 'error', errorStatus: result.status, playing: false, duration: 0, currentTime: 0 });
        return;
      }

      try {
        const byteChars = atob(result.base64);
        const bytes = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
        const blob = new Blob([bytes], { type: result.mimeType });
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        if (!audioRef.current) return;
        audioRef.current.src = url;
        await audioRef.current.play();
        if (requestIdRef.current !== myRequestId) return;
        setState((prev) => (prev && prev.source === source && prev.fileName === fileName ? { ...prev, status: 'ready', playing: true } : prev));
      } catch {
        if (requestIdRef.current !== myRequestId) return;
        setState({ source, fileName, status: 'error', errorStatus: 'error', playing: false, duration: 0, currentTime: 0 });
      }
    },
    [releaseUrl],
  );

  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !state || state.status !== 'ready') return;
    if (audio.paused) void audio.play();
    else audio.pause();
  }, [state]);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = time;
  }, []);

  // Stop playback for a source whose underlying folder/device just changed identity, so a
  // pen swap or computer-folder change never leaves a preview referencing a now-invalid file.
  const stopIfSource = useCallback(
    (source: AudioSource) => {
      setState((prev) => {
        if (!prev || prev.source !== source) return prev;
        const audio = audioRef.current;
        if (audio) {
          audio.pause();
          audio.removeAttribute('src');
          audio.load();
        }
        releaseUrl();
        requestIdRef.current += 1;
        return null;
      });
    },
    [releaseUrl],
  );

  useEffect(() => releaseUrl, [releaseUrl]); // release on unmount

  const audioEventHandlers = {
    onTimeUpdate: () => {
      const audio = audioRef.current;
      if (!audio) return;
      setState((prev) => (prev ? { ...prev, currentTime: audio.currentTime } : prev));
    },
    onLoadedMetadata: () => {
      const audio = audioRef.current;
      if (!audio) return;
      setState((prev) => (prev ? { ...prev, duration: Number.isFinite(audio.duration) ? audio.duration : 0 } : prev));
    },
    onEnded: () => {
      setState((prev) => (prev ? { ...prev, playing: false, currentTime: 0 } : prev));
    },
    onPause: () => {
      setState((prev) => (prev ? { ...prev, playing: false } : prev));
    },
    onPlay: () => {
      setState((prev) => (prev ? { ...prev, playing: true } : prev));
    },
    onError: () => {
      setState((prev) => (prev ? { ...prev, status: 'error', errorStatus: 'error', playing: false } : prev));
    },
  };

  return { state, audioRef, play, stop, stopIfSource, togglePlayPause, seek, audioEventHandlers };
}

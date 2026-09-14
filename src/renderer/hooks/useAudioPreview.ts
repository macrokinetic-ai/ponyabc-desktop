import { useCallback, useEffect, useRef, useState } from 'react';
import { MPEGDecoder } from 'mpg123-decoder';
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
 * Real pen recordings are frequently MPEG-1/2 **Layer II** despite the ".mp3" extension —
 * confirmed against an actual pen-recorded file (`afinfo`/`file` showed "layer II" / ".mp2"),
 * and Chromium's native <audio> element only decodes Layer III (true MP3), so it silently
 * failed on every real pen recording tested. This hook instead decodes MPEG audio (Layer
 * I/II/III, all of it) locally via `mpg123-decoder` — a small (~80KB) WASM build of the
 * well-established mpg123 decoder, MIT-licensed, no network access — into raw PCM, then plays
 * that PCM through the Web Audio API. Nothing is uploaded; decoding is exactly as local as the
 * byte read that already happens over IPC.
 *
 * One shared AudioContext + decoder instance for both panes; only one file plays at a time.
 * AudioBufferSourceNode has no native pause/resume, so play position is tracked manually
 * (`offsetRef` + `startedAtRef` against `audioContext.currentTime`) and pausing means stopping
 * the node and remembering the elapsed offset, resuming means starting a fresh node from it.
 */
export function useAudioPreview() {
  const [state, setState] = useState<AudioPreviewState | null>(null);
  // Mirrors `state`, always kept in sync via setStateAndRef below (see its comment for why).
  const stateRef = useRef<AudioPreviewState | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const decoderRef = useRef<MPEGDecoder | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const startedAtRef = useRef(0);
  const offsetRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);

  // React 18 StrictMode double-invokes the *function* form of a state setter to catch impure
  // updaters — confirmed via CDP that a naive `setState(prev => { sideEffect(); return next })`
  // pattern silently corrupted play/pause/seek here (toggling pause visibly flipped back).
  // This wrapper keeps `stateRef.current` synchronously accurate for togglePlayPause/seek/
  // stopIfSource to read, so those can run their side effect exactly once as a plain function
  // body and hand setState a plain value — never a function with a side effect inside it.
  const setStateAndRef = useCallback((next: AudioPreviewState | null) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const getAudioContext = useCallback((): AudioContext => {
    if (!audioContextRef.current) audioContextRef.current = new AudioContext();
    return audioContextRef.current;
  }, []);

  const getDecoder = useCallback(async (): Promise<MPEGDecoder> => {
    if (!decoderRef.current) {
      const decoder = new MPEGDecoder();
      await decoder.ready;
      decoderRef.current = decoder;
    }
    return decoderRef.current;
  }, []);

  const stopTicking = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const tick = useCallback(() => {
    const ctx = audioContextRef.current;
    if (!ctx) return;
    // Pure recomputation from refs, no side effect — safe under StrictMode double-invocation.
    setState((prev) => {
      if (!prev || !prev.playing) return prev;
      const elapsed = offsetRef.current + (ctx.currentTime - startedAtRef.current);
      const next = { ...prev, currentTime: Math.min(elapsed, prev.duration) };
      stateRef.current = next;
      return next;
    });
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopSourceNode = useCallback(() => {
    const node = sourceNodeRef.current;
    if (node) {
      node.onended = null;
      try {
        node.stop();
      } catch {
        // already stopped/never started — fine
      }
      node.disconnect();
      sourceNodeRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    requestIdRef.current += 1;
    stopTicking();
    stopSourceNode();
    bufferRef.current = null;
    offsetRef.current = 0;
    startedAtRef.current = 0;
    setStateAndRef(null);
  }, [setStateAndRef, stopSourceNode, stopTicking]);

  const startFrom = useCallback(
    (offsetSeconds: number) => {
      const buffer = bufferRef.current;
      if (!buffer) return;
      const ctx = getAudioContext();
      stopSourceNode();
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(ctx.destination);
      node.onended = () => {
        // A seek/pause/stop already moved sourceNodeRef on to something else (or null) by the
        // time this fires for the node it replaced — only a real end-of-playback should act.
        if (sourceNodeRef.current !== node) return;
        stopTicking();
        sourceNodeRef.current = null;
        const prev = stateRef.current;
        if (prev) setStateAndRef({ ...prev, playing: false, currentTime: prev.duration });
      };
      node.start(0, offsetSeconds);
      sourceNodeRef.current = node;
      startedAtRef.current = ctx.currentTime;
      offsetRef.current = offsetSeconds;
    },
    [getAudioContext, setStateAndRef, stopSourceNode, stopTicking],
  );

  const play = useCallback(
    async (source: AudioSource, fileName: string) => {
      requestIdRef.current += 1;
      const myRequestId = requestIdRef.current;
      stopTicking();
      stopSourceNode();
      bufferRef.current = null;
      setStateAndRef({ source, fileName, status: 'loading', playing: false, duration: 0, currentTime: 0 });

      const result = await window.ponyabc.readAudioPreview({ source, fileName });
      if (requestIdRef.current !== myRequestId) return; // superseded by a newer play()/stop()

      if (result.status !== 'ok') {
        setStateAndRef({ source, fileName, status: 'error', errorStatus: result.status, playing: false, duration: 0, currentTime: 0 });
        return;
      }

      try {
        const byteChars = atob(result.base64);
        const bytes = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);

        const decoder = await getDecoder();
        if (requestIdRef.current !== myRequestId) return;
        await decoder.reset();
        const decoded = decoder.decode(bytes);
        if (requestIdRef.current !== myRequestId) return;
        if (decoded.samplesDecoded === 0) {
          setStateAndRef({ source, fileName, status: 'error', errorStatus: 'error', playing: false, duration: 0, currentTime: 0 });
          return;
        }

        const ctx = getAudioContext();
        if (ctx.state === 'suspended') await ctx.resume();
        const audioBuffer = ctx.createBuffer(decoded.channelData.length, decoded.samplesDecoded, decoded.sampleRate);
        decoded.channelData.forEach((channel, i) => audioBuffer.copyToChannel(new Float32Array(channel), i));
        bufferRef.current = audioBuffer;

        setStateAndRef({ source, fileName, status: 'ready', playing: true, duration: audioBuffer.duration, currentTime: 0 });
        startFrom(0);
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        if (requestIdRef.current !== myRequestId) return;
        setStateAndRef({ source, fileName, status: 'error', errorStatus: 'error', playing: false, duration: 0, currentTime: 0 });
      }
    },
    [getAudioContext, getDecoder, setStateAndRef, startFrom, stopSourceNode, stopTicking, tick],
  );

  const togglePlayPause = useCallback(() => {
    const ctx = audioContextRef.current;
    const prev = stateRef.current;
    if (!ctx || !prev || prev.status !== 'ready') return;
    if (prev.playing) {
      const elapsed = Math.min(offsetRef.current + (ctx.currentTime - startedAtRef.current), prev.duration);
      stopSourceNode();
      stopTicking();
      offsetRef.current = elapsed;
      setStateAndRef({ ...prev, playing: false, currentTime: elapsed });
    } else {
      startFrom(offsetRef.current);
      rafRef.current = requestAnimationFrame(tick);
      setStateAndRef({ ...prev, playing: true });
    }
  }, [setStateAndRef, startFrom, stopSourceNode, stopTicking, tick]);

  const seek = useCallback(
    (time: number) => {
      const prev = stateRef.current;
      if (!prev || prev.status !== 'ready') return;
      const clamped = Math.max(0, Math.min(time, prev.duration));
      if (prev.playing) startFrom(clamped);
      else offsetRef.current = clamped;
      setStateAndRef({ ...prev, currentTime: clamped });
    },
    [setStateAndRef, startFrom],
  );

  // Stop playback for a source whose underlying folder/device just changed identity, so a pen
  // swap or computer-folder change never leaves a preview referencing a now-invalid file.
  const stopIfSource = useCallback(
    (source: AudioSource) => {
      const prev = stateRef.current;
      if (!prev || prev.source !== source) return;
      requestIdRef.current += 1;
      stopTicking();
      stopSourceNode();
      bufferRef.current = null;
      offsetRef.current = 0;
      startedAtRef.current = 0;
      setStateAndRef(null);
    },
    [setStateAndRef, stopSourceNode, stopTicking],
  );

  useEffect(
    () => () => {
      stopTicking();
      stopSourceNode();
      decoderRef.current?.free();
      void audioContextRef.current?.close();
    },
    [stopSourceNode, stopTicking],
  );

  return { state, play, stop, stopIfSource, togglePlayPause, seek };
}

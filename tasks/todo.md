# v0.2.7 — fix MP3 preview: real pen recordings are MPEG Layer II, not Layer III

User tested v0.2.6 with a real physical pen on their MacBook Pro: preview failed
("format not supported") on real recordings. Root-caused with the actual uploaded
file, not guessed.

- [x] Diagnosed via the user's real uploaded `0001.MP3`: `file`/`afinfo` confirmed
      **MPEG-1 Layer II** (`.mp2` data), not Layer III (true MP3) — Chromium's native
      `<audio>` element only decodes Layer III, so it correctly (if unhelpfully)
      rejected every real pen recording. Confirmed this is why it played fine in
      QuickTime/Finder (CoreAudio decodes Layer II) but not in the app.
- [x] Replaced the native `<audio>`-element playback engine with a local WASM
      decode (`mpg123-decoder`, MIT, ~80KB, decodes Layer I/II/III) → raw PCM → Web
      Audio API (`AudioBufferSourceNode`) playback. Verified decode of the actual
      real pen file directly in Node before wiring it in.
- [x] CSP: added `'wasm-unsafe-eval'` to `script-src` — required for
      `WebAssembly.compile()`, confirmed empirically (it failed with an exact CSP
      violation error without it, succeeded with it). This is the CSP3-specified
      narrow token for WASM compilation specifically — does NOT enable `eval()`/
      `Function()`/arbitrary string-to-code execution the way `'unsafe-eval'` does.
- [x] Found and fixed a real bug during CDP testing of the new engine: pause/resume
      visibly flipped back to the wrong icon. Root cause: React 18 StrictMode
      double-invokes the *function* form of a state setter to catch impure
      updaters, and `togglePlayPause`/`seek`/`stopIfSource` had side effects (start/
      stop audio nodes) inside `setState(prev => ...)`. Fixed by moving side effects
      out into plain function bodies reading a `stateRef` mirror, calling `setState`
      with a plain value only. Added a StrictMode-wrapped regression test
      (`renderScreenStrict`) that reproduces and verifies the exact fix — unit tests
      without StrictMode would never have caught this (confirmed: only the real CDP
      run against the StrictMode-wrapped production render surfaced it).
- [x] Re-verified via CDP against the actual real pen file: play/pause/seek/natural-
      end-of-clip all correct; also re-verified the "corrupt file" decode-error path
      still shows a clean message via the new engine (mocked decode failure in
      unit tests, since a genuinely corrupt fixture is hard to construct reliably)
- [x] Updated tests: mocked `mpg123-decoder` (deterministic fake decoder) + a
      minimal `FakeAudioContext` (jsdom has neither WASM-audio nor Web Audio APIs
      pre-wired for this); 157 tests total (+2 vs v0.2.6: decode-failure path,
      StrictMode play/pause regression), typecheck clean
- [x] Bump version 0.2.7, commit (b82c777), tag (does not overwrite v0.2.6), push
- [x] Built mac dmgs from the tagged commit; both pass codesign --verify
- [x] Final CDP pass on the packaged build with the real pen file: play/pause
      (time genuinely freezes)/resume/natural-end all correct; 820px layout with
      the player bar active has zero overlap (screenshot confirmed)
- [x] gh release create v0.2.7, 3 installers + sha256, notes explain the real root
      cause (Layer II vs Layer III); re-downloaded published dmg, checksum matches
- [x] Final Traditional Chinese report

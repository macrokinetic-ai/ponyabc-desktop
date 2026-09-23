# Certification note — PonyABC Desktop v0.3.16.0 (resubmission for 10.1.1.11 On Device Tiles)

The v0.3.15 package shipped the packaging tool's default sample (Electron atom) artwork for
StoreLogo, Square44x44Logo, Square150x150Logo and Wide310x150Logo. This was our packaging
error: we had supplied no custom assets, so the tool substituted its defaults.

Fix in v0.3.16.0: all tile/logo assets referenced by AppxManifest.xml — StoreLogo, Square44x44Logo
(including target-size and unplated variants), Square71x71 (SmallTile), Square150x150Logo,
Wide310x150Logo and Square310x310 (LargeTile) — are now generated from the official PonyABC logo at
all standard scales (100–400%) and indexed in resources.pri. The embedded executable icon
(PonyABC Desktop.exe) is the same logo. No default artwork remains in the package.
Package identity and publisher are unchanged; only the version increased (0.3.15.0 -> 0.3.16.0).
Application behaviour is unchanged.

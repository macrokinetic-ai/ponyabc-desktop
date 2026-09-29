This submission addresses certification issue 10.1.1.11 — On Device Tiles.

In package 0.3.15.0, the packaged tile/logo assets incorrectly used the packaging tool's default Electron artwork.

Package 0.3.16.0 replaces these assets with the official PonyABC logo, including all manifest-referenced tile/logo images and their scale variants. The final APPX was extracted and checked to confirm the assets are present and the default artwork has been removed.

The package identity and publisher remain unchanged. Firmware functionality is unchanged.

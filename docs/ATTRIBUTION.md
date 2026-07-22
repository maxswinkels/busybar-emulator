# Third-party assets

All assets listed below are sourced from the open-source firmware repository https://github.com/busy-app/busybar-firmware and are copyright © Flipper Devices.

## Graphics (CC-BY 4.0)

**`public/animations/`**: 72×16 status and effect animation frames (all 12 status themes: keep_out, dnd, meeting, on_call, lunch, back_soon, booked, flow, chill_time, on_air, coding, low_social_battery; plus effects: indicator_busy_72x16, finished_confetti_72x16, etc.). Licensed under CC-BY 4.0 (attribution required).

**`public/icons/`** and **`public/icons.json`**: Stock icon set (66 SVG icons from the device draw tool: faces/emoji-grinning, sun, cloud, heart, check, bolt, and more). Licensed under CC-BY 4.0 (attribution required).

**`public/brand/`** and **`.github/logo.svg`**: BUSY logo, app icon and device render (busybar-device.png illustration used in the web UI; favicon used as the repository logo). Licensed under CC-BY 4.0 (attribution required).

## Fonts (SIL OFL 1.1)

**`public/fonts/*.ttf`**: Pixel and proportional typefaces:
- busy_tiny, busy_regular_5px, busy_regular_7px, busy_condensed_7px, busy_bold_7px, busy_regular_9px, busy_bold_10px (Flipper BUSY Bar device fonts)
- LanaPixel (UI font)
- Inter (fallback)

All licensed under the SIL Open Font License, version 1.1.

**`public/fonts/font-atlas.json`**: Derived work. This glyph atlas is a baked artifact created with lv_font_conv using the same parameters as the firmware, mapping the above fonts to a 1-bpp bitmap atlas for efficient browser rendering. The atlas inherits the OFL 1.1 license from its source fonts.

## Attribution

This project bundles these assets to enable faithful prototyping against the BUSY Bar API. "BUSY Bar" is a product of Flipper Devices Inc.; this project is unaffiliated and unofficial.

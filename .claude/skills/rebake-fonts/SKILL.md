---
name: rebake-fonts
description: Regenerate public/fonts/font-atlas.json from the device TTFs using the firmware's exact lv_font_conv parameters, then bake with tools/build_font_atlas.py. Use when a device TTF changed or the atlas is stale/corrupt. Overwrites a committed asset and changes on-screen text for the whole app.
disable-model-invocation: true
---

# Rebake the font atlas

Regenerates `public/fonts/font-atlas.json`, the baked 1-bpp glyph atlas that the
renderer draws all matrix text from (`web/src/lib/atlas.js`). Glyphs are made
pixel-identical to the hardware by using the firmware's own `lv_font_conv`
parameters (see `tools/README.md`). **Changing the atlas changes on-screen text
for the entire app**, which is why this skill is user-invoked only.

## Prerequisites

- **Node.js / npx**: `lv_font_conv` runs via `npx lv_font_conv` (downloads on first use).
- **python3**: for `tools/build_font_atlas.py` (stdlib only, no pip installs).

All commands below run from the repo root (`build_font_atlas.py` looks for the
`d_<font>` dump directories relative to the current working directory).

## Step 1: dump each TTF with lv_font_conv

The firmware parameters (from `tools/README.md` / the firmware's `convert_all.sh`):
`--bpp 1 --no-compress --format dump --range 0x20-0x7E,0xB0 --size 16`, with two
exceptions, `busy_tiny` uses `--size 6` and drops `0xB0` from the range, and
`LanaPixel` uses `--size 11`.

`build_font_atlas.py` expects one dump directory per atlas font, named `d_<font>`
for each of its eight fonts: `tiny small normal condensed bold large extra_large global`
(each directory holds lv_font_conv's `font_info.json` plus one `<hexcode>.png` per glyph).
So output each dump with `-o d_<font>`:

```bash
cd /path/to/busybar-emulator

npx lv_font_conv --font public/fonts/busy_tiny.ttf         -o d_tiny        --bpp 1 --size 6  --no-compress --format dump --range 0x20-0x7E
npx lv_font_conv --font public/fonts/busy_regular_5px.ttf  -o d_small       --bpp 1 --size 16 --no-compress --format dump --range 0x20-0x7E,0xB0
npx lv_font_conv --font public/fonts/busy_regular_7px.ttf  -o d_normal      --bpp 1 --size 16 --no-compress --format dump --range 0x20-0x7E,0xB0
npx lv_font_conv --font public/fonts/busy_condensed_7px.ttf -o d_condensed  --bpp 1 --size 16 --no-compress --format dump --range 0x20-0x7E,0xB0
npx lv_font_conv --font public/fonts/busy_bold_7px.ttf     -o d_bold        --bpp 1 --size 16 --no-compress --format dump --range 0x20-0x7E,0xB0
npx lv_font_conv --font public/fonts/busy_regular_9px.ttf  -o d_large       --bpp 1 --size 16 --no-compress --format dump --range 0x20-0x7E,0xB0
npx lv_font_conv --font public/fonts/busy_bold_10px.ttf    -o d_extra_large --bpp 1 --size 16 --no-compress --format dump --range 0x20-0x7E,0xB0
npx lv_font_conv --font public/fonts/LanaPixel.ttf         -o d_global      --bpp 1 --size 11 --no-compress --format dump --range 0x20-0x7E,0xB0
```

Do not invent other sizes or ranges, these must match the firmware exactly or
on-screen text will no longer be pixel-identical to the hardware.

## Step 2: bake the atlas

```bash
python3 tools/build_font_atlas.py public/fonts/font-atlas.json
```

It prints one line per font (`<font> ok: NN glyphs, lineh N`) and finishes with
`wrote public/fonts/font-atlas.json <bytes> bytes`. All eight fonts must appear;
a missing line means its `d_<font>` directory was absent or misnamed.

## Step 3: clean up the dump dirs

```bash
rm -rf d_tiny d_small d_normal d_condensed d_bold d_large d_extra_large d_global
```

## Step 4: verify

1. Check what actually changed:
   ```bash
   git diff --stat public/fonts/font-atlas.json
   ```
   If you only rebaked (no TTF changes), expect no diff or a trivial one.
2. Eyeball the result in the running emulator (`npm start`, then e.g.
   `python3 apps/clock.py`), glyphs should look crisp and identical to before
   unless the TTFs changed. Text in every font of every app renders from this
   atlas, so regressions are immediately visible.
3. If the result looks wrong, restore with `git checkout -- public/fonts/font-atlas.json`.

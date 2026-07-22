# Font atlas

`public/fonts/font-atlas.json` holds the device glyphs as 1-bpp bitmaps, baked
from the TTFs with the firmware's own tool and parameters (convert_all.sh):

```bash
npx lv_font_conv --font public/fonts/busy_bold_10px.ttf -o dump --bpp 1 --size 16 \
    --no-compress --format dump --range 0x20-0x7E,0xB0
# (busy_tiny at --size 6, LanaPixel at --size 11; tiny has no 0xB0)
python3 tools/build_font_atlas.py public/fonts/font-atlas.json   # from the dump dirs
```

The renderer draws matrix text from this atlas, so glyphs are pixel-identical
to the hardware.

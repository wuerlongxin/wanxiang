# Bundled Fonts

These fonts are bundled locally so the interface has consistent Chinese typography without a network connection. The WOFF2 files are unmodified region-specific Simplified Chinese variable-font releases from Adobe.

## Source Han Sans CN Variable

- Role: body text, controls, metadata, and small labels
- Version: 2.005R
- Weight axis: 250-900
- File: `source-han-sans-cn-vf.woff2` (7,995,716 bytes)
- SHA-256: `7087698d52240614659957608d8c4ad446759aee3208409dc9f566412e7af8f4`
- Official source: <https://github.com/adobe-fonts/source-han-sans/blob/release/Variable/WOFF2/OTF/Subset/SourceHanSansCN-VF.otf.woff2>
- License: SIL Open Font License 1.1; see `OFL-Source-Han-Sans.txt`

## Source Han Serif CN Variable

- Role: display headings, card titles, and brand typography
- Version: 2.003R
- Weight axis: 250-900
- File: `source-han-serif-cn-vf.woff2` (10,421,244 bytes)
- SHA-256: `808cb3203bb9cdd6b166a8a656a0c7608a7dc2a31c41c2cd0374550cae445471`
- Official source: <https://github.com/adobe-fonts/source-han-serif/blob/release/Variable/WOFF2/OTF/Subset/SourceHanSerifCN-VF.otf.woff2>
- License: SIL Open Font License 1.1; see `OFL-Source-Han-Serif.txt`

## Fallback Strategy

Body text falls back to PingFang SC, Microsoft YaHei, Noto Sans CJK SC, then the generic sans-serif family. Display text falls back to Songti SC, STSong, Noto Serif CJK SC, then the generic serif family. The app waits for the bundled faces before Pixi creates its first text textures; the fallback stack remains available if either local asset cannot be decoded.

## Pixi Text Rendering

Pixi canvas text keeps its auto-resolution mode, so each generated text texture follows the renderer resolution. The renderer uses the app's viewport-aware 1-2x DPR cap and physical-pixel budget, rounds rendered coordinates to device pixels, and uses the body font stack as the default `TextStyle`. This improves small-label clarity without adding a stroke or shadow to every label.

#!/usr/bin/env python3
"""Export the approved Tongji sketches and existing logos; never alter the masters.

Run: uv run --with pillow python scripts/prepare-site-art.py [--panorama]
Native Flare responses and downloaded references live in the ignored study directory.
"""

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageOps

ROOT = Path(__file__).resolve().parent.parent
STUDY = ROOT / "reference/artwork/tongji-20260916"
OUTPUT = STUDY / "delivery"
RECORD = ROOT / "assets/site/tongji-20260916"
CDN = "https://t.no.mt/ellie/site/1.10.1"
PALETTE = {"light": (82, 104, 120), "dark": (183, 199, 209)}
PAPER = {"light": (250, 251, 252), "dark": (24, 31, 39)}


def record(path, source, size, cdn=CDN, **extra):
    return {"file": path.name, "url": f"{cdn}/{path.name}", "source": source,
            "width": size[0], "height": size[1], "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), **extra}


def exports(image, stem, widths, theme, source, pencil_color=None, *, output=OUTPUT, cdn=CDN):
    items = []
    for width in widths:
        size = (width, round(image.height * width / image.width))
        scaled = image.resize(size, Image.Resampling.LANCZOS)
        if pencil_color:
            # Restore a uniform pencil color after premultiplied-alpha resampling.
            # 64 alpha levels differ by < 1 display level at the UI's opacity.
            alpha = scaled.getchannel("A").point(lambda v: min(255, round(v / 4) * 4))
            scaled = Image.new("RGBA", size, pencil_color)
            scaled.putalpha(alpha)
        for extension in ("webp", "jpg", *(["png"] if width == max(widths) else [])):
            path = output / f"{stem}-{width}.{extension}"
            pending = output / f".{stem}-{width}.{extension}"
            if extension == "jpg":
                flat = Image.new("RGB", size, PAPER[theme])
                flat.paste(scaled, mask=scaled.getchannel("A"))
                flat.save(pending, quality=88, subsampling=0, optimize=True, progressive=True)
            elif extension == "webp":
                scaled.save(pending, quality=88, method=6, exact=True)
            else:
                scaled.save(pending, optimize=True)
            pending.replace(path)
            items.append(record(path, source, size, cdn=cdn, theme=theme, alpha=extension != "jpg"))
    return items


def pencil_layer(original, crop, panorama=False):
    image = original.crop(crop).convert("RGB")
    # Remove the near-white paper; retain continuous alpha in individual pencil strokes.
    alpha = ImageOps.grayscale(image).point(lambda v: round(max(0, min(255, (247 - v) * 1.65))))
    edge = Image.new("L", (image.width, 1))
    if panorama:
        edge.putdata([round(255 * min(1, x / (image.width * 0.12),
                                     (image.width - 1 - x) / (image.width * 0.12)))
                      for x in range(image.width)])
    else:
        edge.putdata([round(255 * min(1, x / (image.width * 0.3))) for x in range(image.width)])
    alpha = ImageChops.multiply(alpha, edge.resize(image.size))
    # A short feather at the sheet edges prevents a rectangular image boundary.
    vertical = Image.new("L", (1, image.height))
    vertical.putdata([round(255 * min(1, y / 24, (image.height - 1 - y) / 40))
                      for y in range(image.height)])
    return ImageChops.multiply(alpha, vertical.resize(image.size))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--panorama", action="store_true", help="Export the wider v1.10.2 forum art")
    panorama = parser.parse_args().panorama
    study = ROOT / "reference/artwork/tongji-panorama-20260916" if panorama else STUDY
    output = study / "delivery"
    archive = ROOT / "assets/site/tongji-panorama-20260916" if panorama else RECORD
    cdn = "https://t.no.mt/ellie/site/1.10.2" if panorama else CDN
    output.mkdir(parents=True, exist_ok=True)
    archive.mkdir(parents=True, exist_ok=True)
    items = []
    # Crop only surplus paper/water; preserve the complete spires and tree crowns.
    crops = ({"header": (0, 208, 3072, 848), "footer": (0, 144, 3072, 928)} if panorama else
             {"header": (0, 180, 1536, 984), "footer": (0, 64, 1536, 1008),
              "admin": (0, 64, 1024, 1008)})
    for name, crop in crops.items():
        source = study / name / "original.png"
        alpha = pencil_layer(Image.open(source), crop, panorama)
        for theme, color in PALETTE.items():
            layer = Image.new("RGBA", alpha.size, color)
            layer.putalpha(alpha)
            widths = ([768, 1536, 3072] if panorama else
                      [384, 768, 1536] if name != "admin" else [192, 384, 768])
            items.extend(exports(layer, f"{name}-{theme}", widths, theme,
                                 f"{name}/original.png", color, output=output, cdn=cdn))

    if not panorama:
        for theme in PALETTE:
            source = STUDY / "legacy" / f"Logo-{theme}-2.png"
            items.extend(exports(Image.open(source).convert("RGBA"), f"forum-logo-{theme}",
                                 [120, 240, 360, 600], theme, f"legacy/{source.name}"))

        # Keep the existing transparent elephant foreground used by the admin UI.
        items.extend(exports(Image.open(ROOT / "logo.png").convert("RGBA"), "admin-logo",
                             [24, 48, 96, 192, 384, 768], "light", "logo.png"))

    originals = []
    for name in crops:
        path = study / name / "original.png"
        originals.append({"name": name, "url": f"{cdn}/originals/{name}.png",
                          "bytes": path.stat().st_size,
                          "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
    manifest = {"cdn": cdn, "bucket": "tongjinet", "prefix": cdn.removeprefix("https://t.no.mt/") + "/",
                "generatedWith": "gpt-image-2.5-flare", "crops": crops,
                "originals": originals, "files": items}
    (archive / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent="\t") + "\n")
    for name in crops:
        for suffix in ["prompt.txt", "request.json", "response.json"]:
            target = archive / f"{name}-{suffix}"
            target.write_bytes((study / name / suffix).read_bytes())
    print(f"Exported {len(items)} assets ({sum(i['bytes'] for i in items):,} bytes)")
    for i in items:
        if i["file"].endswith("-1536.webp" if panorama else "-768.webp") or i["file"].endswith("-240.webp"):
            print(f"{i['file']}: {i['width']} × {i['height']}, {i['bytes']:,} bytes")


if __name__ == "__main__":
    main()

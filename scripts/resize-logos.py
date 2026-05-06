#!/usr/bin/env python3
"""Generate derived logo assets from root logo.png (Basalt B-3 spec).

Only generates assets for the admin backend — frontend favicon is untouched.
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "logo.png"
PUBLIC = ROOT / "apps" / "web" / "public"
ADMIN_APP = ROOT / "apps" / "web" / "src" / "app" / "(admin)"
OG_BG = (15, 15, 15)


def resize(img: Image.Image, size: int) -> Image.Image:
    return img.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    img = Image.open(SOURCE).convert("RGBA")

    PUBLIC.mkdir(parents=True, exist_ok=True)
    ADMIN_APP.mkdir(parents=True, exist_ok=True)

    # public/ — sidebar, display, and login assets
    for size in [24, 80, 192]:
        resize(img, size).save(PUBLIC / f"logo-{size}.png", "PNG", optimize=True)

    # (admin)/ — Next.js file-convention metadata (admin-only favicon)
    resize(img, 32).save(ADMIN_APP / "icon.png", "PNG", optimize=True)
    resize(img, 180).save(ADMIN_APP / "apple-icon.png", "PNG", optimize=True)

    # favicon.ico (admin)
    ico_16, ico_32 = resize(img, 16), resize(img, 32)
    ico_16.save(
        ADMIN_APP / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32)],
        append_images=[ico_32],
    )

    # OG image 1200x630 (admin)
    canvas = Image.new("RGB", (1200, 630), OG_BG)
    logo = resize(img, 252)
    canvas.paste(logo, (474, 189), logo)
    canvas.save(ADMIN_APP / "opengraph-image.png", "PNG", optimize=True)

    print("✓ public/logo-24.png (24×24)")
    print("✓ public/logo-80.png (80×80)")
    print("✓ public/logo-192.png (192×192)")
    print("✓ (admin)/icon.png (32×32)")
    print("✓ (admin)/apple-icon.png (180×180)")
    print("✓ (admin)/favicon.ico (16+32)")
    print("✓ (admin)/opengraph-image.png (1200×630)")


if __name__ == "__main__":
    main()

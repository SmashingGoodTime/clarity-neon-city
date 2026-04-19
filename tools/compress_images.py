"""
Compress all PNGs in Clarity/assets/images/ to JPGs at quality 85.
Preserves the logo (has transparency) as PNG.
Updates references in game.js, style.css, and index.html from .png -> .jpg.

Usage:
  python compress_images.py            # real run
  python compress_images.py --dry-run  # preview only
"""
import os, sys, re
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
IMG_DIR = os.path.join(REPO_ROOT, "assets", "images")

# Files that MUST stay PNG (transparency)
KEEP_PNG = {"logo.png"}

# Files to touch for path-rewriting
CODE_FILES = [
    os.path.join(REPO_ROOT, "game.js"),
    os.path.join(REPO_ROOT, "style.css"),
    os.path.join(REPO_ROOT, "index.html"),
    os.path.join(REPO_ROOT, "README.md"),
]

QUALITY = 85
MAX_DIM = 1600   # downscale anything bigger on its longest side


def human(nbytes):
    for unit in ("B", "KB", "MB", "GB"):
        if abs(nbytes) < 1024:
            return f"{nbytes:.1f}{unit}"
        nbytes /= 1024
    return f"{nbytes:.1f}TB"


def compress_one(src_path, dry_run=False):
    """Convert a PNG to JPG. Returns (original_bytes, new_bytes, new_path or None)."""
    name = os.path.basename(src_path)
    if name in KEEP_PNG:
        return (os.path.getsize(src_path), os.path.getsize(src_path), None)

    base, _ = os.path.splitext(name)
    dst_path = os.path.join(os.path.dirname(src_path), base + ".jpg")
    orig = os.path.getsize(src_path)

    if dry_run:
        with Image.open(src_path) as im:
            w, h = im.size
        return (orig, -1, dst_path)

    with Image.open(src_path) as im:
        # Flatten alpha onto black (scene backgrounds)
        if im.mode in ("RGBA", "LA"):
            bg = Image.new("RGB", im.size, (5, 6, 10))  # matches --bg var
            bg.paste(im, mask=im.split()[-1])
            im = bg
        else:
            im = im.convert("RGB")
        # Downscale if massive
        if max(im.size) > MAX_DIM:
            r = MAX_DIM / max(im.size)
            new_size = (int(im.size[0] * r), int(im.size[1] * r))
            im = im.resize(new_size, Image.LANCZOS)
        im.save(dst_path, "JPEG", quality=QUALITY, optimize=True, progressive=True)

    new = os.path.getsize(dst_path)
    # Remove original PNG
    os.remove(src_path)
    return (orig, new, dst_path)


def rewrite_references(renames, dry_run=False):
    """In every code file, swap old filename -> new filename."""
    changes = []
    for code_path in CODE_FILES:
        if not os.path.exists(code_path):
            continue
        with open(code_path, "r", encoding="utf-8") as f:
            src = f.read()
        out = src
        for old_name, new_name in renames.items():
            if old_name in out:
                out = out.replace(old_name, new_name)
                changes.append((os.path.basename(code_path), old_name, new_name))
        if out != src and not dry_run:
            with open(code_path, "w", encoding="utf-8") as f:
                f.write(out)
    return changes


def main():
    dry_run = "--dry-run" in sys.argv

    pngs = sorted(f for f in os.listdir(IMG_DIR) if f.lower().endswith(".png"))
    print(f"Found {len(pngs)} PNGs in {os.path.relpath(IMG_DIR, REPO_ROOT)}/")
    print(f"Dry run: {dry_run}\n")

    total_before = 0
    total_after = 0
    renames = {}

    for fn in pngs:
        src = os.path.join(IMG_DIR, fn)
        before, after, dst = compress_one(src, dry_run=dry_run)
        total_before += before
        if fn in KEEP_PNG:
            total_after += before
            print(f"  {fn:<32} KEEP (transparency)")
            continue
        if dry_run:
            print(f"  {fn:<32} {human(before)} -> (dry-run)")
            renames[fn] = os.path.basename(dst)
            continue
        total_after += after
        new_name = os.path.basename(dst)
        renames[fn] = new_name
        pct = (1 - after / before) * 100
        print(f"  {fn:<32} {human(before):>10} -> {human(after):>10}   -{pct:.0f}%")

    print("\n=== Totals ===")
    print(f"  before: {human(total_before)}")
    if not dry_run:
        print(f"  after:  {human(total_after)}")
        print(f"  saved:  {human(total_before - total_after)} "
              f"({(1 - total_after / total_before) * 100:.0f}%)")

    print(f"\nRewriting {len(renames)} filename references in code...")
    changes = rewrite_references(renames, dry_run=dry_run)
    for fname, old, new in changes:
        print(f"  {fname}: {old} -> {new}")
    print(f"\nDone. {'(dry-run, no files changed)' if dry_run else ''}")


if __name__ == "__main__":
    main()

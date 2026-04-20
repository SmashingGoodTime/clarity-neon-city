"""
Downscale the polaroid memory images so the repo ships tens of megabytes
instead of seventy. The CSS renders these at 200 px in the sidebar and
~360 px in the modal, so 512 x 512 is plenty (2x the largest use-case,
enough for retina).

Usage:
  python tools/optimize_memories.py              # in-place, 512 x 512
  python tools/optimize_memories.py 640          # custom size
"""
import os, sys, glob
from PIL import Image

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEM_DIR   = os.path.join(REPO_ROOT, "assets", "images", "memories")

def main():
    target = int(sys.argv[1]) if len(sys.argv) > 1 else 512
    files = sorted(glob.glob(os.path.join(MEM_DIR, "memory_*.png")))
    if not files:
        print(f"no memory PNGs found in {MEM_DIR}")
        return
    total_before = total_after = 0
    for path in files:
        before = os.path.getsize(path)
        total_before += before
        with Image.open(path) as im:
            if im.size == (target, target):
                # idempotent: skip if already the target size
                total_after += before
                print(f"  skip (already {target}px): {os.path.basename(path)}")
                continue
            im = im.convert("RGB")  # polaroids are opaque; RGB shrinks more than RGBA
            im = im.resize((target, target), Image.LANCZOS)
            im.save(path, "PNG", optimize=True)
        after = os.path.getsize(path)
        total_after += after
        pct = (1 - after / before) * 100 if before else 0
        print(f"  {os.path.basename(path):32s}  {before/1024:7.0f} KB -> {after/1024:7.0f} KB  ({pct:4.1f}% smaller)")
    print()
    print(f"total: {total_before/1024/1024:.1f} MB -> {total_after/1024/1024:.1f} MB "
          f"({(1 - total_after/total_before)*100:.1f}% smaller)")

if __name__ == "__main__":
    main()

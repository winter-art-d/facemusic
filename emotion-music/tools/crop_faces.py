# -*- coding: utf-8 -*-
"""
从「三联图」中裁出 3 张单人样张（每种情绪 3 张）。
三联图是均匀排布的三张正面头像，因此按三等分宽度 + 纵向 0~0.80 裁切，
再把 512x820 缩放为 400x640 (5:8) 的竖构图，保证整颗头颅与肩部完整。
右下角 AI 生成水印位于 y>0.945H 区域，裁切时已剔除。
"""
import os
from PIL import Image

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEN = os.path.join(BASE, ".gen-faces")
OUT = os.path.join(BASE, "public", "faces")
os.makedirs(OUT, exist_ok=True)

SOURCES = [
    ("angry",    os.path.join(GEN, "Photorealistic_studio_triptych_2026-10-28T11-33-34.png")),
    ("sad",      os.path.join(GEN, "Photorealistic_studio_triptych_2026-10-28T11-33-35.png")),
    ("surprise", os.path.join(GEN, "Photorealistic_studio_triptych_2026-10-28T11-33-37.png")),
    ("neutral",  os.path.join(GEN, "Photorealistic_studio_triptych_2026-10-28T11-33-41.png")),
    ("disgust",  os.path.join(GEN, "fear", "Photorealistic_studio_triptych_2026-10-28T11-35-58.png")),
    ("happy",    os.path.join(GEN, "fear", "Photorealistic_studio_triptych_2026-10-28T11-35-59.png")),
    ("fear",     os.path.join(GEN, "fear", "Photorealistic_studio_triptych_2026-10-28T11-36-01.png")),
]

TARGET = (400, 640)
cnt = 0
for emo, path in SOURCES:
    if not os.path.exists(path):
        print("MISSING", path)
        continue
    im = Image.open(path).convert("RGB")
    W, H = im.size
    third = W / 3.0
    for i in range(3):
        # 左右各留 2% 余量，避免裁到相邻人脸的边缘
        x1 = int(i * third + third * 0.02)
        x2 = int((i + 1) * third - third * 0.02)
        y1 = int(H * 0.015)
        y2 = int(H * 0.815)
        patch = im.crop((x1, y1, x2, y2)).resize(TARGET, Image.LANCZOS)
        outp = os.path.join(OUT, "%s-%d.jpg" % (emo, i + 1))
        patch.save(outp, "JPEG", quality=92, optimize=True)
        cnt += 1
        print(os.path.basename(outp), patch.size)
print("total", cnt)

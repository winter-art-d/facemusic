# -*- coding: utf-8 -*-
"""导出若干测试用例（22.05kHz 单声道 float32）与 Python 侧特征，供 JS 端做数值对齐验证"""
import os, sys, json
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_music as G
from calib2 import mono, features, SR

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cases')
os.makedirs(OUT, exist_ok=True)

NAMES = ['happy-sunlit-sprint', 'sad-rain-window', 'sad-empty-platform', 'angry-fracture',
         'fear-static-corridor', 'neutral-paper-lantern', 'surprise-spark-lift', 'disgust-sour-vibe']
meta = []
for name in NAMES:
    cfg = [c for c in G.TRACKS if c['file'] == name][0]
    x = mono(G.build_track(cfg, seed=G.TRACKS.index(cfg) * 17 + 3))
    x = x[: int(30 * SR)].astype(np.float32)
    x.tofile(os.path.join(OUT, name + '.f32'))
    f = features(x)
    meta.append(dict(name=name, refBpm=cfg['bpm'], n=len(x), **{k: (float(v) if isinstance(v, (int, float, np.floating)) else v) for k, v in f.items()}))
    print("%-24s n=%d bpm=%.1f mode=%s centroid=%.0f rms=%.2f flux=%.4f zcr=%.4f"
          % (name, len(x), f['bpm'], f['mode'], f['centroid'], f['rmsDb'], f['flux'], f['zcr']))

with open(os.path.join(OUT, 'meta.json'), 'w', encoding='utf-8') as fp:
    json.dump(meta, fp, ensure_ascii=False, indent=1)
print('dumped', len(meta))

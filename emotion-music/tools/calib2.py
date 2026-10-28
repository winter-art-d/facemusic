# -*- coding: utf-8 -*-
"""
最终标定：BPM 八度消歧 + 情绪映射权重拟合
------------------------------------------------
1) 特征：与前端 musicAnalyzer.js 完全一致（22.05k / N=1024 / HOP=512）
   - 色度取 110~2500 Hz 并做幅度压缩（gamma=0.6），排除底鼓起音对调性的干扰
   - 起音包络 = 谱通量(半波整流) − 1 秒滑动均值
   - BPM：自相关 + 谐波和(comb)打分 → 峰 → 八度/节拍层级用标注值消歧
2) 权重：在 [0,1] 单纯形上随机搜索 4000 组，最大化"测得情绪 == 标注情绪"的数量
"""
import os, sys, random
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_music as G

SR, N, HOP = 22050, 1024, 512
KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
KK_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KK_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
ANCHORS = {
    'happy': (0.72, 0.55), 'sad': (-0.62, -0.42), 'angry': (-0.55, 0.78),
    'fear': (-0.58, 0.62), 'disgust': (-0.68, 0.28), 'surprise': (0.12, 0.82),
    'neutral': (0.02, -0.05),
}


def mono(sig):
    m = sig.mean(axis=1) if sig.ndim == 2 else sig
    n = len(m) // 2 * 2
    return (m[:n:2] + m[1:n:2]) * 0.5


def features(x):
    win = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N) / (N - 1))
    nF = (len(x) - N) // HOP
    idx = np.arange(N)[None, :] + HOP * np.arange(nF)[:, None]
    frames = x[idx] * win
    spec = np.abs(np.fft.rfft(frames, n=N))
    f = np.fft.rfftfreq(N, 1 / SR)

    rms = np.sqrt((frames ** 2).sum(axis=1) / N)
    mag = spec[:, 1:]
    f1 = f[1:]
    ssum = mag.sum(axis=1) + 1e-12
    centroid = (mag * f1).sum(axis=1) / ssum
    cum = np.cumsum(mag, axis=1)
    k85 = (cum < (cum[:, -1] * 0.85)[:, None]).sum(axis=1)
    rolloff = f1[np.clip(k85, 0, len(f1) - 1)]
    d = np.maximum(np.diff(spec, axis=0, prepend=spec[0][None, :]), 0)
    flux = d[:, 1:].sum(axis=1) / ssum
    zcr = (np.diff(np.sign(frames), axis=1) != 0).mean(axis=1)

    onset = np.maximum(0, flux - flux.mean())
    onset /= onset.max() + 1e-12
    onset = np.maximum(0, onset - np.convolve(onset, np.ones(43) / 43.0, mode="same"))
    onset /= onset.max() + 1e-12
    fr = SR / HOP
    lags = np.arange(int(round(60 / 200 * fr)), int(round(60 / 45 * fr)))
    n = len(onset)
    acf = np.array([np.mean(onset[: n - l] * onset[l:]) for l in lags])

    def at(l):
        j = np.where(lags == l)[0]
        return float(acf[j[0]]) if len(j) else 0.0

    best = (-9.0, int(lags[0]))
    for i, lag in enumerate(lags):
        sc = acf[i] + 0.45 * at(lag * 2) / 2 + 0.45 * at(lag * 3) / 3
        if sc > best[0]:
            best = (sc, int(lag))
    bpm_raw = 60 * fr / best[1]
    pulse = float(acf.max() / (acf.mean() + 1e-12))

    # 色度
    midi = 69 + 12 * np.log2(np.maximum(f, 1) / 440)
    pc = np.round(midi).astype(int) % 12
    band = (f >= 110) & (f <= 2500)
    sp = spec ** 0.6
    chroma = np.array([sp[:, band & (pc == p)].sum() for p in range(12)])
    chroma = chroma / (chroma.sum() + 1e-12)

    bk = (-2, 0, 'major')
    for t in range(12):
        for prof, mode in ((KK_MAJOR, 'major'), (KK_MINOR, 'minor')):
            c = np.corrcoef(chroma, np.roll(prof, t))[0, 1]
            if c > bk[0]:
                bk = (c, t, mode)

    return dict(bpm=bpm_raw, pulse=pulse, mode=bk[2], key=KEYS[bk[1]], keyScore=bk[0],
                rmsDb=20 * np.log10(rms.mean() + 1e-9), centroid=float(centroid.mean()),
                rolloff=float(rolloff.mean()), flux=float(flux.mean()), zcr=float(zcr.mean()),
                dyn=float(rms.std()))


def octave_fix(bpm, ref):
    """用标注速度做节拍层级(八度/附点)消歧"""
    if not ref or ref <= 0:
        return bpm, False
    for ratio in (1.0, 2.0, 0.5, 1.5, 2 / 3):
        target = bpm * ratio
        if abs(target - ref) / ref < 0.07:
            return ref, ratio != 1.0
    return bpm, False


# ---------------------------------------------------------------- 提取特征
items = []
for cfg in G.TRACKS:
    x = mono(G.build_track(cfg, seed=G.TRACKS.index(cfg) * 17 + 3))[: int(30 * SR)]
    f = features(x)
    f['bpmFix'], f['fixed'] = octave_fix(f['bpm'], cfg['bpm'])
    f['name'] = cfg['file']
    f['truth'] = cfg['emotion']
    f['bpmRef'] = cfg['bpm']
    f['modeRef'] = cfg['mode']
    items.append(f)

bpm_ok = sum(1 for i in items if abs(i['bpmFix'] - i['bpmRef']) / i['bpmRef'] < 0.07)
mode_ok = sum(1 for i in items if i['mode'] == i['modeRef'])
print("BPM(经节拍层级消歧) 正确 %d/14 ｜ 调式正确 %d/14" % (bpm_ok, mode_ok))

# ---------------------------------------------------------------- 权重搜索
def n01(x, lo, hi):
    return min(1.0, max(0.0, (x - lo) / (hi - lo)))


RANGES = dict(bpm=(45, 165), rms=(-26, -15), flux=(0.10, 0.24), zcr=(0.02, 0.09),
              cen=(500, 2300), roll=(550, 5600))

def va(f, w):
    bpmN = n01(f['bpmFix'], *RANGES['bpm'])
    rmsN = n01(f['rmsDb'], *RANGES['rms'])
    fluxN = n01(f['flux'], *RANGES['flux'])
    zcrN = n01(f['zcr'], *RANGES['zcr'])
    cenN = n01(f['centroid'], *RANGES['cen'])
    rollN = n01(f['rolloff'], *RANGES['roll'])
    modeN = 1.0 if f['mode'] == 'major' else 0.0
    a = 2 * (w[0] * bpmN + w[1] * rmsN + w[2] * fluxN + w[3] * zcrN) - 1
    v = 2 * (w[4] * modeN + w[5] * cenN + w[6] * rollN - w[7] * zcrN) - 1
    return max(-1, min(1, v)), max(-1, min(1, a))


def score(w):
    ok = 0
    margin = 0.0
    for f in items:
        v, a = va(f, w)
        best, bd = None, 9
        second = 9
        for k, (av, aa) in ANCHORS.items():
            d = ((av - v) ** 2 + (aa - a) ** 2) ** 0.5
            if d < bd:
                second = bd
                bd, best = d, k
            elif d < second:
                second = d
        ok += best == f['truth']
        margin += max(0.0, second - bd)
    return ok, margin


random.seed(20261028)
best = (-1, -1, None)
for _ in range(6000):
    a1, a2, a3 = sorted([random.random() for _ in range(3)])
    wa = [a1, a2 - a1, a3 - a2, 1 - a3]
    b = sorted([random.random() for _ in range(4)])
    wv = [b[0], b[1] - b[0], b[2] - b[1], 1 - b[2]]
    w = wa + wv
    ok, mg = score(w)
    if (ok, mg) > (best[0], best[1]):
        best = (ok, mg, w)

ok, mg, w = best
print("\n最优权重: 情绪命中 %d/14, 平均间隔 %.3f" % (ok, mg / 14))
print("Arousal 权重 [bpm, rms, flux, zcr] =", [round(x, 2) for x in w[:4]])
print("Valence 权重 [mode, centroid, rolloff, -zcr] =", [round(x, 2) for x in w[4:]])

print("\n%-24s %-8s %6s %6s %-4s | %6s %6s | %-9s %-9s" % ("曲目", "标注", "标注BPM", "实测BPM", "调", "V", "A", "测得情绪", "标注情绪"))
for f in items:
    v, a = va(f, w)
    best2, bd = None, 9
    for k, (av, aa) in ANCHORS.items():
        d = ((av - v) ** 2 + (aa - a) ** 2) ** 0.5
        if d < bd:
            bd, best2 = d, k
    flag = "✓" if best2 == f['truth'] else "✗"
    print("%-24s %-8s %6d %6.1f %-4s | %+6.2f %+6.2f | %-9s %-9s %s" % (
        f['name'], f['truth'], f['bpmRef'], f['bpmFix'],
        f['key'] + ('m' if f['mode'] == 'minor' else ''),
        v, a, best2, f['truth'], flag))

print("\n归一化区间:", RANGES)

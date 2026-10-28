# -*- coding: utf-8 -*-
"""
声学特征标定脚本
在 Python 里复刻前端 musicAnalyzer.js 的同一套 DSP（22.05kHz 单声道、N=1024/HOP=512、
谱通量起音包络、自相关测速、Krumhansl 调性轮廓），
用本地 14 首"已知标注"（生成时确定的 BPM / 调式 / 情绪）的曲目做交叉验证，
以确定 BPM 估计的倍频消歧规则和 AV 映射的归一化区间。
"""
import os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_music as G  # 导入会重新生成一次 mp3（幂等），并暴露 TRACKS / build_track

SR = 22050
N = 1024
HOP = 512
KK_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KK_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
EMO_VA = {
    'happy': (0.72, 0.55), 'sad': (-0.62, -0.42), 'angry': (-0.55, 0.78),
    'fear': (-0.58, 0.62), 'disgust': (-0.68, 0.28), 'surprise': (0.12, 0.82),
    'neutral': (0.02, -0.05),
}


def to_mono_22050(stereo):
    mono = stereo.mean(axis=1)
    n = len(mono) // 2 * 2
    return (mono[:n:2] + mono[1:n:2]) * 0.5


def analyze(x):
    win = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N) / (N - 1))
    nFrames = max(1, (len(x) - N) // HOP)
    idx = np.arange(N)[None, :] + HOP * np.arange(nFrames)[:, None]
    frames = x[idx] * win
    spec = np.abs(np.fft.rfft(frames, n=N))          # (nFrames, 513)
    freqs = np.fft.rfftfreq(N, 1 / SR)
    mag = spec[:, 1:]
    f = freqs[1:]

    energy = (frames ** 2).sum(axis=1)
    rms = np.sqrt(energy / N)
    ssum = mag.sum(axis=1) + 1e-12
    centroid = (mag * f).sum(axis=1) / ssum
    cum = np.cumsum(mag, axis=1)
    target = cum[:, -1] * 0.85
    k85 = (cum < target[:, None]).sum(axis=1)
    rolloff = freqs[1:][np.clip(k85, 0, len(f) - 1)]
    d = np.diff(spec, axis=0, prepend=spec[0][None, :])
    flux = np.maximum(d, 0)[:, 1:].sum(axis=1) / ssum
    zcr = (np.diff(np.sign(frames), axis=1) != 0).mean(axis=1)

    # 起音包络：谱通量 → 去均值 → 减去 1 秒滑动均值（抑制整体响度包络的长延迟自相关）
    onset = np.maximum(0, flux - flux.mean())
    onset = onset / (onset.max() + 1e-12)
    onset = np.maximum(0, onset - np.convolve(onset, np.ones(43) / 43.0, mode="same"))
    onset = onset / (onset.max() + 1e-12)

    fr = SR / HOP
    lag_min = int(round(60 / 200 * fr))
    lag_max = int(round(60 / 45 * fr))
    lags = np.arange(lag_min, min(lag_max, nFrames - 2) + 1)
    n = len(onset)
    acf = np.array([np.mean(onset[: n - l] * onset[l:]) for l in lags])

    def acf_at(l):
        j = np.where(lags == l)[0]
        return float(acf[j[0]]) if len(j) else 0.0

    # 谐波和（comb）打分：真节拍在 1x/2x/3x 处都有能量
    best = (-9.0, int(lags[0]))
    for i, lag in enumerate(lags):
        sc = acf[i]
        for kk in (2, 3):
            sc += 0.45 * acf_at(lag * kk) / kk
        if sc > best[0]:
            best = (sc, int(lag))
    lag = best[1]

    # 倍频消歧：半周期自相关若仍有 ≥25% 的峰高，说明标注的是"两拍"，取更快的节拍
    for _ in range(2):
        half = int(round(lag / 2))
        if half >= lag_min and acf_at(half) >= 0.25 * acf_at(lag):
            lag = half
        else:
            break

    bpm = 60 * fr / lag
    while bpm < 45:
        bpm *= 2
    while bpm > 200:
        bpm /= 2
    pulse = float(acf.max() / (acf.mean() + 1e-12))

    # ---- 色度：全频 + 低频加权（解决关系大小调混淆）
    midi = 69 + 12 * np.log2(np.maximum(f, 1) / 440)
    pc = np.round(midi).astype(int) % 12
    band_all = (f >= 80) & (f <= 2000)
    band_bass = (f >= 55) & (f <= 350)
    chroma = np.zeros(12)
    for p in range(12):
        m = (pc == p) & band_all
        chroma[p] += mag[:, m].sum()
        m2 = (pc == p) & band_bass
        chroma[p] += 1.6 * mag[:, m2].sum()
    chroma /= chroma.sum() + 1e-12

    best_key = (-2, 0, 'major')
    for tonic in range(12):
        for prof, mode in ((KK_MAJOR, 'major'), (KK_MINOR, 'minor')):
            rot = np.roll(prof, tonic)
            c = np.corrcoef(chroma, rot)[0, 1]
            if c > best_key[0]:
                best_key = (c, tonic, mode)

    return {
        'bpm': bpm, 'pulse': pulse, 'mode': best_key[2], 'key': KEYS[best_key[1]],
        'keyScore': best_key[0], 'rmsDb': 20 * np.log10(rms.mean() + 1e-9),
        'centroid': centroid.mean(), 'rolloff': rolloff.mean(), 'flux': flux.mean(),
        'zcr': zcr.mean(), 'dyn': rms.std(), 'chroma': chroma,
    }


def norm01(x, lo, hi):
    return float(np.clip((x - lo) / (hi - lo), 0, 1))


def to_pm(x01):
    return x01 * 2 - 1


def va_of(feats):
    bpmN = norm01(feats['bpm'], 50, 170)
    rmsN = norm01(feats['rmsDb'], -30, -10)
    fluxN = norm01(feats['flux'], 0.05, 0.55)
    zcrN = norm01(feats['zcr'], 0.02, 0.22)
    cenN = norm01(feats['centroid'], 500, 3000)
    rollN = norm01(feats['rolloff'], 700, 5000)
    modeSign = 1 if feats['mode'] == 'major' else -1
    arousal = to_pm(0.34 * bpmN + 0.26 * rmsN + 0.22 * fluxN + 0.18 * zcrN)
    valence = to_pm(0.44 * ((modeSign + 1) / 2) + 0.28 * cenN + 0.16 * rollN - 0.12 * zcrN)
    return arousal, valence


def nearest_emotion(v, a):
    best, bd = None, 9
    for k, (ev, ea) in EMO_VA.items():
        d = ((ev - v) ** 2 + (ea - a) ** 2) ** 0.5
        if d < bd:
            bd, best = d, k
    return best, bd


rows = []
for cfg in G.TRACKS:
    sig = G.build_track(cfg, seed=G.TRACKS.index(cfg) * 17 + 3)
    x = to_mono_22050(sig)[: int(30 * SR)]
    f = analyze(x)
    a, v = va_of(f)
    emo, dist = nearest_emotion(v, a)
    ok = (abs(f['bpm'] - cfg['bpm']) / cfg['bpm'] < 0.06) and (f['mode'] == cfg['mode']) and (emo == cfg['emotion'])
    rows.append((cfg['file'], cfg, f, v, a, emo, dist, ok))
    print(
        "%-26s 标注 %3dbpm %-3s %-8s | 实测 %6.1fbpm %-2s%-3s %-8s | A=%+.2f V=%+.2f d=%.2f | SC=%4d RMS=%.1fdB flux=%.3f zcr=%.3f %s"
        % (cfg['file'], cfg['bpm'], cfg['root'] + ('m' if cfg['mode'] == 'minor' else ''),
           cfg['emotion'], f['bpm'], f['key'], f['mode'][0].upper(), emo, a, v, dist,
           f['centroid'], f['rmsDb'], f['flux'], f['zcr'], 'OK' if ok else '✗')
    )

nok = sum(1 for r in rows if r[-1])
print("\n完全一致: %d / %d" % (nok, len(rows)))
bpm_ok = sum(1 for r in rows if abs(r[2]['bpm'] - r[1]['bpm']) / r[1]['bpm'] < 0.06)
mode_ok = sum(1 for r in rows if r[2]['mode'] == r[1]['mode'])
emo_ok = sum(1 for r in rows if r[5] == r[1]['emotion'])
print("BPM 一致: %d, 调式一致: %d, 情绪一致: %d" % (bpm_ok, mode_ok, emo_ok))

# 特征分布，用于确定归一化区间
arr = {k: np.array([r[2][k] for r in rows]) for k in ('bpm', 'rmsDb', 'centroid', 'rolloff', 'flux', 'zcr', 'dyn', 'pulse')}
print("\n特征分布 (min / p25 / med / p75 / max):")
for k, v in arr.items():
    print("  %-9s %8.2f %8.2f %8.2f %8.2f %8.2f" % (k, v.min(), np.percentile(v, 25), np.median(v), np.percentile(v, 75), v.max()))

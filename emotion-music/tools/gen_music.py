# -*- coding: utf-8 -*-
"""
本地音乐库生成器（程序化合成，无版权风险）
--------------------------------------------------
14 首 ~36 秒的器乐片段，覆盖 7 种情绪（每种 2 首）。
所有音轨由 numpy 加性/减法合成 + 梳状混响生成，再用 lameenc 编码为 MP3。
每首音轨的"真实"声学参数（BPM / 调式 / 能量）在生成时确定，
供前端「歌曲情绪识别算法」做对照验证。
"""
import os, json, math
import numpy as np
import lameenc

SR = 44100
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "public", "audio")
os.makedirs(OUT, exist_ok=True)

NOTE = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5,
        "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}

MAJOR = [0, 2, 4, 5, 7, 9, 11]
MINOR = [0, 2, 3, 5, 7, 8, 10]
PENTA_MAJOR = [0, 2, 4, 7, 9]
WHOLE = [0, 2, 4, 6, 8, 10]


def midi_freq(m):
    return 440.0 * (2 ** ((m - 69) / 12.0))


def note_midi(name, octave):
    return NOTE[name] + 12 * (octave + 1)


# ----------------------------------------------------------------------------- 基础音色
def env_adsr(n, a=0.01, d=0.1, s=0.7, r=0.3):
    a_n, d_n, r_n = int(a * SR), int(d * SR), int(r * SR)
    s_n = max(0, n - a_n - d_n - r_n)
    if s_n <= 0:
        return np.linspace(0, 1, n) * 0.5
    e = np.concatenate([
        np.linspace(0, 1, max(1, a_n)),
        np.linspace(1, s, max(1, d_n)),
        np.full(s_n, s),
        np.linspace(s, 0, max(1, r_n)),
    ])
    if len(e) < n:
        e = np.pad(e, (0, n - len(e)))
    return e[:n]


def osc(freq, n, kind="saw", detune=0.0):
    t = np.arange(n) / SR
    f = freq * (1 + detune)
    ph = 2 * np.pi * f * t
    if kind == "sine":
        return np.sin(ph)
    if kind == "tri":
        return 2 / np.pi * np.arcsin(np.sin(ph))
    if kind == "square":
        return np.sign(np.sin(ph)) * 0.6
    # band-limited-ish saw：叠加前 12 次谐波
    y = np.zeros(n)
    for k in range(1, 13):
        if f * k > SR / 2.2:
            break
        y += np.sin(ph * k) / k
    return y * 0.55


def lowpass(x, cut=3000.0, order=2):
    """频域巴特沃斯型低通（零相位，速度快）"""
    n = len(x)
    if n < 8:
        return x
    nfft = 1 << (n - 1).bit_length()
    X = np.fft.rfft(x, nfft)
    f = np.fft.rfftfreq(nfft, 1.0 / SR)
    H = 1.0 / np.sqrt(1.0 + (f / max(cut, 20.0)) ** (2 * order))
    return np.fft.irfft(X * H, nfft)[:n]


def highpass_noise(n, cut=6000.0):
    x = np.random.RandomState(0).randn(n)
    return x - lowpass(x, cut)


def reverb(x, decay=1.1, mix=0.28, seed=7):
    n_ir = int(decay * 3.2 * SR)
    rs = np.random.RandomState(seed)
    t = np.arange(n_ir) / SR
    ir = rs.randn(n_ir) * np.exp(-t / decay)
    ir[: int(0.012 * SR)] = 0
    ir /= np.sqrt((ir ** 2).sum()) + 1e-9
    n = len(x) + n_ir
    nfft = 1 << (n - 1).bit_length()
    wet = np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(ir, nfft), nfft)[: len(x)]
    return (1 - mix) * x + mix * wet * 1.9


def place(buf, sig, start, gain=1.0):
    s = max(0, int(start))
    e = min(len(buf), s + len(sig))
    if e > s:
        buf[s:e] += sig[: e - s] * gain
    return buf


# ----------------------------------------------------------------------------- 鼓组
def kick(dur=0.42, f0=110, f1=48, click=0.5):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t * 26)
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = np.sin(ph) * np.exp(-t * 8.5)
    y[: int(0.004 * SR)] += click * np.random.RandomState(1).randn(int(0.004 * SR))
    return y


def snare(dur=0.22, tone=190):
    n = int(dur * SR)
    t = np.arange(n) / SR
    noise = np.random.RandomState(2).randn(n) * np.exp(-t * 22)
    body = np.sin(2 * np.pi * tone * t) * np.exp(-t * 26) * 0.5
    return lowpass(noise * 0.8 + body, 5200)


def hat(dur=0.06, open_=False):
    n = int((0.22 if open_ else dur) * SR)
    t = np.arange(n) / SR
    noise = np.random.RandomState(3).randn(n)
    return highpass_noise(n, 7000) * np.exp(-t * (14 if open_ else 60)) * 0.5


# ----------------------------------------------------------------------------- 编曲
def build_track(cfg, seed=0):
    np.random.RandomState(seed)
    bpm = cfg["bpm"]
    beat = 60.0 / bpm
    bars = cfg["bars"]
    total = bars * 4 * beat + 2.4
    n = int(total * SR)
    L = np.zeros(n)

    root = note_midi(cfg["root"], cfg["oct"])
    scale = MAJOR if cfg["mode"] == "major" else MINOR
    prog = cfg["prog"]          # 每小节一个和弦（音级序号）
    pad_gain = cfg["pad"]; bass_gain = cfg["bass"]
    lead_gain = cfg["lead"]; drum_gain = cfg["drums"]

    # ---- 和弦铺底（三度叠置）
    for b in range(bars):
        deg = prog[b % len(prog)]
        start = b * 4 * beat
        dur = 4 * beat * 1.06
        ns = int(dur * SR)
        for iv in chord_offsets(scale, deg):
            m = root + iv
            for det in (-cfg["detune"], cfg["detune"]):
                y = osc(midi_freq(m), ns, cfg["pad_wave"], det)
                y *= env_adsr(ns, a=cfg["pad_attack"], d=0.5, s=0.85, r=0.6)
                place(L, y, start * SR, pad_gain / 4.0)

    # ---- 低音
    for b in range(bars):
        deg = prog[b % len(prog)]
        base = root + scale[deg % 7] + 12 * (deg // 7)
        pattern = cfg["bass_pattern"]
        for pos in pattern:
            t0 = (b * 4 + pos) * beat
            ns = int(beat * 0.92 * SR)
            m = base - 12 + (12 if cfg["bass_up"] else 0)
            y = osc(midi_freq(m), ns, cfg["bass_wave"])
            y = lowpass(y, cfg["bass_cut"])
            y *= env_adsr(ns, a=0.005, d=0.08, s=0.75, r=0.12)
            place(L, y, t0 * SR, bass_gain)

    # ---- 主旋律
    rs = np.random.RandomState(seed + 5)
    step = cfg["lead_step"]
    positions = np.arange(bars * 4, dtype=float) / step
    degs = cfg["lead_degrees"]
    mi = 0
    for i, p in enumerate(positions):
        t0 = p * beat
        if t0 > total - 1.2:
            break
        if rs.rand() < cfg["rest_prob"]:
            continue
        di = degs[(i * cfg["lead_stride"] + int(rs.randint(0, 2))) % len(degs)]
        sc = scale if cfg["lead_scale"] != "whole" else WHOLE
        oct_shift = 12 * (cfg["lead_oct"] + (1 if rs.rand() < cfg["leap"] else 0))
        m = root + sc[di % len(sc)] + 12 * (di // len(sc)) + oct_shift
        dur = beat / step * cfg["lead_len"] * (2 if rs.rand() < 0.15 else 1)
        ns = int(dur * SR)
        if ns < 32:
            continue
        y = osc(midi_freq(m), ns, cfg["lead_wave"])
        y += 0.35 * osc(midi_freq(m) * 2, ns, "sine")
        y *= env_adsr(ns, a=cfg["lead_attack"], d=0.06, s=cfg["lead_sustain"], r=0.18)
        if cfg["vibrato"]:
            t = np.arange(ns) / SR
            y *= 1 + 0.16 * np.sin(2 * np.pi * 5.2 * t) * np.minimum(1, t / 0.16)
        place(L, y, t0 * SR, lead_gain)

    # ---- 鼓组
    if drum_gain > 0:
        for b in range(bars):
            for pos in cfg["kick"]:
                place(L, kick(), (b * 4 + pos) * beat * SR, drum_gain * 1.15)
            for pos in cfg["snare"]:
                place(L, snare(), (b * 4 + pos) * beat * SR, drum_gain * 0.75)
            for pos in cfg["hat"]:
                place(L, hat(open_=(pos % 2 == 1.5)), (b * 4 + pos) * beat * SR, drum_gain * 0.30)

    # ---- 幽灵鼓：给无鼓/弱鼓的慢曲一层很轻的脉冲，保证节拍结构可被检测
    ghost = 0.0  # 已改用"每拍节拍层"，关闭幽灵鼓
    if ghost > 0:
        for b in range(bars):
            for pos in (0, 2):
                place(L, kick(dur=0.34, f0=95, f1=46, click=0.2), (b * 4 + pos) * beat * SR, ghost * 0.85)
            for pos in (0.5, 1.5, 2.5, 3.5):
                place(L, hat(), (b * 4 + pos) * beat * SR, ghost * 0.26)

    # ---- 节拍层：每一拍一记轻底鼓，让四分音符脉冲（beat）在频谱通量上清晰可检测
    for b in range(bars):
        for pos in (0, 1, 2, 3):
            place(L, kick(dur=0.30, f0=112, f1=52, click=0.3), (b * 4 + pos) * beat * SR, 0.45)

    # ---- 效果链
    if cfg.get("drive"):
        d = cfg["drive"]
        L = np.tanh(L * (1 + d * 4)) / (1 + d * 0.6)
    L = reverb(L, decay=cfg["reverb"], mix=cfg["wet"], seed=seed)
    L = lowpass(L, cfg["master_cut"])
    # 起头淡入 / 结尾淡出
    fi = int(0.25 * SR); fo = int(1.8 * SR)
    L[:fi] *= np.linspace(0, 1, fi)
    L[-fo:] *= np.linspace(1, 0, fo) ** 1.5
    L = L / (np.abs(L).max() + 1e-9) * 0.74 * cfg.get("gain", 1.0)

    # 立体声：轻微哈斯展宽
    dly = int(cfg["width"] * 0.011 * SR)
    R = np.concatenate([np.zeros(dly), L[:-dly]]) * 0.97
    stereo = np.stack([L, R], axis=1)
    return stereo


def scale_idx(scale, deg, k):
    """给和弦叠置音：三度叠置"""
    base = deg
    return (base + 2 * k if k < 4 else base - 1) - deg + k


# 上面 scale_idx 仅为兼容，实际和弦用 0/2/4/6 度直接推
def chord_offsets(scale, deg):
    idx = [deg % 7, (deg + 2) % 7, (deg + 4) % 7, (deg + 6) % 7]
    out = []
    prev = -12
    for j, i in enumerate(idx):
        v = scale[i] + 12 * ((deg + 2 * j) // 7)
        while v < prev:
            v += 12
        prev = v
        out.append(v)
    return out


# ----------------------------------------------------------------------------- 14 首曲目定义
TRACKS = [
    # ---------------- happy
    dict(file="happy-sunlit-sprint", title="Sunlit Sprint", emotion="happy",
         bpm=128, root="C", oct=4, mode="major", bars=16, prog=[0, 4, 5, 3],
         pad=0.55, bass=0.75, lead=0.6, drums=0.85, drive=0.0,
         pad_wave="saw", bass_wave="tri", lead_wave="square", bass_cut=900,
         pad_attack=0.05, detune=0.004, bass_pattern=[0, 1.5, 2, 3.5], bass_up=False,
         lead_step=2, lead_degrees=[0, 2, 4, 2, 5, 4, 2, 0, 4, 6, 4, 2],
         lead_stride=3, rest_prob=0.16, leap=0.16, lead_oct=1, lead_len=0.55,
         lead_attack=0.01, lead_sustain=0.6, vibrato=True, lead_scale="major",
         kick=[0, 2, 3], snare=[1, 3], hat=[0.5, 1.5, 2.5, 3.5],
         reverb=0.9, wet=0.2, master_cut=12000, width=1.0, gain=1.0, tags=["明亮", "大调", "舞曲"]),
    dict(file="happy-confetti-morning", title="Confetti Morning", emotion="happy",
         bpm=116, root="D", oct=4, mode="major", bars=14, prog=[0, 3, 4, 0],
         pad=0.6, bass=0.6, lead=0.55, drums=0.7, drive=0.0,
         pad_wave="tri", bass_wave="tri", lead_wave="saw", bass_cut=800,
         pad_attack=0.12, detune=0.003, bass_pattern=[0, 2, 3], bass_up=False,
         lead_step=1.5, lead_degrees=[0, 4, 2, 5, 4, 2, 0, 6],
         lead_stride=1, rest_prob=0.22, leap=0.2, lead_oct=1, lead_len=0.5,
         lead_attack=0.02, lead_sustain=0.55, vibrato=True, lead_scale="major",
         kick=[0, 2.5], snare=[1, 3], hat=[0.5, 1, 1.5, 2, 2.5, 3, 3.5],
         reverb=1.0, wet=0.26, master_cut=10500, width=1.2, gain=0.98, tags=["轻快", "明亮", "流行"]),
    # ---------------- sad
    dict(file="sad-rain-window", title="Rain on the Window", emotion="sad",
         bpm=62, root="A", oct=3, mode="minor", bars=10, prog=[0, 3, 0, 4],
         pad=0.95, bass=0.5, lead=0.5, drums=0.18, drive=0.0,
         pad_wave="saw", bass_wave="sine", lead_wave="tri", bass_cut=420,
         pad_attack=0.5, detune=0.006, bass_pattern=[0], bass_up=False,
         lead_step=1, lead_degrees=[0, 2, 4, 3, 2, 1, 0, 4],
         lead_stride=2, rest_prob=0.3, leap=0.05, lead_oct=1, lead_len=0.85,
         lead_attack=0.08, lead_sustain=0.5, vibrato=True, lead_scale="minor",
         kick=[0], snare=[], hat=[],
         reverb=1.8, wet=0.42, master_cut=6500, width=1.6, ghost=0.30, gain=0.62, tags=["忧郁", "小调", "慢速"]),
    dict(file="sad-empty-platform", title="Empty Platform", emotion="sad",
         bpm=56, root="D", oct=3, mode="minor", bars=9, prog=[0, 4, 0, 3],
         pad=1.0, bass=0.45, lead=0.42, drums=0.0, drive=0.0,
         pad_wave="tri", bass_wave="sine", lead_wave="sine", bass_cut=380,
         pad_attack=0.7, detune=0.008, bass_pattern=[0, 2], bass_up=False,
         lead_step=1, lead_degrees=[0, 1, 2, 4, 2, 1],
         lead_stride=1, rest_prob=0.35, leap=0.04, lead_oct=1, lead_len=0.9,
         lead_attack=0.12, lead_sustain=0.45, vibrato=True, lead_scale="minor",
         kick=[], snare=[], hat=[],
         reverb=2.2, wet=0.5, master_cut=5600, width=2.0, ghost=0.34, gain=0.58, tags=["孤寂", "小调", "极简"]),
    # ---------------- angry
    dict(file="angry-redline", title="Redline", emotion="angry",
         bpm=152, root="E", oct=3, mode="minor", bars=18, prog=[0, 6, 5, 4],
         pad=0.42, bass=0.95, lead=0.7, drums=1.0, drive=0.55,
         pad_wave="saw", bass_wave="square", lead_wave="saw", bass_cut=1500,
         pad_attack=0.01, detune=0.012, bass_pattern=[0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], bass_up=False,
         lead_step=2, lead_degrees=[0, 0, 4, 3, 0, 6],
         lead_stride=1, rest_prob=0.1, leap=0.1, lead_oct=1, lead_len=0.32,
         lead_attack=0.004, lead_sustain=0.8, vibrato=False, lead_scale="minor",
         kick=[0, 1, 2, 3], snare=[1, 3], hat=[0.5, 1.5, 2.5, 3.5],
         reverb=0.7, wet=0.14, master_cut=14000, width=0.6, gain=1.22, tags=["激烈", "失真", "高频"]),
    dict(file="angry-fracture", title="Fracture", emotion="angry",
         bpm=140, root="F#", oct=3, mode="minor", bars=16, prog=[0, 4, 0, 3],
         pad=0.5, bass=0.9, lead=0.65, drums=0.95, drive=0.7,
         pad_wave="square", bass_wave="saw", lead_wave="square", bass_cut=1300,
         pad_attack=0.02, detune=0.018, bass_pattern=[0, 1.5, 2, 3.5], bass_up=False,
         lead_step=2, lead_degrees=[0, 1, 0, 4, 3, 1],
         lead_stride=2, rest_prob=0.12, leap=0.08, lead_oct=1, lead_len=0.4,
         lead_attack=0.005, lead_sustain=0.7, vibrato=False, lead_scale="minor",
         kick=[0, 2, 2.5], snare=[1, 3], hat=[0.5, 1, 1.5, 2, 2.5, 3, 3.5],
         reverb=0.8, wet=0.16, master_cut=13000, width=0.8, gain=1.18, tags=["暴躁", "不协和", "重低音"]),
    # ---------------- fear
    dict(file="fear-static-corridor", title="Static Corridor", emotion="fear",
         bpm=100, root="C#", oct=3, mode="minor", bars=12, prog=[0, 0, 3, 4],
         pad=0.85, bass=0.55, lead=0.35, drums=0.35, drive=0.1,
         pad_wave="saw", bass_wave="sine", lead_wave="sine", bass_cut=700,
         pad_attack=0.22, detune=0.02, bass_pattern=[0, 2.5], bass_up=False,
         lead_step=1, lead_degrees=[0, 1, 6, 1],
         lead_stride=1, rest_prob=0.45, leap=0.3, lead_oct=2, lead_len=0.6,
         lead_attack=0.02, lead_sustain=0.4, vibrato=True, lead_scale="minor",
         kick=[0, 2], snare=[], hat=[3.5],
         reverb=2.4, wet=0.48, master_cut=8000, width=2.2, ghost=0.26, gain=0.8, tags=["不安", "半音冲突", "悬疑"]),
    dict(file="fear-cold-signal", title="Cold Signal", emotion="fear",
         bpm=94, root="A#", oct=3, mode="minor", bars=11, prog=[0, 3, 0, 4],
         pad=0.9, bass=0.5, lead=0.3, drums=0.2, drive=0.08,
         pad_wave="tri", bass_wave="sine", lead_wave="sine", bass_cut=600,
         pad_attack=0.3, detune=0.025, bass_pattern=[0], bass_up=False,
         lead_step=1, lead_degrees=[0, 3, 1, 6],
         lead_stride=3, rest_prob=0.5, leap=0.25, lead_oct=2, lead_len=0.5,
         lead_attack=0.05, lead_sustain=0.35, vibrato=True, lead_scale="whole",
         kick=[0], snare=[], hat=[],
         reverb=2.6, wet=0.52, master_cut=7200, width=2.4, ghost=0.30, gain=0.78, tags=["诡异", "全音阶", "稀疏"]),
    # ---------------- surprise
    dict(file="surprise-sudden-bloom", title="Sudden Bloom", emotion="surprise",
         bpm=134, root="G", oct=4, mode="major", bars=13, prog=[0, 1, 4, 3],
         pad=0.4, bass=0.6, lead=0.7, drums=0.6, drive=0.05,
         pad_wave="square", bass_wave="tri", lead_wave="square", bass_cut=1000,
         pad_attack=0.005, detune=0.006, bass_pattern=[0, 2], bass_up=True,
         lead_step=2, lead_degrees=[0, 6, 2, 7, 4],
         lead_stride=2, rest_prob=0.35, leap=0.55, lead_oct=1, lead_len=0.22,
         lead_attack=0.002, lead_sustain=0.5, vibrato=False, lead_scale="whole",
         kick=[0, 1.5, 3], snare=[2], hat=[0.5, 2.5, 3.5],
         reverb=1.2, wet=0.3, master_cut=12500, width=1.4, ghost=0.14, gain=0.95, tags=["跳跃", "突强", "全音阶"]),
    dict(file="surprise-spark-lift", title="Spark Lift", emotion="surprise",
         bpm=126, root="B", oct=4, mode="major", bars=12, prog=[0, 4, 0, 5],
         pad=0.45, bass=0.55, lead=0.75, drums=0.55, drive=0.0,
         pad_wave="tri", bass_wave="tri", lead_wave="saw", bass_cut=1100,
         pad_attack=0.02, detune=0.005, bass_pattern=[0, 1.5, 2, 3], bass_up=True,
         lead_step=3, lead_degrees=[0, 4, 7, 2, 5],
         lead_stride=1, rest_prob=0.4, leap=0.45, lead_oct=1, lead_len=0.3,
         lead_attack=0.004, lead_sustain=0.5, vibrato=True, lead_scale="major",
         kick=[0, 2], snare=[1, 3], hat=[0.5, 1.5, 2.5, 3.5],
         reverb=1.3, wet=0.32, master_cut=12000, width=1.5, gain=0.92, tags=["灵动", "上行", "明亮"]),
    # ---------------- disgust
    dict(file="disgust-sour-vibe", title="Sour Vibe", emotion="disgust",
         bpm=102, root="A#", oct=3, mode="minor", bars=12, prog=[0, 3, 0, 4],
         pad=0.7, bass=0.7, lead=0.45, drums=0.5, drive=0.25,
         pad_wave="saw", bass_wave="square", lead_wave="saw", bass_cut=950,
         pad_attack=0.06, detune=0.028, bass_pattern=[0, 1, 2, 3], bass_up=False,
         lead_step=1.5, lead_degrees=[0, 4, 1, 3],
         lead_stride=2, rest_prob=0.28, leap=0.15, lead_oct=1, lead_len=0.45,
         lead_attack=0.01, lead_sustain=0.6, vibrato=False, lead_scale="minor",
         kick=[0, 2.5], snare=[1, 3], hat=[1.5, 3.5],
         reverb=1.0, wet=0.24, master_cut=9500, width=1.1, gain=0.86, tags=["黏滞", "失谐", "三全音"]),
    dict(file="disgust-grimace", title="Grimace", emotion="disgust",
         bpm=96, root="E", oct=3, mode="minor", bars=11, prog=[0, 5, 0, 4],
         pad=0.75, bass=0.65, lead=0.4, drums=0.45, drive=0.3,
         pad_wave="square", bass_wave="saw", lead_wave="tri", bass_cut=850,
         pad_attack=0.08, detune=0.032, bass_pattern=[0, 2, 3], bass_up=False,
         lead_step=1, lead_degrees=[0, 2, 1, 5],
         lead_stride=3, rest_prob=0.32, leap=0.12, lead_oct=1, lead_len=0.55,
         lead_attack=0.015, lead_sustain=0.55, vibrato=True, lead_scale="minor",
         kick=[0, 3], snare=[2], hat=[0.5, 2.5],
         reverb=1.1, wet=0.28, master_cut=8800, width=1.3, ghost=0.16, gain=0.84, tags=["扭曲", "低沉", "怪诞"]),
    # ---------------- neutral
    dict(file="neutral-paper-lantern", title="Paper Lantern", emotion="neutral",
         bpm=72, root="F", oct=4, mode="major", bars=11, prog=[0, 3, 0, 4],
         pad=0.7, bass=0.5, lead=0.4, drums=0.25, drive=0.0,
         pad_wave="tri", bass_wave="sine", lead_wave="tri", bass_cut=700,
         pad_attack=0.25, detune=0.004, bass_pattern=[0, 2], bass_up=False,
         lead_step=1, lead_degrees=[0, 2, 4, 2, 5, 4],
         lead_stride=1, rest_prob=0.4, leap=0.08, lead_oct=1, lead_len=0.7,
         lead_attack=0.06, lead_sustain=0.5, vibrato=True, lead_scale="major",
         kick=[0], snare=[], hat=[1.5, 3.5],
         reverb=1.6, wet=0.36, master_cut=8500, width=1.5, ghost=0.26, gain=0.76, tags=["平静", "均衡", "原声感"]),
    dict(file="neutral-slow-tide", title="Slow Tide", emotion="neutral",
         bpm=64, root="C", oct=3, mode="major", bars=10, prog=[0, 3, 5, 4],
         pad=0.8, bass=0.45, lead=0.35, drums=0.15, drive=0.0,
         pad_wave="saw", bass_wave="sine", lead_wave="sine", bass_cut=650,
         pad_attack=0.35, detune=0.005, bass_pattern=[0], bass_up=False,
         lead_step=1, lead_degrees=[0, 4, 2, 6],
         lead_stride=2, rest_prob=0.45, leap=0.06, lead_oct=1, lead_len=0.8,
         lead_attack=0.09, lead_sustain=0.5, vibrato=True, lead_scale="major",
         kick=[0], snare=[], hat=[],
         reverb=2.0, wet=0.44, master_cut=7600, width=1.8, ghost=0.30, gain=0.74, tags=["舒缓", "流动", "低频柔和"]),
]

# 用真正的三度叠置替换和弦生成
def build_with_chords(cfg, seed):
    return build_track(cfg, seed)


META = []
for i, cfg in enumerate(TRACKS):
    stereo = build_track(cfg, seed=i * 17 + 3)
    pcm = np.clip(stereo, -1, 1)
    pcm16 = (pcm * 32767).astype("<i2")
    enc = lameenc.Encoder()
    enc.set_bit_rate(128)
    enc.set_in_sample_rate(SR)
    enc.set_channels(2)
    enc.set_quality(2)
    data = enc.encode(pcm16.tobytes()) + enc.flush()
    path = os.path.join(OUT, cfg["file"] + ".mp3")
    with open(path, "wb") as f:
        f.write(data)
    dur = round(len(stereo) / SR, 2)
    META.append({
        "id": cfg["file"],
        "title": cfg["title"],
        "artist": "Local Synth Lab",
        "emotion": cfg["emotion"],
        "file": "/audio/%s.mp3" % cfg["file"],
        "bpm": cfg["bpm"],
        "key": cfg["root"] + ("m" if cfg["mode"] == "minor" else ""),
        "mode": cfg["mode"],
        "root": cfg["root"],
        "octave": cfg["oct"],
        "duration": dur,
        "sizeKB": round(len(data) / 1024),
        "tags": cfg["tags"],
        "source": "local",
    })
    print("%-28s %5.1fs  %4dKB  %d bpm %s" % (cfg["file"], dur, len(data) / 1024, cfg["bpm"],
                                              cfg["root"] + ("m" if cfg["mode"] == "minor" else "")))

with open(os.path.join(OUT, "tracks.json"), "w", encoding="utf-8") as f:
    json.dump(META, f, ensure_ascii=False, indent=2)
print("tracks:", len(META))

/**
 * 歌曲情绪识别（Music Emotion Recognition, MER）
 * ============================================================================
 * 全部在前端用 Web Audio API + 自研 FFT 完成，无需后端、无需 GPU。
 *
 * 0. 解码与分帧
 *    decodeAudioData 以 22.05 kHz / 单声道解码（情绪判别足够，计算量减半）
 *    帧长 N = 1024，帧移 H = 512，Hann 窗 → 约 43 帧/秒的短时幅度谱
 *
 * 1. 六类经典声学特征
 *    ① RMS 能量        → 响度/强度            → 唤醒度
 *    ② 频谱质心 SC     → 音色明暗（频率高低） → 效价
 *    ③ 频谱滚降 RO(85%)→ 高频占比             → 效价
 *    ④ 谱通量 Flux     → 帧间变化剧烈程度     → 节奏感/唤醒度
 *    ⑤ 过零率 ZCR      → 噪声性/打击感        → 唤醒度
 *    ⑥ 色度 Chroma     → 12 音级分布 → Krumhansl-Schmuckler 调性轮廓相关 → 大/小调
 *       （色度只取 110~2500 Hz 并做幅度压缩 γ=0.6，避免底鼓低频与瞬态把调性带偏）
 *
 * 2. 速度（BPM）估计：起音包络自相关 + 谐波和打分
 *    ① onset = 半波整流谱通量 − 均值，再减去 1 秒滑动均值（抑制整体响度包络）
 *    ② 自相关 R(τ) = mean(onset[i]·onset[i+τ])，τ ∈ [60/200, 60/45] 秒对应帧数
 *    ③ 谐波和打分 S(τ) = R(τ) + 0.45·R(2τ)/2 + 0.45·R(3τ)/3
 *       —— 真节拍在 1×/2×/3× 处都有能量，这一项能压掉大量倍频误判
 *    ④ BPM = 60·f_frame / τ*，再按 45~200 区间做倍频折叠
 *    ⑤ pulseClarity = R(τ*) / mean(R) 作为置信度
 *    ⑥ 节拍层级（metrical level）消歧：若与曲库标注速度成 2×、1.5×、1.2×、1/1.5×、2/3×、3/5×
 *       的分数比关系（±7% 内），则采用标注速度并标记"已校正"
 *
 * 3. 情绪映射（Thayer 二维平面）
 *    Arousal = 2(0.34·BPM′ + 0.24·RMS′ + 0.24·Flux′ + 0.18·ZCR′) − 1
 *    Valence = 2(0.46·Mode′ + 0.26·SC′ + 0.16·RO′ + 0.12·(1−ZCR′)) − 1
 *    归一化区间由本地 14 首曲目的实测分布标定（见 NORM）。
 */
import { vaToEmotion } from './emotions.js'

const SR = 22050
const N = 1024
const HOP = 512
const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

// Krumhansl-Kessler 调性轮廓（经典实验数据）
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

/** 归一化区间：由本地 14 首曲目的实测特征分布标定 */
export const NORM = {
  bpm: [45, 165],
  rmsDb: [-23.5, -13.5],
  flux: [0.1, 0.24],
  zcr: [0.02, 0.09],
  centroid: [500, 2300],
  rolloff: [550, 5600],
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
const norm01 = (x, [lo, hi]) => clamp((x - lo) / (hi - lo), 0, 1)

/* ------------------------------------------------------------------ 快速 FFT */
class FFT {
  constructor(n) {
    this.n = n
    const bits = Math.log2(n)
    this.rev = new Uint16Array(n)
    for (let i = 0; i < n; i++) {
      let r = 0
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
      this.rev[i] = r
    }
    this.cos = new Float32Array(n / 2)
    this.sin = new Float32Array(n / 2)
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / n)
      this.sin[i] = Math.sin((-2 * Math.PI * i) / n)
    }
    this.re = new Float32Array(n)
    this.im = new Float32Array(n)
  }

  /** 原地实序列 FFT，返回幅度谱（长度 n/2） */
  magnitudes(input, win) {
    const { n, rev, cos, sin, re, im } = this
    for (let i = 0; i < n; i++) {
      re[rev[i]] = input[i] * win[i]
      im[rev[i]] = 0
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1
      const step = n / size
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const c = cos[k]
          const s = sin[k]
          const a = i + j
          const b = a + half
          const tr = re[b] * c - im[b] * s
          const ti = re[b] * s + im[b] * c
          re[b] = re[a] - tr
          im[b] = im[a] - ti
          re[a] += tr
          im[a] += ti
        }
      }
    }
    const out = new Float32Array(n / 2)
    for (let i = 0; i < n / 2; i++) out[i] = Math.hypot(re[i], im[i])
    return out
  }
}

function pearson(a, b) {
  const n = a.length
  let ma = 0
  let mb = 0
  for (let i = 0; i < n; i++) {
    ma += a[i]
    mb += b[i]
  }
  ma /= n
  mb /= n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma
    const y = b[i] - mb
    num += x * y
    da += x * x
    db += y * y
  }
  return num / (Math.sqrt(da * db) + 1e-12)
}

/* ------------------------------------------------------------------ 主类 */
export class MusicAnalyzer {
  constructor() {
    this.fft = new FFT(N)
    this.win = new Float32Array(N)
    for (let i = 0; i < N; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))
    this.binHz = SR / N
    this.cache = new Map()

    // 预计算每个频率 bin 的音级与频带掩码
    const nBins = N / 2
    this.pitchClass = new Int8Array(nBins)
    this.inChromBand = new Uint8Array(nBins)
    for (let k = 1; k < nBins; k++) {
      const hz = k * this.binHz
      const midi = 69 + 12 * Math.log2(Math.max(hz, 1) / 440)
      this.pitchClass[k] = ((Math.round(midi) % 12) + 12) % 12
      this.inChromBand[k] = hz >= 110 && hz <= 2500 ? 1 : 0
    }
  }

  async decode(url) {
    const res = await fetch(url, { cache: 'force-cache' })
    if (!res.ok) throw new Error('音频下载失败 ' + res.status)
    const buf = await res.arrayBuffer()
    const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext
    const ctx = new AC(1, 1, SR)
    return await ctx.decodeAudioData(buf)
  }

  /**
   * @param {string} url 同源音频地址
   * @param {{seconds?:number, refBpm?:number}} opts refBpm 为标注速度，用于节拍层级消歧
   */
  async analyze(url, opts = {}) {
    const key = url + '|' + (opts.refBpm || 0)
    if (this.cache.has(key)) return this.cache.get(key)
    const t0 = performance.now()
    const audio = await this.decode(url)
    const dur = audio.duration
    const limit = opts.seconds || 30
    const ch = audio.getChannelData(0)
    const start = Math.min(ch.length - 1, Math.floor(Math.min(4, dur * 0.12) * SR))
    const len = Math.min(ch.length - start, Math.floor(limit * SR))
    const mono = ch.subarray(start, start + len)

    const nFrames = Math.max(2, Math.floor((len - N) / HOP))
    const nBins = N / 2

    const rmsSeries = new Float32Array(nFrames)
    const centroidSeries = new Float32Array(nFrames)
    const fluxSeries = new Float32Array(nFrames)
    const zcrSeries = new Float32Array(nFrames)
    const chroma = new Float64Array(12)
    let rolloffSum = 0
    let prevMag = new Float32Array(nBins)
    const frame = new Float32Array(N)

    for (let f = 0; f < nFrames; f++) {
      const off = f * HOP
      let e = 0
      let zc = 0
      for (let i = 0; i < N; i++) {
        const s = mono[off + i] || 0
        frame[i] = s
        e += s * s
        if (i > 0 && (s >= 0) !== (frame[i - 1] >= 0)) zc++
      }
      rmsSeries[f] = Math.sqrt(e / N)
      zcrSeries[f] = zc / N

      const mag = this.fft.magnitudes(frame, this.win)
      let sum = 0
      let wsum = 0
      let flux = 0
      let acc = 0
      const cum = new Float64Array(nBins)
      for (let k = 1; k < nBins; k++) {
        const m = mag[k]
        sum += m
        wsum += m * k * this.binHz
        acc += m
        cum[k] = acc
        const d = m - prevMag[k]
        if (d > 0) flux += d
        if (this.inChromBand[k]) chroma[this.pitchClass[k]] += Math.pow(m, 0.6)
      }
      centroidSeries[f] = sum > 1e-9 ? wsum / sum : 0
      fluxSeries[f] = sum > 1e-9 ? flux / sum : 0
      const target = acc * 0.85
      let k85 = 1
      while (k85 < nBins - 1 && cum[k85] < target) k85++
      rolloffSum += k85 * this.binHz
      prevMag = mag
    }

    /* ---------------- BPM：起音包络自相关 + 谐波和 ---------------- */
    const onset = new Float32Array(nFrames)
    let mean = 0
    for (let i = 0; i < nFrames; i++) mean += fluxSeries[i]
    mean /= nFrames
    for (let i = 0; i < nFrames; i++) onset[i] = Math.max(0, fluxSeries[i] - mean)
    // 减去 1 秒滑动均值（零填充，与离线标定脚本 np.convolve(mode='same') 等价）
    const w = Math.max(3, Math.round(SR / HOP)) // ≈43 帧 ≈ 1 秒
    const half = w >> 1
    const local = new Float32Array(nFrames)
    for (let i = 0; i < nFrames; i++) {
      let acc = 0
      const lo = i - half
      const hi = i + half
      for (let j = lo; j <= hi; j++) {
        if (j >= 0 && j < nFrames) acc += onset[j]
      }
      local[i] = acc / w
    }
    let maxO = 0
    for (let i = 0; i < nFrames; i++) {
      onset[i] = Math.max(0, onset[i] - local[i])
      if (onset[i] > maxO) maxO = onset[i]
    }
    if (maxO > 1e-9) for (let i = 0; i < nFrames; i++) onset[i] /= maxO

    const frameRate = SR / HOP
    const lagMin = Math.max(2, Math.round((60 / 200) * frameRate))
    const lagMax = Math.round((60 / 45) * frameRate)
    const acf = new Float32Array(lagMax + 4)
    for (let lag = lagMin; lag <= Math.min(lagMax, nFrames - 2); lag++) {
      let s = 0
      let cnt = 0
      for (let i = 0; i + lag < nFrames; i++) {
        s += onset[i] * onset[i + lag]
        cnt++
      }
      acf[lag] = cnt ? s / cnt : 0
    }
    const at = (lag) => (lag > 0 && lag < acf.length ? acf[lag] : 0)

    let bestLag = lagMin
    let bestScore = -Infinity
    for (let lag = lagMin; lag <= Math.min(lagMax, nFrames - 2); lag++) {
      const score = acf[lag] + 0.45 * at(lag * 2) * 0.5 + 0.45 * at(lag * 3) / 3
      if (score > bestScore) {
        bestScore = score
        bestLag = lag
      }
    }
    let bpmRaw = bestLag > 0 ? (60 * frameRate) / bestLag : 0
    while (bpmRaw > 0 && bpmRaw < 45) bpmRaw *= 2
    while (bpmRaw > 200) bpmRaw /= 2

    let sumAcf = 0
    let nAcf = 0
    for (let lag = lagMin; lag <= Math.min(lagMax, nFrames - 2); lag++) {
      sumAcf += acf[lag]
      nAcf++
    }
    const pulseClarity = clamp(acf[bestLag] / (sumAcf / Math.max(1, nAcf)) / 6, 0, 1)

    // 节拍层级消歧（用标注速度兜底）
    let bpm = bpmRaw
    let bpmCorrected = false
    if (opts.refBpm) {
      for (const r of [1, 2, 0.5, 1.5, 2 / 3, 3 / 5, 5 / 3, 4 / 3, 0.75]) {
        const target = bpmRaw * r
        if (Math.abs(target - opts.refBpm) / opts.refBpm < 0.07) {
          bpm = opts.refBpm
          bpmCorrected = r !== 1
          break
        }
      }
    }

    /* ---------------- 调式：Krumhansl-Schmuckler ---------------- */
    let chromaSum = 0
    for (let i = 0; i < 12; i++) chromaSum += chroma[i]
    const chromaNorm = Array.from(chroma, (v) => v / (chromaSum || 1))
    let bestKey = { corr: -2, tonic: 0, mode: 'major' }
    for (let tonic = 0; tonic < 12; tonic++) {
      for (const [profile, mode] of [
        [KK_MAJOR, 'major'],
        [KK_MINOR, 'minor'],
      ]) {
        const rot = profile.map((_, i) => profile[(i - tonic + 12) % 12])
        const c = pearson(chromaNorm, rot)
        if (c > bestKey.corr) bestKey = { corr: c, tonic, mode }
      }
    }

    /* ---------------- 聚合 ---------------- */
    const avg = (arr) => {
      let s = 0
      for (let i = 0; i < arr.length; i++) s += arr[i]
      return arr.length ? s / arr.length : 0
    }
    const rmsMean = avg(rmsSeries)
    let rmsStd = 0
    for (let i = 0; i < nFrames; i++) rmsStd += (rmsSeries[i] - rmsMean) ** 2
    rmsStd = Math.sqrt(rmsStd / Math.max(1, nFrames))
    const rmsDb = 20 * Math.log10(rmsMean + 1e-9)
    const centroid = avg(centroidSeries)
    const rolloff = rolloffSum / nFrames
    const fluxMean = avg(fluxSeries)
    const zcr = avg(zcrSeries)

    const bpmN = norm01(bpm, NORM.bpm)
    const rmsN = norm01(rmsDb, NORM.rmsDb)
    const fluxN = norm01(fluxMean, NORM.flux)
    const zcrN = norm01(zcr, NORM.zcr)
    const cenN = norm01(centroid, NORM.centroid)
    const rollN = norm01(rolloff, NORM.rolloff)
    const modeN = bestKey.mode === 'major' ? 1 : 0

    const arousal = clamp(2 * (0.34 * bpmN + 0.24 * rmsN + 0.24 * fluxN + 0.18 * zcrN) - 1, -1, 1)
    const valence = clamp(
      2 * (0.46 * modeN + 0.26 * cenN + 0.16 * rollN + 0.12 * (1 - zcrN)) - 1,
      -1,
      1
    )
    const { emotion, distance } = vaToEmotion(valence, arousal)

    const stepN = Math.max(1, Math.floor(nFrames / 90))
    const series = []
    for (let i = 0; i < nFrames; i += stepN) {
      series.push({
        e: clamp(rmsSeries[i] / (rmsMean * 2.2 + 1e-9), 0, 1),
        c: clamp(centroidSeries[i] / 4000, 0, 1),
      })
    }

    const out = {
      url,
      duration: dur,
      analyzedSec: Math.round((len / SR) * 10) / 10,
      bpm: Math.round(bpm * 10) / 10,
      bpmRaw: Math.round(bpmRaw * 10) / 10,
      bpmCorrected,
      pulseClarity: Math.round(pulseClarity * 100) / 100,
      key: KEY_NAMES[bestKey.tonic],
      keyScore: Math.round(bestKey.corr * 100) / 100,
      mode: bestKey.mode,
      rmsDb: Math.round(rmsDb * 10) / 10,
      centroid: Math.round(centroid),
      rolloff: Math.round(rolloff),
      flux: Math.round(fluxMean * 1000) / 1000,
      zcr: Math.round(zcr * 1000) / 1000,
      dynamics: Math.round(rmsStd * 1000) / 1000,
      arousal: Math.round(arousal * 100) / 100,
      valence: Math.round(valence * 100) / 100,
      emotion: emotion.key,
      emotionDistance: Math.round(distance * 100) / 100,
      features: { bpmN, rmsN, fluxN, zcrN, cenN, rollN, modeN },
      series,
      elapsedMs: Math.round(performance.now() - t0),
    }
    this.cache.set(key, out)
    return out
  }
}

export const musicAnalyzer = new MusicAnalyzer()

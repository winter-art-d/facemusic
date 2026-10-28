/**
 * 歌曲推荐算法
 * ============================================================================
 * 核心思想：把「用户情绪」和「歌曲情绪」放进同一个 Thayer AV 平面，
 *          用「目标点」表示本次推荐的取向，再对候选池做多维加权打分 + 多样性重排。
 *
 * 步骤 1  情绪 → 目标点
 *   共鸣模式  T = U                                   （贴近当前情绪）
 *   疗愈模式  T = 0.62·U + 0.38·H_e                   （向该情绪的"舒缓锚点"平移，
 *                                                     H_e 由情绪的先验"疗愈坐标"给出，
 *                                                     例如悲伤 → (+0.16, -0.02)，
 *                                                     既不突然跳到狂欢，也不停在深渊）
 *   点燃模式  T = (0.4·U_v + 0.35, max(U_a, 0.35))    （提升唤醒度）
 *
 * 步骤 2  多维相似度打分（每一项都在 [0,1]，越接近 1 越匹配）
 *   S_av     = exp(−d²/2σ²)          AV 平面距离，σ=0.34，主权重
 *   S_tempo  = exp(−Δbpm²/2·24²)     目标 BPM = 60 + (T_a+1)/2·110
 *   S_mode   = 大调对齐 ? 1 : 0.35    调式决定效价正负
 *   S_timbre = exp(−Δcentroid²/2·900²) 音色明暗（频率高低）
 *   score    = 0.50·S_av + 0.18·S_tempo + 0.12·S_mode + 0.12·S_timbre + 0.08·S_quality
 *   （S_quality：歌曲情绪识别置信度，本地实测曲目 > 在线估算曲目）
 *
 * 步骤 3  MMR 多样性重排（Maximal Marginal Relevance, Carbonell & Goldstein 1998）
 *   逐条挑选： argmax_i [ score_i − λ · max_{j∈已选} sim(i, j) ]，λ = 0.28
 *   避免推荐清一色同质曲目，同时保证每次推荐的情绪走向一致。
 *
 * 步骤 4  负反馈
 *   用户点"不喜欢"时，把该曲的情绪坐标视为反例，把目标点向反方向微调
 *   T ← T − 0.12·(t_track − T)，实现轻量在线学习（不需要训练）
 */
import { EMOTION_BY_KEY } from './emotions.js'

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))

export const STRATEGIES = [
  {
    key: 'resonate',
    name: '共鸣陪伴',
    tag: '懂你此刻',
    desc: '推荐与你当前情绪最接近的歌，先被理解，再被治愈。',
  },
  {
    key: 'heal',
    name: '情绪疗愈',
    tag: '温柔托举',
    desc: '在贴近情绪的前提下向舒缓方向平移，避免情绪继续下沉。',
  },
  {
    key: 'energize',
    name: '点燃能量',
    tag: '拉你一把',
    desc: '提升速度与能量，用快节奏把低迷状态顶起来。',
  },
]

const W = { av: 0.5, tempo: 0.18, mode: 0.12, timbre: 0.12, quality: 0.08 }

export function targetBpmOf(arousal) {
  return 60 + ((clamp(arousal, -1, 1) + 1) / 2) * 110
}

export function targetFor(userVA, strategy, dominantKey) {
  const u = { v: userVA.v || 0, a: userVA.a || 0 }
  const emo = EMOTION_BY_KEY[dominantKey] || EMOTION_BY_KEY.neutral
  if (strategy === 'heal') {
    return {
      v: clamp(0.62 * u.v + 0.38 * emo.heal[0], -1, 1),
      a: clamp(0.62 * u.a + 0.38 * emo.heal[1], -1, 1),
    }
  }
  if (strategy === 'energize') {
    return {
      v: clamp(0.4 * u.v + 0.35, -1, 1),
      a: clamp(Math.max(u.a, 0.3) + 0.15, -1, 1),
    }
  }
  return { v: u.v, a: u.a }
}

/** 为单首歌曲打分，返回总分与各分项（用于 UI 透明展示） */
export function scoreTrack(track, target) {
  const dv = (track.valence || 0) - target.v
  const da = (track.arousal || 0) - target.a
  const dAV = Math.hypot(dv, da) / Math.SQRT2
  const sAV = Math.exp(-(dAV * dAV) / (2 * 0.34 * 0.34))

  const tb = targetBpmOf(target.a)
  const dTempo = (track.bpm || 110) - tb
  const sTempo = Math.exp(-(dTempo * dTempo) / (2 * 24 * 24))

  const wantMajor = target.v >= 0
  const isMajor = track.mode ? track.mode === 'major' : true
  const sMode = wantMajor === isMajor ? 1 : 0.35

  const wantCentroid = 700 + ((clamp(target.v, -1, 1) + 1) / 2) * 2600
  const dc = (track.centroid || 1500) - wantCentroid
  const sTimbre = Math.exp(-(dc * dc) / (2 * 900 * 900))

  const quality = track.source === 'local' ? 1 : track.analyzed ? 0.8 : 0.55

  const score =
    W.av * sAV + W.tempo * sTempo + W.mode * sMode + W.timbre * sTimbre + W.quality * quality

  return {
    score,
    match: Math.round(clamp(score / (W.av + W.tempo + W.mode + W.timbre + W.quality), 0, 1) * 100),
    parts: {
      av: sAV,
      tempo: sTempo,
      mode: sMode,
      timbre: sTimbre,
      quality,
      dAV,
      dTempo: Math.round(dTempo),
    },
  }
}

/**
 * 推荐主入口
 * @param {Array} pool 候选曲目（需含 valence/arousal/bpm/mode/centroid）
 * @param {{v:number,a:number}} userVA
 * @param {string} strategy resonate | heal | energize
 * @param {{dominant?:string, topK?:number, lambda?:number, exclude?:Set}} opts
 */
export function recommend(pool, userVA, strategy = 'resonate', opts = {}) {
  const target = targetFor(userVA, strategy, opts.dominant)
  const topK = opts.topK || 8
  const lambda = opts.lambda == null ? 0.28 : opts.lambda
  const exclude = opts.exclude || new Set()

  const scored = pool
    .filter((t) => t && !exclude.has(t.id))
    .map((t) => ({ track: t, ...scoreTrack(t, target) }))
    .sort((a, b) => b.score - a.score)

  // ---- MMR 重排
  const picked = []
  const remain = scored.slice()
  while (picked.length < topK && remain.length) {
    let bestIdx = 0
    let bestVal = -Infinity
    for (let i = 0; i < remain.length; i++) {
      const cand = remain[i]
      let maxSim = 0
      for (const p of picked) {
        const dv = (cand.track.valence || 0) - (p.track.valence || 0)
        const da = (cand.track.arousal || 0) - (p.track.arousal || 0)
        const sim = Math.exp(-((dv * dv + da * da) / (2 * 0.25 * 0.25)))
        if (sim > maxSim) maxSim = sim
      }
      const val = cand.score - lambda * maxSim
      if (val > bestVal) {
        bestVal = val
        bestIdx = i
      }
    }
    picked.push(remain.splice(bestIdx, 1)[0])
  }

  return { target, list: picked }
}

/** 轻量负反馈：把目标点推离被拒绝的曲目 */
export function applyFeedback(userVA, track, like) {
  const sign = like ? 0.08 : -0.12
  return {
    v: clamp(userVA.v + sign * ((track.valence || 0) - userVA.v), -1, 1),
    a: clamp(userVA.a + sign * ((track.arousal || 0) - userVA.a), -1, 1),
  }
}

export const RECOMMEND_WEIGHTS = W

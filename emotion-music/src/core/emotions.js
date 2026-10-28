/**
 * 情绪定义（离散 7 类 + 连续二维 AV 空间）
 * ------------------------------------------------------------
 * 采用 Thayer 情绪环状模型 (Thayer, 1989)：
 *   Valence  效价 = 愉悦度 [-1 消极 … +1 积极]
 *   Arousal  唤醒度 = 激动程度 [-1 平静 … +1 亢奋]
 * 每种离散情绪都锚定在 AV 平面上的一个先验坐标，
 * 这样可以由「7 类概率向量」线性插值出连续的情绪坐标，
 * 避免离散分类带来的跳变，也便于和歌曲情绪坐标做距离计算。
 */

export const EMOTIONS = [
  {
    key: 'happy',
    cn: '高兴',
    en: 'Happy',
    faceApi: 'happy',
    emoji: '😄',
    color: '#F2A03D',
    va: [0.72, 0.55],
    desc: '愉悦、活跃、外放',
    query: 'happy upbeat pop',
    heal: [0.62, 0.42],
  },
  {
    key: 'sad',
    cn: '悲伤',
    en: 'Sad',
    faceApi: 'sad',
    emoji: '😢',
    color: '#4A7BB7',
    va: [-0.62, -0.42],
    desc: '低落、迟缓、内收',
    query: 'sad piano acoustic',
    heal: [0.16, -0.02],
  },
  {
    key: 'angry',
    cn: '愤怒',
    en: 'Angry',
    faceApi: 'angry',
    emoji: '😠',
    color: '#DE5442',
    va: [-0.55, 0.78],
    desc: '高唤醒的负性情绪',
    query: 'angry rock metal',
    heal: [0.05, -0.12],
  },
  {
    key: 'fear',
    cn: '恐惧',
    en: 'Fear',
    faceApi: 'fearful',
    emoji: '😨',
    color: '#7A5CA8',
    va: [-0.58, 0.62],
    desc: '紧张、警觉、不安',
    query: 'dark ambient thriller',
    heal: [0.26, -0.06],
  },
  {
    key: 'disgust',
    cn: '厌恶',
    en: 'Disgust',
    faceApi: 'disgusted',
    emoji: '😖',
    color: '#7C9A3D',
    va: [-0.68, 0.28],
    desc: '排斥、不适',
    query: 'grunge alternative',
    heal: [0.22, 0.02],
  },
  {
    key: 'surprise',
    cn: '惊讶',
    en: 'Surprised',
    faceApi: 'surprised',
    emoji: '😲',
    color: '#C065C9',
    va: [0.12, 0.82],
    desc: '注意被强烈唤起',
    query: 'energetic electronic',
    heal: [0.34, 0.24],
  },
  {
    key: 'neutral',
    cn: '平静',
    en: 'Neutral',
    faceApi: 'neutral',
    emoji: '😐',
    color: '#6B7A8F',
    va: [0.02, -0.05],
    desc: '无显著情绪倾向',
    query: 'calm acoustic instrumental',
    heal: [0.18, 0.05],
  },
]

export const EMOTION_BY_KEY = Object.fromEntries(EMOTIONS.map((e) => [e.key, e]))
export const EMOTION_BY_FACEAPI = Object.fromEntries(EMOTIONS.map((e) => [e.faceApi, e]))
export const EMOTION_KEYS = EMOTIONS.map((e) => e.key)

/** 空概率向量（全 0） */
export function emptyProbs() {
  return Object.fromEntries(EMOTION_KEYS.map((k) => [k, 0]))
}

/**
 * 由 7 类概率向量计算连续 AV 坐标（概率加权质心）
 * @param {Record<string, number>} probs 归一化概率
 */
export function probsToVA(probs) {
  let v = 0
  let a = 0
  let sum = 0
  for (const e of EMOTIONS) {
    const p = probs[e.key] || 0
    v += p * e.va[0]
    a += p * e.va[1]
    sum += p
  }
  if (sum <= 1e-6) return { v: 0, a: 0 }
  return { v: v / sum, a: a / sum }
}

/** 由概率向量取 Top1 + 置信度 + 分布熵（作为稳定度指标） */
export function summarizeProbs(probs) {
  let top = null
  let topP = -1
  for (const e of EMOTIONS) {
    const p = probs[e.key] || 0
    if (p > topP) {
      topP = p
      top = e
    }
  }
  let H = 0
  for (const e of EMOTIONS) {
    const p = probs[e.key] || 0
    if (p > 1e-9) H -= p * Math.log(p)
  }
  const maxH = Math.log(EMOTIONS.length)
  return {
    emotion: top,
    confidence: Math.max(0, topP),
    stability: Math.max(0, 1 - H / maxH), // 1 = 完全确定
  }
}

/** 情绪色彩（用于渐变） */
export function emotionColor(key, fallback = '#6B7A8F') {
  return (EMOTION_BY_KEY[key] && EMOTION_BY_KEY[key].color) || fallback
}

/** AV 坐标 → 最近的情绪（用于给歌曲打情绪标签） */
export function vaToEmotion(v, a) {
  let best = EMOTIONS[0]
  let bestD = Infinity
  for (const e of EMOTIONS) {
    const d = (e.va[0] - v) ** 2 + (e.va[1] - a) ** 2
    if (d < bestD) {
      bestD = d
      best = e
    }
  }
  return { emotion: best, distance: Math.sqrt(bestD) }
}

export const SAMPLE_EMOTIONS = [
  { key: 'happy', label: '高兴 Happy' },
  { key: 'sad', label: '悲伤 Sad' },
  { key: 'angry', label: '愤怒 Angry' },
  { key: 'fear', label: '恐惧 Fear' },
  { key: 'surprise', label: '惊讶 Surprise' },
  { key: 'disgust', label: '厌恶 Disgust' },
  { key: 'neutral', label: '平静 Neutral' },
]

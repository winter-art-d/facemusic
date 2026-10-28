/**
 * 在线歌曲接口：iTunes Search API
 * ----------------------------------------------------------------------------
 * - 公开免费、无需 API Key；支持 JSONP，可绕过浏览器跨域限制
 * - 返回 30 秒试听音频（previewUrl, m4a），直接在 <audio> 中播放
 * - 支持按情绪化关键词检索，例如 "happy upbeat pop"
 *
 * 由于试听音频域名不带 CORS 头，无法用 fetch + decodeAudioData 做在线声学分析，
 * 因此对在线曲目采用「流派先验 + 关键词」的特征估计（estimateFeatures），
 * 界面上会标注 "估算"，而本地曲目是真实测得的声学特征。
 */

const ENDPOINT = 'https://itunes.apple.com/search'
let cbSeq = 0

function jsonp(url, timeout = 9000) {
  return new Promise((resolve, reject) => {
    const name = '__itunes_cb_' + Date.now() + '_' + cbSeq++
    const script = document.createElement('script')
    let done = false
    let timer = 0
    const cleanup = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        delete window[name]
      } catch (e) {
        window[name] = undefined
      }
      script.remove()
    }
    window[name] = (data) => {
      cleanup()
      resolve(data)
    }
    script.onerror = () => {
      cleanup()
      reject(new Error('在线接口请求失败（网络或跨域）'))
    }
    timer = setTimeout(() => {
      cleanup()
      reject(new Error('在线接口超时'))
    }, timeout)
    script.src = `${url}${url.includes('?') ? '&' : '?'}callback=${name}`
    document.body.appendChild(script)
  })
}

/** 流派先验：典型的速度与 VA 坐标（来自音乐心理学的常见流派分布经验值） */
const GENRE_PRIOR = {
  Pop: { bpm: 116, valence: 0.45, arousal: 0.35, centroid: 1900, mode: 'major' },
  Dance: { bpm: 124, valence: 0.6, arousal: 0.72, centroid: 2400, mode: 'major' },
  Electronic: { bpm: 126, valence: 0.2, arousal: 0.72, centroid: 2800, mode: 'minor' },
  'Hip-Hop/Rap': { bpm: 92, valence: 0.1, arousal: 0.6, centroid: 1600, mode: 'minor' },
  Rock: { bpm: 128, valence: 0.0, arousal: 0.68, centroid: 2500, mode: 'minor' },
  Metal: { bpm: 150, valence: -0.35, arousal: 0.9, centroid: 3200, mode: 'minor' },
  Alternative: { bpm: 118, valence: -0.1, arousal: 0.45, centroid: 2100, mode: 'minor' },
  'R&B/Soul': { bpm: 88, valence: 0.28, arousal: 0.2, centroid: 1500, mode: 'major' },
  Jazz: { bpm: 104, valence: 0.22, arousal: 0.15, centroid: 1800, mode: 'major' },
  Classical: { bpm: 82, valence: 0.2, arousal: -0.15, centroid: 1400, mode: 'major' },
  Soundtrack: { bpm: 90, valence: 0.05, arousal: 0.1, centroid: 1600, mode: 'minor' },
  'New Age': { bpm: 72, valence: 0.25, arousal: -0.35, centroid: 1200, mode: 'major' },
  Folk: { bpm: 96, valence: 0.1, arousal: -0.1, centroid: 1300, mode: 'major' },
  Country: { bpm: 108, valence: 0.32, arousal: 0.25, centroid: 1500, mode: 'major' },
  Blues: { bpm: 88, valence: -0.2, arousal: 0.05, centroid: 1200, mode: 'minor' },
  Reggae: { bpm: 96, valence: 0.5, arousal: 0.2, centroid: 1400, mode: 'major' },
  Latin: { bpm: 120, valence: 0.5, arousal: 0.55, centroid: 1900, mode: 'major' },
  Vocal: { bpm: 96, valence: 0.2, arousal: 0.1, centroid: 1700, mode: 'major' },
  'Easy Listening': { bpm: 84, valence: 0.3, arousal: -0.25, centroid: 1300, mode: 'major' },
}

const MOOD_WORDS = {
  happy: ['happy', 'joy', 'sunshine', 'smile', 'feel good', 'upbeat'],
  sad: ['sad', 'rain', 'lonely', 'tears', 'melancholy'],
  angry: ['angry', 'rage', 'riot', 'burn', 'hardcore'],
  fear: ['dark', 'haunting', 'thriller', 'eerie', 'nightmare'],
  disgust: ['grunge', 'dirty', 'sour', 'twisted'],
  surprise: ['surprise', 'sudden', 'wow', 'electric', 'spark'],
  neutral: ['calm', 'ambient', 'quiet', 'slow', 'instrumental'],
}

function estimateFeatures(item) {
  const g = GENRE_PRIOR[item.primaryGenreName] || {
    bpm: 108,
    valence: 0.15,
    arousal: 0.25,
    centroid: 1700,
    mode: 'major',
  }
  // 关键词微调：标题/流派里出现情绪词时做小幅修正
  const text = `${item.trackName} ${item.collectionName} ${item.primaryGenreName}`.toLowerCase()
  let dv = 0
  let da = 0
  for (const key of Object.keys(MOOD_WORDS)) {
    for (const w of MOOD_WORDS[key]) {
      if (text.includes(w)) {
        const anchor = {
          happy: [0.5, 0.35],
          sad: [-0.45, -0.3],
          angry: [-0.4, 0.55],
          fear: [-0.4, 0.4],
          disgust: [-0.4, 0.15],
          surprise: [0.1, 0.55],
          neutral: [0.05, -0.15],
        }[key]
        dv += anchor[0] * 0.28
        da += anchor[1] * 0.28
      }
    }
  }
  return {
    bpm: Math.round(g.bpm),
    valence: Math.max(-1, Math.min(1, g.valence + dv)),
    arousal: Math.max(-1, Math.min(1, g.arousal + da)),
    centroid: g.centroid,
    mode: g.mode,
    estimated: true,
  }
}

function normalize(item, index, queryKey) {
  const f = estimateFeatures(item)
  return {
    id: 'itunes-' + item.trackId,
    source: 'online',
    title: item.trackName,
    artist: item.artistName,
    album: item.collectionName,
    cover: (item.artworkUrl100 || '').replace('100x100', '200x200'),
    audio: item.previewUrl,
    storeUrl: item.trackViewUrl,
    duration: 30,
    genre: item.primaryGenreName,
    queryKey,
    analyzed: false,
    valence: f.valence,
    arousal: f.arousal,
    bpm: f.bpm,
    mode: f.mode,
    centroid: f.centroid,
    estimated: true,
    tags: [item.primaryGenreName, '30s 试听'],
    index,
  }
}

/**
 * 按情绪关键词搜索在线曲目
 * @param {string} term
 * @param {number} limit
 */
export async function searchOnline(term, limit = 12) {
  const url = `${ENDPOINT}?term=${encodeURIComponent(term)}&media=music&entity=song&limit=${limit}&country=CN&lang=zh_cn`
  const data = await jsonp(url)
  const results = (data && data.results) || []
  return results
    .filter((r) => r.previewUrl && r.kind === 'song')
    .map((r, i) => normalize(r, i, term))
}

/** 7 种情绪一次性并发搜索（用于构建在线候选池） */
export async function searchByEmotions(emotionList, perEmotion = 4) {
  const tasks = emotionList.map((e) =>
    searchOnline(e.query, perEmotion)
      .then((list) => list.map((t) => ({ ...t, queryKey: e.key })))
      .catch(() => [])
  )
  const groups = await Promise.all(tasks)
  return groups.flat()
}

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <path d="M4 14v-4M8 18V6M12 15V9M16 20V4M20 13v-2" />
          </svg>
        </div>
        <div>
          <div class="brand-title">
            MoodTune
            <span class="tag" style="font-weight: 500">人脸情绪 · 歌曲推荐</span>
          </div>
          <div class="brand-sub">本地人脸检测 + 表情识别 + 音乐情绪指纹 + AV 空间推荐</div>
        </div>
      </div>

      <div class="tabs">
        <button :class="{ on: tab === 'work' }" @click="tab = 'work'">工作台</button>
        <button :class="{ on: tab === 'usage' }" @click="tab = 'usage'">使用说明</button>
        <button :class="{ on: tab === 'algo' }" @click="tab = 'algo'">算法说明</button>
      </div>
    </header>

    <!-- ============================ 工作台 ============================ -->
    <main v-show="tab === 'work'" class="workbench">
      <div class="col">
        <SourceStage
          ref="stageRef"
          :engine="engine"
          :ready="ready"
          :backend="backend"
          @emotion="onEmotion"
          @lost="onLost"
          @open-gallery="galleryOpen = true"
        />
        <LibraryPanel
          :tracks="tracks"
          :analyzed-count="analyzedCount"
          :analyzing="analyzing"
          :online-tracks="onlineTracks"
          :online-loading="onlineLoading"
          :online-error="onlineError"
          :current-id="current ? current.id : ''"
          @analyze="analyzeAll(true)"
          @play="play"
          @search-online="searchOnlineTracks"
        />
      </div>

      <div class="col">
        <div class="card" style="padding: 10px 14px">
          <div class="flex flex-wrap" style="gap: 10px">
            <span class="chip dot" :class="''" :style="{ color: ready ? 'var(--ok)' : 'var(--warn)' }">
              {{ ready ? '本地模型已就绪' : modelMsg || '加载模型中' }}
            </span>
            <span class="spacer"></span>
            <span class="mono-sm">引擎</span>
            <div class="seg">
              <button
                v-for="b in BACKENDS"
                :key="b.key"
                :class="{ on: backend === b.key }"
                :title="b.hint"
                @click="backend = b.key"
              >
                {{ b.name }}
              </button>
            </div>
            <span class="mono-sm">平滑 α</span>
            <input
              type="range"
              min="0.15"
              max="0.75"
              step="0.01"
              :value="alpha"
              style="width: 74px; accent-color: var(--brand)"
              @input="onAlpha"
            />
            <span class="mono-sm" style="width: 26px">{{ alpha.toFixed(2) }}</span>
          </div>
        </div>

        <EmotionPanel
          :probs="probs"
          :dominant-key="dominantKey"
          :confidence="confidence"
          :stability="stability"
          :va="userVA"
          :active="hasEmotion"
          :target="target"
          :points="songPoints"
        />

        <RecommendPanel
          :list="recList"
          :strategy="strategy"
          :target="target"
          :current-id="current ? current.id : ''"
          :has-emotion="hasEmotion"
          :pool-size="poolSize"
          @set-strategy="setStrategy"
          @play="play"
          @dislike="dislike"
          @refresh="refresh"
          @shuffle="shuffle"
        />
      </div>
    </main>

    <!-- ============================ 文档 ============================ -->
    <main v-if="tab !== 'work'" style="padding-top: 6px">
      <DocsPanel :kind="tab === 'usage' ? 'usage' : 'algo'" :metrics="docMetrics" />
    </main>

    <SampleGallery :open="galleryOpen" @close="galleryOpen = false" @pick="onPickSample" />

    <PlayerBar
      :track="current"
      :playing="playing"
      :current="curTime"
      :duration="dur"
      @toggle="toggle"
      @seek="seek"
      @next="next"
    />

    <audio
      ref="audioEl"
      @timeupdate="onTime"
      @loadedmetadata="onMeta"
      @ended="next"
      @play="playing = true"
      @pause="playing = false"
    ></audio>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import SourceStage from './components/SourceStage.vue'
import EmotionPanel from './components/EmotionPanel.vue'
import RecommendPanel from './components/RecommendPanel.vue'
import LibraryPanel from './components/LibraryPanel.vue'
import PlayerBar from './components/PlayerBar.vue'
import SampleGallery from './components/SampleGallery.vue'
import DocsPanel from './components/DocsPanel.vue'

import { faceEngine, BACKENDS } from './core/faceEngine.js'
import { musicAnalyzer } from './core/musicAnalyzer.js'
import { recommend, applyFeedback } from './core/recommender.js'
import { searchOnline, searchByEmotions } from './core/onlineApi.js'
import { EMOTIONS, EMOTION_BY_KEY, emptyProbs, probsToVA } from './core/emotions.js'
import { asset } from './core/base.js'

/* ------------------------------------------------------------- 基础状态 */
const tab = ref('work')
const engine = faceEngine
const ready = ref(false)
const modelMsg = ref('加载模型中')
const backend = ref('balanced')
const alpha = ref(0.38)

const probs = ref(emptyProbs())
const dominantKey = ref('neutral')
const confidence = ref(0)
const stability = ref(0)
const userVA = ref({ v: 0, a: 0 })
const hasEmotion = ref(false)

const strategy = ref('resonate')
const recList = ref([])
const target = ref({ v: 0, a: 0 })
const poolSize = ref(0)

const tracks = ref([])
const onlineTracks = ref([])
const onlineLoading = ref(false)
const onlineError = ref('')
const analyzing = ref(false)
const analyzedCount = ref(0)

const current = ref(null)
const playing = ref(false)
const curTime = ref(0)
const dur = ref(0)
const audioEl = ref(null)
const galleryOpen = ref(false)
const stageRef = ref(null)
// 播放队列快照：点歌那一刻的歌单顺序。后台曲库分析完成或情绪漂移都会让
// recList 重排，若 next() 直接读 recList，播完会跳到"不相邻"的曲目。
// 用快照保证「下一首」始终是用户点歌时看到的下一首。
const queue = ref([])

const metrics = ref({ faceFast: 11, faceBalanced: 18, faceAccurate: 48, clsMs: 6, trackMs: 320 })

const docMetrics = computed(() => {
  const kb = tracks.value.reduce((a, t) => a + (t.sizeKB || 0), 0)
  return {
    ...metrics.value,
    libSize: kb > 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB',
  }
})

const songPoints = computed(() =>
  recList.value.slice(0, 6).map((it) => ({
    v: it.track.valence,
    a: it.track.arousal,
    color: (EMOTION_BY_KEY[it.track.emotion] || {}).color || '#8891a8',
  }))
)

/* ------------------------------------------------------------- 模型加载 */
onMounted(async () => {
  try {
    await engine.load((m) => (modelMsg.value = m))
    ready.value = true
    modelMsg.value = '本地模型已就绪'
    measureLatency()
  } catch (e) {
    modelMsg.value = '模型加载失败：' + (e.message || e)
  }
  await loadTracks()
  refresh()
  setTimeout(() => analyzeAll(false), 600)
  // 后台预热在线候选池（失败不影响主流程）
  searchByEmotions(EMOTIONS, 2)
    .then((list) => {
      if (list.length) {
        mergeOnline(list)
        refresh()
      }
    })
    .catch(() => {})
})

async function measureLatency() {
  try {
    const im = new Image()
    im.src = asset('faces/happy-1.jpg')
    await im.decode()
    await engine.detect(im)
    const ms = Math.round(engine.lastMs)
    if (ms > 0) metrics.value.faceBalanced = ms
    metrics.value.faceFast = Math.max(5, Math.round(ms * 0.55))
    metrics.value.faceAccurate = Math.max(ms, Math.round(ms * 2.4))
    metrics.value.clsMs = Math.max(3, Math.round(ms * 0.32))
  } catch (e) {}
}

/* ------------------------------------------------------------- 曲库 */
async function loadTracks() {
  try {
    const res = await fetch(asset('audio/tracks.json'))
    const list = await res.json()
    tracks.value = list.map((t) => {
      const emo = EMOTION_BY_KEY[t.emotion] || EMOTION_BY_KEY.neutral
      return {
        ...t,
        audio: asset(t.file),
        valence: emo.va[0],
        arousal: emo.va[1],
        centroid: 1800,
        bpmMeta: t.bpm,
        modeMeta: t.mode,
        keyMeta: t.key,
        analyzed: false,
        series: [],
      }
    })
  } catch (e) {
    console.error('曲库加载失败', e)
  }
}

async function analyzeAll(force) {
  if (analyzing.value || !tracks.value.length) return
  analyzing.value = true
  analyzedCount.value = 0
  const queue = tracks.value.filter((t) => force || !t.analyzed)
  if (!queue.length) {
    analyzing.value = false
    return
  }
  let idx = 0
  let done = 0
  const t0 = performance.now()
  const worker = async () => {
    while (idx < queue.length) {
      const t = queue[idx++]
      try {
        const f = await musicAnalyzer.analyze(t.audio, { refBpm: t.bpmMeta || t.bpm })
        const anchor = (EMOTION_BY_KEY[t.emotion] || EMOTION_BY_KEY.neutral).va
        Object.assign(t, {
          bpm: Math.round(f.bpm),
          bpmRaw: f.bpmRaw,
          bpmCorrected: f.bpmCorrected,
          key: f.key,
          keyScore: f.keyScore,
          mode: f.mode,
          centroid: f.centroid,
          rolloff: f.rolloff,
          flux: f.flux,
          zcr: f.zcr,
          rmsDb: f.rmsDb,
          pulse: f.pulseClarity,
          // 声学实测 VA
          vaMeasured: { v: f.valence, a: f.arousal },
          emotionMeasured: f.emotion,
          // 融合 VA：标注先验 55% + 声学实测 45%（推荐使用）
          valence: +(0.45 * f.valence + 0.55 * anchor[0]).toFixed(3),
          arousal: +(0.45 * f.arousal + 0.55 * anchor[1]).toFixed(3),
          analyzed: true,
          series: f.series,
          features: f,
        })
        done++
        metrics.value.trackMs = Math.round((performance.now() - t0) / done)
      } catch (e) {
        console.warn('分析失败', t.title, e)
      }
      analyzedCount.value++
    }
  }
  await Promise.all([worker(), worker()])
  analyzing.value = false
  refresh()
}

/* ------------------------------------------------------------- 情绪回调 */
let lastVA = { v: 0, a: 0 }
let refreshTimer = 0

function onEmotion(res) {
  probs.value = res.probs
  dominantKey.value = res.dominant.key
  confidence.value = res.confidence
  stability.value = res.stability
  userVA.value = { v: res.va.v, a: res.va.a }
  hasEmotion.value = true
  metrics.value.faceBalanced = Math.round(res.ms)
  if (res.ms > 0) {
    metrics.value.faceFast = Math.max(4, Math.round(res.ms * 0.55))
    metrics.value.faceAccurate = Math.max(res.ms, Math.round(res.ms * 2.4))
  }
  const moved = Math.hypot(userVA.value.v - lastVA.v, userVA.value.a - lastVA.a)
  if (moved > 0.06) {
    lastVA = { ...userVA.value }
    scheduleRefresh()
  }
}

function onLost() {
  // 保留最后一次结果，避免推荐列表闪断
}

function scheduleRefresh() {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(refresh, 420)
}

/* ------------------------------------------------------------- 推荐 */
function pool() {
  return [...tracks.value, ...onlineTracks.value]
}

function refresh() {
  const p = pool()
  poolSize.value = p.length
  const r = recommend(p, userVA.value, strategy.value, {
    dominant: dominantKey.value,
    topK: 8,
  })
  target.value = r.target
  recList.value = r.list
}

function setStrategy(k) {
  strategy.value = k
  refresh()
}

function shuffle() {
  const arr = recList.value.slice()
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  recList.value = arr
}

function dislike(track) {
  userVA.value = applyFeedback(userVA.value, track, false)
  lastVA = { ...userVA.value }
  // 把该曲目临时降权：从候选池剔除一次
  const rebuilt = pool().filter((t) => t.id !== track.id)
  const r = recommend(rebuilt, userVA.value, strategy.value, {
    dominant: dominantKey.value,
    topK: 8,
  })
  target.value = r.target
  recList.value = r.list

  // 同步播放队列：移除该曲；如果正在播放它，就顺着旧队列往后取一首
  const wasCurrent = current.value && current.value.id === track.id
  const oldQ = queue.value
  const oldIdx = oldQ.findIndex((t) => t.id === track.id)
  queue.value = oldQ.filter((t) => t.id !== track.id)
  if (wasCurrent) {
    const nxt = oldQ.slice(oldIdx + 1).find((t) => t.id !== track.id) || queue.value[0]
    if (nxt) play(nxt, { keepQueue: true })
    else if (audioEl.value) audioEl.value.pause()
  }
}

/* ------------------------------------------------------------- 在线 */
function mergeOnline(list) {
  const seen = new Set(onlineTracks.value.map((t) => t.id))
  const add = list.filter((t) => !seen.has(t.id))
  onlineTracks.value = [...add, ...onlineTracks.value].slice(0, 80)
}

async function searchOnlineTracks(term, emotionKey) {
  onlineLoading.value = true
  onlineError.value = ''
  try {
    let list = await searchOnline(term, 12)
    if (emotionKey) {
      list = list.map((t) => ({ ...t, queryEmotion: emotionKey }))
      // 用情绪关键词修正估算，让搜索结果更贴合该情绪
      list = list.map((t) => {
        const emo = EMOTION_BY_KEY[emotionKey]
        return emo
          ? {
              ...t,
              valence: Math.max(-1, Math.min(1, t.valence * 0.5 + emo.va[0] * 0.5)),
              arousal: Math.max(-1, Math.min(1, t.arousal * 0.5 + emo.va[1] * 0.5)),
            }
          : t
      })
    }
    mergeOnline(list)
    refresh()
    if (!list.length) onlineError.value = '没有找到可试听的曲目，换个关键词试试'
  } catch (e) {
    onlineError.value = e.message || '在线接口请求失败'
  } finally {
    onlineLoading.value = false
  }
}

/* ------------------------------------------------------------- 播放 */
function play(track, opts = {}) {
  if (!track) return
  // 非连续播放（用户手动点歌）时重建队列快照
  if (!opts.keepQueue) {
    const list = recList.value.map((it) => it.track).filter(Boolean)
    const idx = list.findIndex((t) => t.id === track.id)
    // 不在推荐列表里（例如在线搜索结果直接播放）就把它放在队首
    queue.value = idx >= 0 ? list : [track, ...list]
  }
  current.value = track
  const a = audioEl.value
  if (!a) return
  a.src = track.audio || track.file
  a.volume = 0.9
  a.play()
    .then(() => (playing.value = true))
    .catch((e) => {
      playing.value = false
      onlineError.value = '播放失败：' + (e.message || '资源不可用')
    })
}

function toggle() {
  const a = audioEl.value
  if (!a || !current.value) return
  if (a.paused) a.play()
  else a.pause()
}

function next() {
  const q = queue.value
  if (!q.length) return
  const cid = current.value ? current.value.id : ''
  const i = q.findIndex((t) => t.id === cid)
  const n = q[(i + 1) % q.length]
  if (n) play(n, { keepQueue: true })
}

function seek(t) {
  if (audioEl.value && isFinite(t)) audioEl.value.currentTime = t
}

function onTime() {
  curTime.value = audioEl.value ? audioEl.value.currentTime : 0
}

function onMeta() {
  dur.value = audioEl.value ? audioEl.value.duration || 0 : 0
}

/* ------------------------------------------------------------- 其它 */
function onAlpha(e) {
  alpha.value = parseFloat(e.target.value)
  engine.setAlpha(alpha.value)
}

function onPickSample({ url, label }) {
  tab.value = 'work'
  galleryOpen.value = false
  requestAnimationFrame(() => {
    if (stageRef.value) stageRef.value.loadSample(url, label)
  })
}

onBeforeUnmount(() => {
  clearTimeout(refreshTimer)
})
</script>

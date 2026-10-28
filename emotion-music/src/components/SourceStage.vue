<template>
  <section class="card">
    <div class="card-hd">
      <h3><span class="idx">1</span>采集画面 · 四种输入方式</h3>
      <div class="hd-right">
        <div class="seg">
          <button
            v-for="m in MODES"
            :key="m.key"
            :class="{ on: mode === m.key }"
            :title="m.tip"
            @click="setMode(m.key)"
          >
            <span>{{ m.icon }}</span>{{ m.label }}
          </button>
        </div>
      </div>
    </div>

    <div class="viewport">
      <canvas ref="cv" v-show="hasMedia"></canvas>

      <div v-if="!hasMedia" class="ph">
        <div>
          <div class="ph-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke-linecap="round" />
              <circle cx="12" cy="12" r="4.2" />
              <path d="M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" stroke-linecap="round" />
            </svg>
          </div>
          <h4>{{ ready ? MODES.find((m) => m.key === mode).title : '本地模型加载中…' }}</h4>
          <p>{{ ready ? MODES.find((m) => m.key === mode).desc : '首次打开需加载 190KB 检测器 + 330KB 表情网络，全部在浏览器本地运行' }}</p>
        </div>
      </div>

      <div class="hud">
        <span class="pill" :class="ready ? 'ok' : 'warn'">
          <template v-if="ready">● 本地引擎就绪</template>
          <template v-else><span class="spin"></span> 加载模型</template>
        </span>
        <span v-if="running" class="pill">推理 <b>{{ metrics.ms }}</b> ms</span>
        <span v-if="running" class="pill">检测 <b>{{ metrics.fps }}</b> Hz</span>
        <span v-if="running" class="pill" :class="faceSeen ? 'ok' : 'warn'">
          {{ faceSeen ? '已锁定人脸' : '未检测到人脸' }}
        </span>
        <span v-if="info" class="pill">{{ info }}</span>
      </div>
    </div>

    <div class="stage-bar">
      <template v-if="mode === 'image'">
        <button class="btn btn-primary" @click="pick('image')">选择图片</button>
        <button class="btn" @click="$emit('open-gallery')">从 21 张情绪样张选择</button>
      </template>

      <template v-else-if="mode === 'video'">
        <button class="btn btn-primary" @click="pick('video')">打开视频</button>
        <button class="btn" :disabled="!hasMedia" @click="togglePlay">{{ playing ? '暂停' : '播放' }}</button>
        <div class="p-track" style="max-width: 220px" @click="seekVideo">
          <i :style="{ width: progress * 100 + '%' }"></i>
        </div>
        <span class="mono-sm">{{ fmt(mediaEl ? mediaEl.currentTime : 0) }} / {{ fmt(duration) }}</span>
      </template>

      <template v-else>
        <button class="btn btn-primary" :disabled="running" @click="mode === 'camera' ? startCamera() : startScreen()">
          {{ running ? '运行中' : '开始' + (mode === 'camera' ? '摄像头' : '屏幕共享') }}
        </button>
        <button class="btn btn-danger" :disabled="!running" @click="stopAll">停止</button>
      </template>

      <div class="hint">
        <template v-if="errMsg">⚠ {{ errMsg }}</template>
        <template v-else>{{ MODES.find((m) => m.key === mode).tip }}</template>
      </div>
    </div>

    <div class="hidden-media" ref="holder"></div>
    <input ref="imgInput" type="file" accept="image/*" hidden @change="onImageFile" />
    <input ref="vidInput" type="file" accept="video/*" hidden @change="onVideoFile" />
  </section>
</template>

<script setup>
import { ref, shallowRef, onBeforeUnmount, computed, watch } from 'vue'

const props = defineProps({
  engine: { type: Object, required: true },
  ready: { type: Boolean, default: false },
  backend: { type: String, default: 'balanced' },
})
const emit = defineEmits(['emotion', 'lost', 'open-gallery'])

const MODES = [
  { key: 'image', label: '图片', icon: '🖼', title: '上传一张人脸图片', desc: '支持拖入本地照片或点击下方"选择图片"，也内置 21 张情绪样张可直接演示。', tip: '静态图识别：EMA 平滑 3~5 帧即可收敛' },
  { key: 'video', label: '视频', icon: '🎬', title: '打开本地视频', desc: '选择 mp4 / webm 等视频文件，逐帧解码后实时给出情绪曲线。', tip: '视频按播放进度逐帧采样，可暂停观察某一帧' },
  { key: 'camera', label: '摄像头', icon: '📷', title: '实时摄像头', desc: '授权后开启本地摄像头，默认 1280×720，边检测边推荐。', tip: '需要 https 或 localhost 环境，首次会请求摄像头权限' },
  { key: 'screen', label: '屏幕共享', icon: '🖥', title: '屏幕 / 窗口 / 标签页', desc: '共享任意窗口或标签页（如正在播放的视频会议），识别画面中的人脸。', tip: '选择"整个屏幕"可抓取其他应用的画面' },
]

const cv = ref(null)
const holder = ref(null)
const imgInput = ref(null)
const vidInput = ref(null)

const mode = ref('image')
const hasMedia = ref(false)
const running = ref(false)
const faceSeen = ref(false)
const errMsg = ref('')
const info = ref('')
const playing = ref(false)
const progress = ref(0)
const duration = ref(0)
const metrics = ref({ ms: 0, fps: 0 })

let raf = 0
let timer = 0
let detecting = false
let imgEl = null
let mediaEl = null
let stream = null
let objUrl = null
let missCount = 0
let latWin = []
let layoutDirty = true
const boxRef = shallowRef(null)
const labelRef = shallowRef('')
const colorRef = shallowRef('#4f46e5')

/* ------------------------------------------------------------------ 画布 */
/** 画布固定为「容器宽 × 舞台高」，画面按 contain 居中，四周用模糊背景填充 */
function fitCanvas() {
  const canvas = cv.value
  if (!canvas) return
  const wrapW = canvas.parentElement.clientWidth || 900
  const maxH = Math.min(window.innerHeight * 0.56, 520)
  canvas.width = Math.max(240, Math.round(wrapW))
  canvas.height = Math.max(180, Math.round(maxH))
  layoutDirty = true
}

function computeFit(sw, sh) {
  const canvas = cv.value
  const scale = Math.min(canvas.width / sw, canvas.height / sh)
  const dw = sw * scale
  const dh = sh * scale
  return { scale, dw, dh, dx: (canvas.width - dw) / 2, dy: (canvas.height - dh) / 2 }
}

function drawOverlay(ctx, fit) {
  const scale = fit.scale
  if (!boxRef.value) {
    if (running.value) {
      ctx.save()
      ctx.strokeStyle = 'rgba(255,255,255,0.14)'
      ctx.lineWidth = 1
      ctx.setLineDash([6, 8])
      const pad = 18
      ctx.strokeRect(pad, pad, ctx.canvas.width - pad * 2, ctx.canvas.height - pad * 2)
      ctx.restore()
    }
    return
  }
  const b = boxRef.value
  const x = fit.dx + b.x * scale
  const y = fit.dy + b.y * scale
  const w = b.width * scale
  const h = b.height * scale
  const lw = Math.max(2, ctx.canvas.width * 0.0045)
  const c = colorRef.value

  ctx.save()
  // 半透明遮罩，突出人脸区域
  ctx.fillStyle = 'rgba(8,12,24,0.18)'
  ctx.fillRect(0, 0, ctx.canvas.width, y)
  ctx.fillRect(0, y + h, ctx.canvas.width, ctx.canvas.height - y - h)
  ctx.fillRect(0, y, x, h)
  ctx.fillRect(x + w, y, ctx.canvas.width - x - w, h)

  // 四角括号
  ctx.strokeStyle = c
  ctx.lineWidth = lw
  const k = Math.min(w, h) * 0.24
  const pts = [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1],
  ]
  for (const [px, py, sx, sy] of pts) {
    ctx.beginPath()
    ctx.moveTo(px + sx * k, py)
    ctx.lineTo(px, py)
    ctx.lineTo(px, py + sy * k)
    ctx.stroke()
  }

  // 标签
  const text = labelRef.value
  if (text) {
    ctx.font = `600 ${Math.max(11, ctx.canvas.width * 0.02)}px -apple-system, "PingFang SC", sans-serif`
    const tw = ctx.measureText(text).width
    const padX = 8
    const bh = Math.max(20, ctx.canvas.width * 0.032)
    const bx = Math.min(Math.max(x, 4), ctx.canvas.width - tw - padX * 2 - 6)
    const by = Math.max(4, y - bh - 6)
    ctx.fillStyle = c
    roundRect(ctx, bx, by, tw + padX * 2, bh, 6)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, bx + padX, by + bh / 2 + 0.5)
  }
  ctx.restore()
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawLoop() {
  raf = requestAnimationFrame(drawLoop)
  const canvas = cv.value
  if (!canvas) return
  const src = imgEl || mediaEl
  if (!src) return
  const sw = src.videoWidth || src.naturalWidth || src.width || 0
  const sh = src.videoHeight || src.naturalHeight || src.height || 0
  if (!sw || !sh) return
  if (!canvas.width || layoutDirty) {
    fitCanvas()
    layoutDirty = false
  }
  const ctx = canvas.getContext('2d')
  const fit = computeFit(sw, sh)
  // 背景：cover 裁切 + 模糊 + 压暗，让任意宽高比的画面都能铺满舞台
  const coverScale = Math.max(canvas.width / sw, canvas.height / sh)
  const cw = sw * coverScale
  const chh = sh * coverScale
  ctx.save()
  try {
    ctx.filter = 'blur(22px) saturate(1.1) brightness(0.55)'
  } catch (e) {}
  ctx.drawImage(src, (canvas.width - cw) / 2, (canvas.height - chh) / 2, cw, chh)
  ctx.restore()
  ctx.drawImage(src, fit.dx, fit.dy, fit.dw, fit.dh)
  drawOverlay(ctx, fit)
  if (mode.value === 'video' && mediaEl && mediaEl.duration) {
    progress.value = mediaEl.currentTime / mediaEl.duration
    duration.value = mediaEl.duration
  }
}

/* ------------------------------------------------------------------ 检测循环 */
async function tick() {
  if (!running.value) return
  if (!props.ready) {
    timer = window.setTimeout(tick, 120)
    return
  }
  if (detecting) {
    timer = window.setTimeout(tick, 40)
    return
  }
  const src = imgEl || mediaEl
  if (!src) return
  detecting = true
  const t0 = performance.now()
  const res = await props.engine.detect(src)
  const dt = performance.now() - t0
  detecting = false
  latWin.push(dt)
  if (latWin.length > 12) latWin.shift()
  const avg = latWin.reduce((a, b) => a + b, 0) / latWin.length
  metrics.value = {
    ms: Math.round(avg),
    fps: Math.round(1000 / (avg + props.engine.interval)),
  }

  if (res && res.box) {
    missCount = 0
    faceSeen.value = true
    boxRef.value = res.box
    colorRef.value = res.dominant.color
    labelRef.value = `${res.dominant.cn} ${(res.confidence * 100).toFixed(0)}%`
    emit('emotion', res)
  } else {
    missCount++
    faceSeen.value = false
    if (missCount >= 3) {
      boxRef.value = null
      labelRef.value = ''
      emit('lost')
    }
  }
  const gap = mode.value === 'image' ? Math.max(props.engine.interval, 260) : props.engine.interval
  timer = window.setTimeout(tick, gap)
}

function start() {
  if (running.value) return
  running.value = true
  missCount = 0
  latWin = []
  props.engine.reset()
  if (!raf) drawLoop()
  tick()
}

function stopAll() {
  running.value = false
  clearTimeout(timer)
  timer = 0
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  if (stream) {
    stream.getTracks().forEach((t) => t.stop())
    stream = null
  }
  if (mediaEl) {
    try {
      mediaEl.pause()
      mediaEl.srcObject = null
      mediaEl.removeAttribute('src')
      mediaEl.load()
    } catch (e) {}
  }
  if (objUrl) {
    URL.revokeObjectURL(objUrl)
    objUrl = null
  }
  imgEl = null
  boxRef.value = null
  labelRef.value = ''
  faceSeen.value = false
  progress.value = 0
  playing.value = false
  props.engine.reset()
}

function ensureVideo() {
  if (mediaEl) return mediaEl
  const v = document.createElement('video')
  v.playsInline = true
  v.muted = true
  v.autoplay = true
  v.loop = false
  v.setAttribute('playsinline', '')
  holder.value.appendChild(v)
  mediaEl = v
  return v
}

/* ------------------------------------------------------------------ 输入源 */
function pick(kind) {
  if (kind === 'image') imgInput.value.click()
  else vidInput.value.click()
}

function setMode(key) {
  if (mode.value === key && running.value) return
  stopAll()
  mode.value = key
  hasMedia.value = false
  info.value = ''
  errMsg.value = ''
  if (key === 'image') {
    pick('image')
  } else if (key === 'video') {
    pick('video')
  } else if (key === 'camera') {
    startCamera()
  } else {
    startScreen()
  }
}

function onImageFile(e) {
  const f = e.target.files && e.target.files[0]
  e.target.value = ''
  if (!f) return
  mode.value = 'image'
  const url = URL.createObjectURL(f)
  loadImage(url, `${f.name}`, true)
}

function loadImage(url, name, revoke = false) {
  stopAll()
  errMsg.value = ''
  const im = new Image()
  im.onload = () => {
    imgEl = im
    hasMedia.value = true
    info.value = `${name} · ${im.naturalWidth}×${im.naturalHeight}`
    fitCanvas()
    start()
  }
  im.onerror = () => {
    errMsg.value = '图片加载失败'
  }
  im.src = url
  if (revoke) objUrl = url
}

function onVideoFile(e) {
  const f = e.target.files && e.target.files[0]
  e.target.value = ''
  if (!f) return
  mode.value = 'video'
  stopAll()
  const v = ensureVideo()
  objUrl = URL.createObjectURL(f)
  v.src = objUrl
  v.muted = true
  v.loop = true
  v.onloadedmetadata = () => {
    hasMedia.value = true
    duration.value = v.duration
    info.value = `${f.name} · ${v.videoWidth}×${v.videoHeight}`
    fitCanvas()
    v.play().then(() => {
      playing.value = true
      start()
    })
  }
}

async function startCamera() {
  errMsg.value = ''
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('当前环境不支持摄像头（需 https 或 localhost）')
    }
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false,
    })
    const v = ensureVideo()
    v.loop = false
    v.srcObject = stream
    await v.play()
    hasMedia.value = true
    info.value = `摄像头 ${v.videoWidth}×${v.videoHeight}`
    fitCanvas()
    start()
  } catch (err) {
    errMsg.value = '摄像头打开失败：' + (err.message || err.name)
    running.value = false
  }
}

async function startScreen() {
  errMsg.value = ''
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      throw new Error('当前浏览器不支持屏幕共享')
    }
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 15 },
      audio: false,
    })
    stream.getVideoTracks()[0].onended = () => stopAll()
    const v = ensureVideo()
    v.loop = false
    v.srcObject = stream
    await v.play()
    hasMedia.value = true
    info.value = `屏幕共享 ${v.videoWidth}×${v.videoHeight}`
    fitCanvas()
    start()
  } catch (err) {
    errMsg.value = '屏幕共享已取消或失败：' + (err.message || err.name)
    running.value = false
  }
}

function togglePlay() {
  if (!mediaEl) return
  if (mediaEl.paused) {
    mediaEl.play()
    playing.value = true
    if (!running.value) start()
  } else {
    mediaEl.pause()
    playing.value = false
  }
}

function seekVideo(e) {
  if (!mediaEl || !mediaEl.duration) return
  const rect = e.currentTarget.getBoundingClientRect()
  const r = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
  mediaEl.currentTime = r * mediaEl.duration
}

function fmt(s) {
  if (!isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const ss = Math.floor(s % 60)
  return `${m}:${String(ss).padStart(2, '0')}`
}

function onResize() {
  layoutDirty = true
}
window.addEventListener('resize', onResize)

watch(
  () => props.backend,
  (b) => props.engine.setBackend(b)
)

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  stopAll()
  if (mediaEl && mediaEl.parentElement) mediaEl.parentElement.removeChild(mediaEl)
})

defineExpose({
  loadSample(url, label) {
    mode.value = 'image'
    loadImage(url, label, false)
  },
})
</script>

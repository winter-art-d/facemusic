<template>
  <div class="player">
    <div class="player-in">
      <button class="play-btn" :disabled="!track" :title="playing ? '暂停' : '播放'" @click="$emit('toggle')">
        <svg v-if="!playing" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5.5v13l11-6.5z" />
        </svg>
        <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="5" width="4" height="14" rx="1.2" />
          <rect x="14" y="5" width="4" height="14" rx="1.2" />
        </svg>
      </button>

      <div class="p-info">
        <div class="p-title">{{ track ? track.title : '未选择歌曲' }}</div>
        <div class="p-sub">
          {{ track ? track.artist + ' · ' + (track.source === 'local' ? '本地曲库' : '在线试听') : '点击右侧推荐歌单开始播放' }}
        </div>
      </div>

      <div class="p-seek">
        <span class="p-time">{{ fmt(current) }}</span>
        <div class="p-track" @click="onSeek">
          <i :style="{ width: pct * 100 + '%' }"></i>
          <b :style="{ left: pct * 100 + '%' }" v-show="track"></b>
        </div>
        <span class="p-time">{{ fmt(duration) }}</span>
      </div>

      <span v-if="track && emotionCn" class="chip dot" :style="{ color: color, background: bg }">
        {{ emotionCn }}
      </span>
      <button class="btn btn-sm" :disabled="!track" @click="$emit('next')">下一首</button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { EMOTION_BY_KEY } from '../core/emotions.js'

const props = defineProps({
  track: { type: Object, default: null },
  playing: { type: Boolean, default: false },
  current: { type: Number, default: 0 },
  duration: { type: Number, default: 0 },
})
const emit = defineEmits(['toggle', 'seek', 'next'])

const pct = computed(() => {
  if (!props.duration) return 0
  return Math.min(1, props.current / props.duration)
})
const emotionCn = computed(() => (props.track ? (EMOTION_BY_KEY[props.track.emotion] || {}).cn : ''))
const color = computed(() => (props.track ? (EMOTION_BY_KEY[props.track.emotion] || {}).color : '#6B7A8F'))
const bg = computed(() => {
  const c = color.value
  return `rgba(${parseInt(c.slice(1, 3), 16)},${parseInt(c.slice(3, 5), 16)},${parseInt(c.slice(5, 7), 16)},0.1)`
})

function fmt(s) {
  if (!s || !isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const ss = Math.floor(s % 60)
  return `${m}:${String(ss).padStart(2, '0')}`
}

function onSeek(e) {
  const rect = e.currentTarget.getBoundingClientRect()
  const r = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
  emit('seek', r * (props.duration || 0))
}
</script>

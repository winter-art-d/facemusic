<template>
  <section class="card">
    <div class="card-hd">
      <h3><span class="idx">3</span>情绪化歌曲推荐</h3>
      <div class="hd-right">
        <span class="chip">{{ strategyName }}</span>
      </div>
    </div>

    <div class="card-bd">
      <div class="seg" style="width: 100%; justify-content: space-between">
        <button
          v-for="s in STRATEGIES"
          :key="s.key"
          :class="{ on: strategy === s.key }"
          style="flex: 1; justify-content: center"
          @click="$emit('set-strategy', s.key)"
        >
          {{ s.name }}
        </button>
      </div>

      <div v-if="!hasEmotion" class="note warn" style="margin: 10px 0 0">
        尚未识别到人脸，当前以中性情绪 U(0.00, 0.00) 给出候选。识别人脸后歌单会即时按情绪重排。
      </div>

      <div class="note" style="margin: 11px 0 12px">
        <b>{{ strategyName }}策略</b>：{{ strategyDesc }}<br />
        <span class="mono-sm">
          目标点 T = ({{ target.v.toFixed(2) }}, {{ target.a.toFixed(2) }}) · 目标速度
          {{ Math.round(60 + ((target.a + 1) / 2) * 110) }} BPM · 推荐
          {{ target.v >= 0 ? '大调' : '小调' }}曲目
        </span>
      </div>

      <div v-if="!list.length" class="empty">
        <div style="font-size: 26px; margin-bottom: 6px">🎧</div>
        {{ hasEmotion ? '正在计算推荐…' : '先采集一张人脸，或从 21 张情绪样张中选择一张' }}
      </div>

      <div v-else class="rec-list">
        <div
          v-for="(item, i) in list"
          :key="item.track.id"
          class="rec-item"
          :class="{ on: currentId === item.track.id }"
          @click="$emit('play', item.track)"
        >
          <span class="rec-rank">{{ String(i + 1).padStart(2, '0') }}</span>
          <div
            class="cover"
            :style="{ background: item.track.cover ? 'transparent' : grad(item.track) }"
          >
            <img v-if="item.track.cover" :src="item.track.cover" alt="" />
            <template v-else>{{ emojiOf(item.track.emotion) }}</template>
          </div>
          <div class="rec-main">
            <div class="rec-title">
              {{ item.track.title }}
              <span v-if="item.track.source === 'online'" class="tag">在线试听</span>
              <span v-else class="tag">本地</span>
            </div>
            <div class="rec-sub">
              {{ item.track.artist }} · {{ item.track.bpm }} BPM ·
              {{ (item.track.modeMeta || item.track.mode) === 'minor' ? '小调' : '大调' }} ·
              {{ emotionCn(item.track.emotion) }}
            </div>
            <div class="why">
              AV 距离 {{ item.parts.dAV.toFixed(2) }} · 速度差
              {{ item.parts.dTempo > 0 ? '+' : '' }}{{ item.parts.dTempo }} ·
              调式{{ item.parts.mode > 0.9 ? '匹配' : '偏离' }}
            </div>
          </div>
          <div class="match">
            <b>{{ item.match }}</b>
            <span>匹配度</span>
            <button
              class="btn btn-sm"
              style="margin-top: 3px; height: 20px; padding: 0 6px; font-size: 10px"
              title="不喜欢，换一批思路"
              @click.stop="$emit('dislike', item.track)"
            >
              换
            </button>
          </div>
        </div>
      </div>

      <div class="flex" style="margin-top: 11px; gap: 8px">
        <button class="btn btn-sm" @click="$emit('refresh')">重新推荐</button>
        <button class="btn btn-sm" @click="$emit('shuffle')">随机打散</button>
        <span class="spacer"></span>
        <span class="mono-sm">MMR λ=0.28 · 候选池 {{ poolSize }}</span>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { STRATEGIES } from '../core/recommender.js'
import { EMOTION_BY_KEY } from '../core/emotions.js'

const props = defineProps({
  list: { type: Array, default: () => [] },
  strategy: { type: String, default: 'resonate' },
  target: { type: Object, default: () => ({ v: 0, a: 0 }) },
  currentId: { type: String, default: '' },
  hasEmotion: { type: Boolean, default: true },
  poolSize: { type: Number, default: 0 },
})
defineEmits(['set-strategy', 'play', 'dislike', 'refresh', 'shuffle'])

const strategyName = computed(() => (STRATEGIES.find((s) => s.key === props.strategy) || {}).name || '')
const strategyDesc = computed(() => (STRATEGIES.find((s) => s.key === props.strategy) || {}).desc || '')

const EMO = { happy: '😄', sad: '😢', angry: '😠', fear: '😨', disgust: '😖', surprise: '😲', neutral: '😐' }

function emojiOf(k) {
  return EMO[k] || '🎵'
}
function emotionCn(k) {
  return (EMOTION_BY_KEY[k] || {}).cn || '未知'
}
function grad(t) {
  const c = (EMOTION_BY_KEY[t.emotion] || {}).color || '#6B7A8F'
  return `linear-gradient(140deg, ${c}, ${c}bb)`
}
</script>

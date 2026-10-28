<template>
  <section class="card">
    <div class="card-hd">
      <h3><span class="idx">2</span>人脸情绪识别结果</h3>
      <div class="hd-right">
        <span class="chip dot" :style="{ color: dominant.color }">{{ dominant.cn }} · {{ dominant.en }}</span>
      </div>
    </div>

    <div class="card-bd">
      <div class="emotion-hero fade-in">
        <div
          class="emo-face"
          :style="{
            background: hexA(dominant.color, 0.12),
            color: dominant.color,
            border: '1px solid ' + hexA(dominant.color, 0.28),
          }"
        >
          {{ dominant.emoji }}
        </div>
        <div style="min-width: 0">
          <div class="emo-name">{{ active ? dominant.cn : '等待识别' }}</div>
          <div v-if="active" class="emo-meta">
            <span>置信度 <b class="mono">{{ pct(confidence) }}</b></span>
            <span>稳定度 <b class="mono">{{ pct(stability) }}</b></span>
          </div>
          <div class="emo-meta">{{ active ? dominant.desc : '选择一种输入方式并让人脸进入画面，或从样张库挑一张' }}</div>
        </div>
      </div>

      <div class="bars">
        <div v-for="e in EMOTIONS" :key="e.key" class="bar-row">
          <span class="nm">{{ e.emoji }} {{ e.cn }}</span>
          <div class="bar-track">
            <i
              class="bar-fill"
              :style="{
                width: Math.max(0.6, (probs[e.key] || 0) * 100) + '%',
                background: e.key === dominant.key ? e.color : hexA(e.color, 0.45),
              }"
            ></i>
          </div>
          <span class="vv">{{ pct(probs[e.key] || 0) }}</span>
        </div>
      </div>

      <div class="va-wrap">
        <svg class="va-svg" viewBox="0 0 360 300" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="vaBg" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stop-color="#eef2fb" />
              <stop offset="100%" stop-color="#f7f9fd" />
            </linearGradient>
            <radialGradient id="userGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" :stop-color="dominant.color" stop-opacity="0.35" />
              <stop offset="100%" :stop-color="dominant.color" stop-opacity="0" />
            </radialGradient>
          </defs>

          <rect x="34" y="14" width="314" height="252" rx="10" fill="url(#vaBg)" stroke="#e5e9f2" />

          <!-- 象限分隔 -->
          <line x1="34" y1="140" x2="348" y2="140" stroke="#dfe5f0" stroke-dasharray="3 4" />
          <line x1="191" y1="14" x2="191" y2="266" stroke="#dfe5f0" stroke-dasharray="3 4" />

          <!-- 象限文字 -->
          <text x="42" y="30" class="qx">紧张·高唤醒</text>
          <text x="340" y="30" text-anchor="end" class="qx">兴奋·愉悦</text>
          <text x="42" y="258" class="qx">低落·疲惫</text>
          <text x="340" y="258" text-anchor="end" class="qx">平静·舒适</text>

          <!-- 情绪锚点 -->
          <g v-for="e in EMOTIONS" :key="'a' + e.key">
            <circle :cx="px(e.va[0])" :cy="py(e.va[1])" r="2.6" :fill="hexA(e.color, 0.55)" />
            <text
              :x="px(e.va[0]) + (e.va[0] > 0.1 ? 6 : -6)"
              :y="py(e.va[1]) + 3.5"
              :text-anchor="e.va[0] > 0.1 ? 'start' : 'end'"
              class="anchor"
              :fill="hexA(e.color, 0.85)"
            >
              {{ e.cn }}
            </text>
          </g>

          <!-- 目标点连线 -->
          <line
            :x1="px(va.v)"
            :y1="py(va.a)"
            :x2="px(target.v)"
            :y2="py(target.a)"
            stroke="#7c5cf0"
            stroke-width="1.4"
            stroke-dasharray="4 3"
            opacity="0.75"
          />
          <circle :cx="px(target.v)" :cy="py(target.a)" r="7" fill="none" stroke="#7c5cf0" stroke-width="1.6" />
          <circle :cx="px(target.v)" :cy="py(target.a)" r="2.4" fill="#7c5cf0" />
          <text :x="px(target.v) + 11" :y="py(target.a) - 8" class="lbl-target">推荐目标</text>

          <!-- 歌曲点 -->
          <g v-for="(p, i) in points" :key="'s' + i">
            <circle :cx="px(p.v)" :cy="py(p.a)" r="4.2" :fill="hexA(p.color, 0.85)" stroke="#fff" stroke-width="1.2" />
            <text :x="px(p.v) + 6" :y="py(p.a) - 6" class="lbl-song">{{ i + 1 }}</text>
          </g>

          <!-- 用户点 -->
          <template v-if="active">
          <circle :cx="px(va.v)" :cy="py(va.a)" r="22" fill="url(#userGlow)" />
          <circle :cx="px(va.v)" :cy="py(va.a)" r="8.5" :fill="dominant.color" stroke="#fff" stroke-width="2.4" />
          <circle :cx="px(va.v)" :cy="py(va.a)" r="13" fill="none" :stroke="hexA(dominant.color, 0.4)" stroke-width="1.2" />
          </template>

          <!-- 坐标轴 -->
          <text x="191" y="288" text-anchor="middle" class="ax">效价 Valence →（越正越愉悦）</text>
          <text x="14" y="140" text-anchor="middle" class="ax" transform="rotate(-90 14 140)">唤醒度 Arousal →</text>
          <text x="30" y="252" class="ax2">-1</text>
          <text x="330" y="295" text-anchor="end" class="ax2">+1</text>
        </svg>

        <div class="legend">
          <span><i :style="{ background: dominant.color }"></i>当前情绪 U({{ va.v.toFixed(2) }}, {{ va.a.toFixed(2) }})</span>
          <span><i style="background: #7c5cf0"></i>推荐目标 T({{ target.v.toFixed(2) }}, {{ target.a.toFixed(2) }})</span>
          <span><i style="background: #b9c2d4"></i>Top 推荐曲目</span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { EMOTIONS, EMOTION_BY_KEY } from '../core/emotions.js'

const props = defineProps({
  probs: { type: Object, default: () => ({}) },
  dominantKey: { type: String, default: 'neutral' },
  confidence: { type: Number, default: 0 },
  stability: { type: Number, default: 0 },
  va: { type: Object, default: () => ({ v: 0, a: 0 }) },
  active: { type: Boolean, default: false },
  target: { type: Object, default: () => ({ v: 0, a: 0 }) },
  points: { type: Array, default: () => [] },
})

const dominant = computed(() => EMOTION_BY_KEY[props.dominantKey] || EMOTION_BY_KEY.neutral)
const target = computed(() => props.target || { v: 0, a: 0 })

const PAD_L = 34
const PAD_T = 14
const PW = 314
const PH = 252
const px = (v) => PAD_L + ((Math.max(-1, Math.min(1, v)) + 1) / 2) * PW
const py = (a) => PAD_T + ((1 - Math.max(-1, Math.min(1, a))) / 2) * PH

function pct(x) {
  return Math.round((x || 0) * 100) + '%'
}

function hexA(hex, a) {
  const h = (hex || '#6B7A8F').replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r},${g},${b},${a})`
}
</script>

<style scoped>
.qx {
  font-size: 8.5px;
  fill: #a2abc0;
  font-family: var(--font);
}
.anchor {
  font-size: 8.5px;
  font-family: var(--font);
}
.ax {
  font-size: 9px;
  fill: #98a1b8;
  font-family: var(--font);
}
.ax2 {
  font-size: 8px;
  fill: #b6bdcd;
  font-family: var(--mono);
}
.lbl-song {
  font-size: 7.5px;
  fill: #8e97ad;
  font-family: var(--mono);
}
.lbl-target {
  font-size: 8.5px;
  fill: #7c5cf0;
  font-family: var(--font);
  font-weight: 600;
}
</style>

<template>
  <div v-if="open" class="modal-mask" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-hd">
        <h3 style="font-size: 15px">情绪样张库 · 7 种情绪 × 3 张</h3>
        <span class="chip">点击任意一张即可直接识别</span>
        <div class="spacer"></div>
        <button class="btn btn-sm" @click="$emit('close')">关闭</button>
      </div>
      <div class="modal-bd">
        <div v-for="g in SAMPLE_EMOTIONS" :key="g.key" class="face-group">
          <div class="face-group-hd">
            <span class="chip dot" :style="{ color: colorOf(g.key) }">{{ g.label }}</span>
            <span class="mono-sm">锚点 AV = ({{ vaOf(g.key)[0] }}, {{ vaOf(g.key)[1] }})</span>
          </div>
          <div class="face-row">
            <div
              v-for="i in 3"
              :key="i"
              class="face-card"
              @click="pick(g.key, i)"
              :title="`${g.label} 样张 ${i}`"
            >
              <img :src="faceUrl(g.key, i)" :alt="`${g.label} ${i}`" loading="lazy" />
              <span>{{ g.key }}-{{ i }}</span>
            </div>
          </div>
        </div>
        <p class="mono-sm" style="margin-top: 4px">
          样张由图像生成模型合成，仅用于算法演示；由于模型在 FER2013 类数据上训练，夸张的表情更容易被稳定识别。
        </p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { SAMPLE_EMOTIONS, EMOTION_BY_KEY } from '../core/emotions.js'
import { asset } from '../core/base.js'

defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['close', 'pick'])

const colorOf = (k) => (EMOTION_BY_KEY[k] || {}).color || '#6B7A8F'
const vaOf = (k) => (EMOTION_BY_KEY[k] || { va: [0, 0] }).va
const faceUrl = (k, i) => asset(`faces/${k}-${i}.jpg`)

function pick(key, i) {
  emit('pick', { url: faceUrl(key, i), label: `${key}-${i}.jpg`, emotion: key })
  emit('close')
}
</script>

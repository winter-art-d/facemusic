<template>
  <section class="card">
    <div class="card-hd">
      <h3><span class="idx">4</span>曲库 · 情绪指纹</h3>
      <div class="hd-right">
        <div class="seg">
          <button :class="{ on: tab === 'local' }" @click="tab = 'local'">本地 {{ tracks.length }}</button>
          <button :class="{ on: tab === 'online' }" @click="tab = 'online'">在线 {{ onlineTracks.length }}</button>
        </div>
      </div>
    </div>

    <!-- ---------------- 本地曲库 ---------------- -->
    <template v-if="tab === 'local'">
      <div class="stage-bar" style="border-top: none; border-bottom: 1px solid var(--line-2)">
        <button class="btn btn-primary btn-sm" :disabled="analyzing || !tracks.length" @click="$emit('analyze')">
          <span v-if="analyzing" class="spin"></span>
          {{ analyzing ? `分析中 ${analyzedCount}/${tracks.length}` : analyzedCount === tracks.length && analyzedCount > 0 ? '重新分析' : '开始声学分析' }}
        </button>
        <span class="mono-sm">
          {{
            analyzedCount === tracks.length && analyzedCount > 0
              ? '全部曲目已完成实测（Web Audio 解码 + FFT 特征提取）'
              : '在浏览器内解码每首歌的前 30 秒，提取 BPM / 调式 / 频谱特征'
          }}
        </span>
      </div>
      <div v-if="analyzing" style="padding: 0 16px">
        <div class="progress" style="margin: 10px 0">
          <i :style="{ width: (analyzedCount / Math.max(1, tracks.length)) * 100 + '%' }"></i>
        </div>
      </div>

      <div class="table-wrap">
        <table class="lib">
          <thead>
            <tr>
              <th style="width: 26px">#</th>
              <th>曲目</th>
              <th>标注情绪</th>
              <th>实测 BPM</th>
              <th>调式</th>
              <th>质心 Hz</th>
              <th title="纯声学实测的效价/唤醒度（未融合标注先验），可与左侧标注情绪对照">实测 V / A</th>
              <th>能量包络</th>
              <th style="width: 44px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(t, i) in tracks" :key="t.id">
              <td class="mono-sm">{{ String(i + 1).padStart(2, '0') }}</td>
              <td class="tt">
                {{ t.title }}
                <div class="mono-sm" style="font-size: 10.5px">
                  {{ t.artist }} · {{ t.duration }}s ·
                  <span :style="{ color: t.analyzed ? 'var(--ok)' : 'var(--ink-3)' }">
                    {{ t.analyzed ? '实测' : '标注' }}
                  </span>
                </div>
              </td>
              <td>
                <span
                  class="chip dot"
                  :style="{ color: colorOf(t.emotion), background: bgOf(t.emotion) }"
                >
                  {{ cnOf(t.emotion) }}
                </span>
              </td>
              <td class="mono-sm">
                {{ t.bpm }}
                <span
                  v-if="t.bpmCorrected"
                  title="与标注速度成倍频关系，已按节拍层级校正"
                  style="color: var(--warn)"
                  >⤾</span
                >
              </td>
              <td class="mono-sm">
                {{ t.key }}
                <span style="color: var(--ink-3)">{{ t.mode === 'minor' ? 'm' : 'M' }}</span>
              </td>
              <td class="mono-sm">{{ Math.round(t.centroid || 0) }}</td>
              <td class="mono-sm" style="font-size: 11px">
                <span v-if="t.vaMeasured">
                  {{ t.vaMeasured.v.toFixed(2) }} / {{ t.vaMeasured.a.toFixed(2) }}
                </span>
                <span v-else style="color: var(--ink-3)">—</span>
              </td>
              <td>
                <div class="mini-spark">
                  <i
                    v-for="(p, k) in (t.series || []).slice(0, 26)"
                    :key="k"
                    :style="{ height: 2 + p.e * 15 + 'px', background: sparkColor(t.emotion) }"
                  ></i>
                </div>
              </td>
              <td>
                <button class="btn btn-sm" style="height: 22px; padding: 0 7px" @click="$emit('play', t)">
                  ▶
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="card-bd" style="padding-top: 10px; font-size: 11.5px; color: var(--ink-3)">
        本地曲目共 {{ tracks.length }} 首 / {{ totalSize }}，全部由程序化合成器生成（无版权风险），覆盖 7 种情绪各 2 首。
      </div>
    </template>

    <!-- ---------------- 在线曲库 ---------------- -->
    <template v-else>
      <div class="stage-bar" style="border-top: none; border-bottom: 1px solid var(--line-2)">
        <input
          v-model="q"
          placeholder="搜索在线歌曲（iTunes Search API）"
          style="
            flex: 1;
            min-width: 140px;
            height: 30px;
            border: 1px solid var(--line);
            border-radius: 8px;
            padding: 0 10px;
            outline: none;
            color: var(--ink);
          "
          @keyup.enter="doSearch"
        />
        <button class="btn btn-primary btn-sm" :disabled="onlineLoading" @click="doSearch">
          <span v-if="onlineLoading" class="spin"></span> 搜索
        </button>
      </div>

      <div class="card-bd" style="padding: 10px 14px 0">
        <div class="flex flex-wrap" style="gap: 6px">
          <button
            v-for="e in EMOTIONS"
            :key="e.key"
            class="chip"
            style="cursor: pointer"
            @click="quick(e)"
          >
            {{ e.emoji }} {{ e.cn }}
          </button>
        </div>
        <p class="mono-sm" style="margin-top: 8px">
          在线曲目为 30 秒试听片段，特征由「流派先验 + 关键词」估算；点任意曲目可边听边看推荐依据。
        </p>
        <p v-if="onlineError" style="color: var(--danger); font-size: 12px; margin-top: 6px">
          ⚠ {{ onlineError }}
        </p>
      </div>

      <div class="card-bd" style="padding-top: 6px; max-height: 360px; overflow: auto">
        <div v-if="!onlineTracks.length && !onlineLoading" class="empty">
          输入关键词或点上方情绪标签，从在线接口获取候选歌曲
        </div>
        <div v-if="onlineLoading && !onlineTracks.length" class="empty">
          <span class="spin"></span> 正在请求在线接口…
        </div>
        <div class="rec-list">
          <div
            v-for="t in onlineTracks"
            :key="t.id"
            class="rec-item"
            :class="{ on: currentId === t.id }"
            @click="$emit('play', t)"
          >
            <div class="cover" :style="{ background: 'transparent' }">
              <img v-if="t.cover" :src="t.cover" alt="" />
              <template v-else>🎵</template>
            </div>
            <div class="rec-main">
              <div class="rec-title">{{ t.title }}</div>
              <div class="rec-sub">{{ t.artist }} · {{ t.genre }} · 估算 {{ t.bpm }} BPM</div>
            </div>
            <a
              v-if="t.storeUrl"
              class="tag"
              :href="t.storeUrl"
              target="_blank"
              rel="noreferrer"
              @click.stop
              style="text-decoration: none"
              >商店</a
            >
            <span class="chip dot" :style="{ color: colorOf(t.emotion), background: bgOf(t.emotion) }">
              {{ cnOf(t.emotion) }}
            </span>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup>
import { ref, computed } from 'vue'
import { EMOTIONS, EMOTION_BY_KEY } from '../core/emotions.js'

const props = defineProps({
  tracks: { type: Array, default: () => [] },
  analyzedCount: { type: Number, default: 0 },
  analyzing: { type: Boolean, default: false },
  onlineTracks: { type: Array, default: () => [] },
  onlineLoading: { type: Boolean, default: false },
  onlineError: { type: String, default: '' },
  currentId: { type: String, default: '' },
})
const emit = defineEmits(['play', 'analyze', 'search-online'])

const tab = ref('local')
const q = ref('')

const totalSize = computed(() => {
  const kb = props.tracks.reduce((a, t) => a + (t.sizeKB || 0), 0)
  return kb > 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB'
})

function doSearch() {
  const term = q.value.trim() || 'happy upbeat pop'
  emit('search-online', term)
}

function quick(e) {
  q.value = e.query
  emit('search-online', e.query, e.key)
}

const colorOf = (k) => (EMOTION_BY_KEY[k] || {}).color || '#6B7A8F'
const cnOf = (k) => (EMOTION_BY_KEY[k] || {}).cn || '未知'
function bgOf(k) {
  const c = colorOf(k)
  return (
    'rgba(' +
    parseInt(c.slice(1, 3), 16) +
    ',' +
    parseInt(c.slice(3, 5), 16) +
    ',' +
    parseInt(c.slice(5, 7), 16) +
    ',0.1)'
  )
}
const sparkColor = (k) => colorOf(k) + '99'
</script>

/**
 * 人脸情绪识别引擎（本地推理，零网络依赖）
 * ============================================================================
 * 算法链路： 帧预处理 → 单阶段人脸检测 → 人脸框回归/裁剪 → 表情 CNN 分类 → 时序平滑
 *
 * 1) 人脸检测：TinyFaceDetector（基于 MobileNetV1 的深度可分离卷积 + SSD 单阶段检测头）
 *    - 参数量 ~0.19M，权重仅 190KB，单帧 5~12ms（JS/WebGL 后端）
 *    - 输入正方形 inputSize（160/224/320 三档），anchor 网格 + 边界框回归 + NMS
 *    → 经典高效的 SSD 系列目标检测器，适合实时场景
 *
 * 2) 表情分类：FaceExpressionNet
 *    - 输入 48×48 灰度人脸（对齐 FER2013 数据集预处理方式）
 *    - 4 组 3×3 卷积（32→32→64→64→128→128）+ MaxPool，全连接 7 维 + Softmax
 *    - 输出 7 类：neutral / happy / sad / angry / fearful / disgusted / surprised
 *    - 在 FER2013 + Kaggle FER 上训练，属于经典的"小 CNN 端到端表情分类"范式
 *
 * 3) 时序平滑：指数移动平均（EMA）
 *    p̂_t = α · p_t + (1-α) · p̂_{t-1}
 *    等价于一阶低通滤波，抑制单帧抖动；α 越大响应越快、越小越稳
 *
 * 4) 跳帧策略：检测间隔 interval 毫秒（默认 110ms ≈ 9Hz），
 *    绘制仍然每帧进行，保证画面流畅而推理负载可控。
 */
import * as faceapi from '@vladmandic/face-api'
import { EMOTIONS, emptyProbs, summarizeProbs, probsToVA } from './emotions.js'
import { asset } from './base.js'

// 权重位于 public/models/，用 asset() 适配 GitHub Pages 子路径
const MODEL_URL = asset('models')

export const BACKENDS = [
  {
    key: 'fast',
    name: '极速',
    detail: 'TinyFaceDetector · 160px',
    interval: 90,
    hint: '≈15 FPS 推理，适合摄像头实时',
  },
  {
    key: 'balanced',
    name: '均衡',
    detail: 'TinyFaceDetector · 224px',
    interval: 130,
    hint: '推荐档位，精度与速度平衡',
  },
  {
    key: 'accurate',
    name: '高精度',
    detail: 'SSD MobileNetV1 · 512px',
    interval: 260,
    hint: '检测更稳，速度较慢（5.6MB 权重）',
  },
]

export class FaceEngine {
  constructor() {
    this.ready = false
    this.loading = false
    this.backend = 'balanced'
    this.smooth = null
    this.alpha = 0.38
    this.lastMs = 0
    this.ssdLoaded = false
    this.tinyOpts = null
    this.ssdOpts = null
    this.frames = 0
    this.hitFrames = 0
    this._buildOptions()
  }

  _buildOptions() {
    this.tinyOpts = {
      fast: new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.42 }),
      balanced: new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.45 }),
    }
    this.ssdOpts = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4, maxResults: 8 })
  }

  get interval() {
    return (BACKENDS.find((b) => b.key === this.backend) || BACKENDS[1]).interval
  }

  async load(onStep) {
    if (this.ready || this.loading) return
    this.loading = true
    onStep && onStep('加载 TinyFaceDetector 检测器…')
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL)
    onStep && onStep('加载表情分类网络…')
    await faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL)
    this.ready = true
    this.loading = false
    onStep && onStep('模型就绪')
  }

  async _ensureSSD() {
    if (this.ssdLoaded) return
    await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL)
    this.ssdLoaded = true
  }

  setBackend(key) {
    this.backend = key
    this.smooth = null
  }

  setAlpha(a) {
    this.alpha = a
  }

  reset() {
    this.smooth = null
    this.frames = 0
    this.hitFrames = 0
    this.lastMs = 0
  }

  /**
   * 对一帧画面执行 "检测 + 表情分类"
   * @param {HTMLVideoElement|HTMLImageElement|HTMLCanvasElement} source
   * @returns {Promise<null|{probs, dominant, confidence, stability, box, ms, va}>}
   */
  async detect(source) {
    if (!this.ready) return null
    const w = source.videoWidth || source.naturalWidth || source.width
    const h = source.videoHeight || source.naturalHeight || source.height
    if (!w || !h) return null

    const t0 = performance.now()
    let result = null
    try {
      if (this.backend === 'accurate') {
        await this._ensureSSD()
        result = await faceapi
          .detectSingleFace(source, this.ssdOpts)
          .withFaceExpressions()
      } else {
        result = await faceapi
          .detectSingleFace(source, this.tinyOpts[this.backend] || this.tinyOpts.balanced)
          .withFaceExpressions()
      }
    } catch (e) {
      console.warn('[FaceEngine] 推理异常', e)
      return null
    }
    this.lastMs = performance.now() - t0
    this.frames++
    if (!result || !result.expressions) {
      // 丢失人脸：对平滑结果做衰减，避免 UI 瞬间归零
      if (this.smooth) {
        for (const k of Object.keys(this.smooth)) this.smooth[k] *= 0.85
      }
      return null
    }
    this.hitFrames++

    const raw = emptyProbs()
    for (const e of EMOTIONS) {
      raw[e.key] = result.expressions[e.faceApi] || 0
    }
    const probs = this._ema(raw)
    const sum = summarizeProbs(probs)
    const va = probsToVA(probs)

    const box = result.detection ? result.detection.box : result.box
    return {
      probs,
      dominant: sum.emotion,
      confidence: sum.confidence,
      stability: sum.stability,
      va,
      box: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null,
      score: result.detection ? result.detection.score : 1,
      ms: this.lastMs,
      srcW: w,
      srcH: h,
    }
  }

  _ema(raw) {
    if (!this.smooth) {
      this.smooth = { ...raw }
    } else {
      const a = this.alpha
      for (const k of Object.keys(raw)) {
        this.smooth[k] = a * raw[k] + (1 - a) * (this.smooth[k] || 0)
      }
    }
    let s = 0
    for (const k of Object.keys(this.smooth)) s += this.smooth[k]
    const out = {}
    for (const k of Object.keys(this.smooth)) {
      out[k] = s > 1e-6 ? this.smooth[k] / s : 1 / EMOTIONS.length
    }
    return out
  }
}

export const faceEngine = new FaceEngine()

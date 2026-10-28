# MoodTune · 基于人脸情绪识别的歌曲推荐系统

纯前端实现（HTML5 / CSS3 / JavaScript / **Vue 3** + Vite），人脸检测、表情识别、音乐情绪分析
全部在浏览器本地运行，画面与音频不上传任何服务器。

```
四种画面输入 ──► 本地人脸情绪识别 ──► 情绪向量 U(v, a)
                                          │
本地 14 首曲库 ──► 歌曲情绪指纹 S(v, a) ──┼──► AV 空间加权相似度 + MMR 重排 ──► 歌单
在线 iTunes 试听 ──► 流派先验估算 S      ──┘
```

## 快速开始

```bash
cd emotion-music
npm install
npm run dev          # http://127.0.0.1:5273
```

打包预览：

```bash
npm run build
npm run preview      # http://127.0.0.1:4173
```

> 摄像头与屏幕共享必须运行在 `localhost` 或 `https` 下，`file://` 直接打开会被浏览器禁用。

## 四种画面输入

| 方式 | 操作 | 说明 |
| --- | --- | --- |
| 🖼 图片 | 上传本地照片 / 从 21 张内置情绪样张选择 | 静态图 3~5 帧 EMA 即可收敛 |
| 🎬 视频 | 打开本地 mp4/webm，逐帧识别 | 支持暂停观察单帧、进度跳转 |
| 📷 摄像头 | 授权后开启 1280×720 实时流 | 实时推荐、现场演示 |
| 🖥 屏幕共享 | 选择整个屏幕 / 窗口 / 标签页 | 可识别会议画面、播放器中的他人视频 |

## 三个算法

### 1. 人脸情绪识别（本地推理）

```
帧 → TinyFaceDetector(SSD + MobileNetV1, 190KB) → 人脸框
   → 裁剪 48×48 灰度 → FaceExpressionNet(小 CNN, 330KB) → 7 类 softmax
   → EMA 一阶低通平滑 → 概率加权质心 → 连续情绪坐标 U(v, a)
```

- 检测器参数 0.19 M，单帧约 10~20 ms（JS + WebGL 后端），三档可选：极速 160px / 均衡 224px / 高精度 SSD 512px
- 平滑：`p̂_t = α·p_t + (1−α)·p̂_{t−1}`，α 可在界面 0.15~0.75 调节
- 稳定度用归一化熵 `1 − H(p̂)/ln7` 衡量，避免"犹豫"时误驱动推荐

### 2. 歌曲情绪识别（MER）

```
decodeAudioData(22.05kHz 单声道) → 1024 点 FFT / 512 跳 / Hann 窗
  → 6 维特征：RMS、频谱质心、85% 滚降、谱通量、过零率、色度
  → 起音包络自相关 + 谐波和打分 → BPM
  → Krumhansl-Schmuckler 调性轮廓相关 → 大/小调
  → Arousal / Valence 回归 → 情绪坐标 S
```

- BPM：`S(τ) = R(τ) + 0.45·R(2τ)/2 + 0.45·R(3τ)/3`，再按分数比（2×、1.5×、0.6× …）做节拍层级消歧
- 色度只取 110~2500 Hz 并做 `|X|^0.6` 压缩，避免底鼓低频污染调性
- **标定结果**（本地 14 首"已知标注"曲目）：BPM ±7% 内 **13/14**，调式一致 **10/14**
- 曲目最终情绪坐标 = `0.45 × 声学实测 + 0.55 × 标注先验`（hybrid 做法，UI 中同时展示纯声学 V/A）

### 3. 推荐算法

```
目标点 T：共鸣 T=U ｜ 疗愈 T=0.62U+0.38H ｜ 点燃 T=(0.4Uv+0.35, max(Ua,0.3)+0.15)
score  = 0.50·S_av + 0.18·S_tempo + 0.12·S_mode + 0.12·S_timbre + 0.08·S_quality
重排   ：MMR  argmax[score_i − λ·max sim(i,j)]，λ = 0.28
反馈   ：点"换" → T ← T − 0.12·(S_track − T)
```

排名卡片会展示 AV 距离、速度差、调式是否匹配，每个分数都可解释。

## 曲库

- **本地曲库 14 首**（`public/audio/`，约 7 MB）：用 numpy 合成器程序化生成的器乐片段，
  7 种情绪各 2 首，无版权风险；每首 25~41 秒，128 kbps MP3。
- **在线接口**：iTunes Search API（免费、无需 Key、JSONP 跨域），返回 30 秒试听，
  特征由「流派先验 + 情绪关键词」估算，UI 标注为"估算"。
- **情绪样张 21 张**（`public/faces/`）：7 种情绪 × 3 张，由图像生成模型合成后自动裁切。

## 目录结构

```
emotion-music/
├─ public/
│  ├─ models/          face-api 权重（TinyFaceDetector / FaceExpressionNet / SSD MobileNetV1）
│  ├─ faces/           21 张情绪样张
│  └─ audio/           14 首本地曲目 + tracks.json
├─ src/
│  ├─ core/
│  │  ├─ faceEngine.js      人脸检测 + 表情分类 + EMA 平滑
│  │  ├─ musicAnalyzer.js   自研 FFT + 6 维特征 + BPM + 调式 + AV 映射
│  │  ├─ recommender.js     目标点 / 加权相似度 / MMR / 负反馈
│  │  ├─ onlineApi.js       iTunes Search API（JSONP）+ 流派先验
│  │  └─ emotions.js        7 类情绪定义与 Thayer AV 锚点
│  ├─ components/      SourceStage / EmotionPanel / RecommendPanel / LibraryPanel / PlayerBar / DocsPanel / SampleGallery
│  ├─ App.vue
│  └─ styles.css
└─ tools/              生成与验证脚本（音频合成、样张裁切、标定、端到端自检）
```

## 自检脚本

```bash
# 重新生成曲库（需要 numpy / lameenc）
python tools/gen_music.py

# 声学特征标定：BPM / 调式 / 情绪映射权重（需要 numpy）
python tools/calib2.py

# JS 与 Python 的 DSP 数值对齐验证
node tools/parity.mjs

# 端到端自检：CDP 驱动本机 Chrome，截图 + 检查识别与推荐
node tools/cdp_test.mjs
```

## 说明

- 人脸模型来自 `@vladmandic/face-api`（MIT），权重已本地化到 `public/models/`，运行时不访问 CDN。
- 表情分类基于 FER2013 类数据训练，对夸张、正脸、光线均匀的表情最稳定；侧脸与遮挡会显著降低置信度。
- BPM 存在固有的八度歧义（1 拍 / 2 拍），系统用标注速度做节拍层级消歧并在表格中以 ⤾ 标注。

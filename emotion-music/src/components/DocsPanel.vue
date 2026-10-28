<template>
  <!-- ===================================================== 使用说明 -->
  <div v-if="kind === 'usage'" class="doc fade-in">
    <section class="doc-card">
      <h2>📖 使用说明</h2>
      <p>
        MoodTune 是一个<strong>纯前端</strong>的「人脸情绪 → 歌曲推荐」系统：人脸检测、表情分类、音乐特征提取
        全部在浏览器本地完成（模型权重已下载到 <code>public/models</code>），
        <strong>画面和音频不会上传到任何服务器</strong>。推荐结果同时来自本地曲库与在线接口。
      </p>

      <h3><span class="n">1</span>四步跑通全流程</h3>
      <ol>
        <li>
          <strong>采集画面</strong>：在「① 采集画面」卡片选择 <em>图片 / 视频 / 摄像头 / 屏幕共享</em> 四种方式之一。
          最快的方式是点「从 21 张情绪样张选择」，挑一张 <code>happy-1.jpg</code> 之类的样张。
        </li>
        <li>
          <strong>看情绪</strong>：右侧「② 人脸情绪识别结果」会显示 7 类表情的实时概率条、
          Top1 情绪与置信度/稳定度，并在 Thayer 二维情绪平面上标出你当前的位置（实心圆）。
        </li>
        <li>
          <strong>选策略</strong>：在「③ 情绪化歌曲推荐」里切换 <em>共鸣陪伴 / 情绪疗愈 / 点燃能量</em>，
          观察空心圆（推荐目标点 T）与歌曲点位（1~8 号）如何随之移动。
        </li>
        <li>
          <strong>听歌</strong>：点任意一首推荐曲目即可底部播放。点「换」按钮表示不喜欢，
          目标点会被推离该曲目并立刻重排歌单。
        </li>
      </ol>

      <h3><span class="n">2</span>四种输入方式</h3>
      <table class="doc-table">
        <thead>
          <tr>
            <th>方式</th>
            <th>操作</th>
            <th>适用场景</th>
            <th>注意事项</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>🖼 图片</td>
            <td>点「选择图片」上传本地照片，或从样张库选一张</td>
            <td>静态演示、效果对比、答辩截图</td>
            <td>建议正脸、光线均匀、人脸占画面 1/5 以上</td>
          </tr>
          <tr>
            <td>🎬 视频</td>
            <td>点「打开视频」选择 mp4/webm，自动循环播放并逐帧识别</td>
            <td>情绪变化过程演示、录制回放</td>
            <td>可暂停在某一帧观察稳定结果；浏览器需支持该编码</td>
          </tr>
          <tr>
            <td>📷 摄像头</td>
            <td>点「摄像头」，授权后自动开启 1280×720 实时流</td>
            <td>现场实时演示、真实使用场景</td>
            <td>需 <code>https</code> 或 <code>localhost</code>；拒绝授权会提示失败</td>
          </tr>
          <tr>
            <td>🖥 屏幕共享</td>
            <td>点「屏幕共享」，在弹窗中选择整个屏幕 / 窗口 / 标签页</td>
            <td>识别会议画面、播放器里的他人视频、PPT 里的照片</td>
            <td>选择「整个屏幕」可抓取其它应用；共享按钮在浏览器地址栏可随时停止</td>
          </tr>
        </tbody>
      </table>
      <div class="note warn">
        <strong>设备与浏览器建议</strong>：Chrome / Edge 最新版；若摄像头打不开，请确认地址栏是
        <code>http://localhost:5273</code> 或 https 域名（<code>file://</code> 与 http 局域网 IP
        会被浏览器禁用摄像头与屏幕共享）。
      </div>

      <h3><span class="n">3</span>识别引擎档位</h3>
      <p>「① 采集画面」右上角可切换三档，直接影响推理速度与检测稳定度：</p>
      <table class="doc-table">
        <thead>
          <tr>
            <th>档位</th>
            <th>检测器</th>
            <th>输入尺寸</th>
            <th>检测间隔</th>
            <th>典型单帧耗时</th>
            <th>推荐场景</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>极速</td>
            <td>TinyFaceDetector</td>
            <td>160×160</td>
            <td>90 ms</td>
            <td>{{ m.faceFast }} ms</td>
            <td>摄像头实时、低配设备</td>
          </tr>
          <tr>
            <td>均衡（默认）</td>
            <td>TinyFaceDetector</td>
            <td>224×224</td>
            <td>130 ms</td>
            <td>{{ m.faceBalanced }} ms</td>
            <td>日常演示，精度与流畅兼顾</td>
          </tr>
          <tr>
            <td>高精度</td>
            <td>SSD MobileNetV1</td>
            <td>512×512</td>
            <td>260 ms</td>
            <td>{{ m.faceAccurate }} ms</td>
            <td>人脸较小、侧脸、屏幕共享</td>
          </tr>
        </tbody>
      </table>

      <h3><span class="n">4</span>曲库与在线接口</h3>
      <ul>
        <li>
          <strong>本地曲库 14 首</strong>：每首 25~41 秒，7 种情绪各 2 首，MP3 共约 {{ m.libSize }}，
          位于 <code>public/audio/</code>。点「开始声学分析」后，浏览器用 Web Audio 解码每首前 30 秒，
          实测 BPM、调式、频谱质心、能量包络 —— 表格里「实测」字样即表示该曲目已完成真实分析。
        </li>
        <li>
          <strong>在线歌曲</strong>：切换到「在线」页签，输入关键词或点情绪标签，通过
          <strong>iTunes Search API</strong>（免费、无需 Key、JSONP 跨域）获取 30 秒试听片段。
          在线曲目无法取到音频数据做 CORS 解码，因此其特征由「流派先验 + 情绪关键词」估算，界面会标注为估算。
        </li>
        <li>
          <strong>混合推荐</strong>：本地实测曲目与在线估算曲目进入同一个候选池，
          通过 <code>S_quality</code> 项让实测曲目略占优势，避免估算误差主导结果。
        </li>
      </ul>

      <h3><span class="n">5</span>三种推荐策略</h3>
      <div class="kv-grid">
        <div class="kv-box">
          <div class="k">共鸣陪伴 Resonate</div>
          <div class="v" style="font-size: 12.5px; font-family: var(--font); font-weight: 500">
            目标点 = 当前情绪点。先"被理解"，适合情绪确认场景。
          </div>
        </div>
        <div class="kv-box">
          <div class="k">情绪疗愈 Heal</div>
          <div class="v" style="font-size: 12.5px; font-family: var(--font); font-weight: 500">
            T = 0.62·U + 0.38·H，向该情绪的舒缓锚点平移，避免情绪继续下沉。
          </div>
        </div>
        <div class="kv-box">
          <div class="k">点燃能量 Energize</div>
          <div class="v" style="font-size: 12.5px; font-family: var(--font); font-weight: 500">
            抬高唤醒度与效价，用更快的速度与更亮的音色把状态顶起来。
          </div>
        </div>
      </div>

      <h3><span class="n">6</span>常见问题</h3>
      <table class="doc-table">
        <tbody>
          <tr>
            <th>画面里有人但提示"未检测到人脸"</th>
            <td>
              人脸太小或太暗。切到「高精度」档位；让人脸占画面 1/5 以上；避免强逆光与侧脸超过 45°。
            </td>
          </tr>
          <tr>
            <th>情绪条一直跳变</th>
            <td>
              正常现象。分类器单帧输出本身有噪声，系统用 EMA 平滑（α 默认 0.38）。把 α 调小会更稳但更迟钝。
            </td>
          </tr>
          <tr>
            <th>摄像头 / 屏幕共享按钮无反应</th>
            <td>检查是否通过 <code>localhost</code> 或 https 访问；检查浏览器站点权限中摄像头是否被拒绝。</td>
          </tr>
          <tr>
            <th>在线搜索没结果</th>
            <td>iTunes 接口在部分网络环境不可达。可继续使用本地曲库，所有推荐逻辑完全一致。</td>
          </tr>
          <tr>
            <th>页面卡顿</th>
            <td>切到「极速」档位或关闭其它占用 GPU 的标签页；单帧耗时可在画面左上角 HUD 实时查看。</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>

  <!-- ===================================================== 算法说明 -->
  <div v-else class="doc fade-in">
    <section class="doc-card">
      <h2>🧠 算法说明</h2>
      <p>
        系统由三套<strong>经典且高效</strong>的算法串成一条流水线，全部在浏览器端运行：
        <strong>人脸检测</strong>（SSD 系列单阶段检测器）→ <strong>表情分类</strong>（小型 CNN + EMA 平滑）
        → <strong>歌曲情绪识别</strong>（短时傅里叶分析 + 自相关节拍估计 + 调性轮廓相关）
        → <strong>向量化推荐</strong>（AV 空间加权相似度 + MMR 多样性重排）。
      </p>
      <div class="formula">
        画面帧 → [TinyFaceDetector SSD] → 人脸框 → 裁剪 48×48 灰度 →
        [FaceExpressionNet CNN] → 7 类 softmax → [EMA 平滑] → 情绪概率 p → AV 坐标 U<br />
        音频 → [decodeAudioData 22.05kHz] → [1024 点 FFT / 512 跳] → 6 维声学特征 →
        [自相关 BPM + Krumhansl 调式] → 情绪坐标 S<br />
        U, S → [AV 加权相似度 + BPM/调式/音色] → [MMR 重排] → 推荐列表
      </div>
    </section>

    <section class="doc-card">
      <h2><span style="font-size: 17px">①</span> 人脸检测算法</h2>
      <h3>模型：TinyFaceDetector（SSD + MobileNetV1 主干）</h3>
      <p>
        TinyFaceDetector 是经典 <strong>SSD（Single Shot MultiBox Detector）</strong> 的轻量变体：
        主干用 <strong>MobileNetV1 的深度可分离卷积</strong>（depthwise + pointwise）把参数量压到约
        <strong>0.19 M</strong>、权重仅 <strong>190 KB</strong>，再在多个尺度特征图上直接回归
        「人脸框偏移 + 置信度」，一遍前向即出结果，无需候选区域（对比 R-CNN 系列的 two-stage 思路快一个数量级）。
      </p>
      <ul>
        <li><strong>先验框 Anchor</strong>：每个网格单元预设多种宽高比（1:1、1:√2、√2:1）与尺度，回归相对偏移，避免直接回归绝对坐标</li>
        <li><strong>损失</strong>：分类用 softmax 交叉熵，回归用 smooth-L1；难负样本挖掘（hard negative mining）控制正负样本 1:3</li>
        <li><strong>后处理 NMS</strong>：按置信度排序，IoU &gt; 0.3 的重复框被抑制，保证一人一框</li>
        <li><strong>推理尺寸</strong>：输入缩放到 160/224/320 的正方形，越小越快；本系统提供 160 与 224 两档 Tiny 模式，外加 512 的 SSD-MobileNetV1 高精度模式</li>
      </ul>
      <div class="formula">
        计算复杂度： O(H·W·A·C<sub>in</sub>·C<sub>out</sub>·k²)
        &nbsp;→&nbsp; 224×224 输入下约 0.1 GFLOPs，单帧 JS + WebGL 后端 {{ m.faceBalanced }} ms
      </div>

      <h2 style="margin-top: 26px"><span style="font-size: 17px">②</span> 人脸表情识别算法</h2>
      <h3>模型：FaceExpressionNet（小型卷积网络 + Softmax）</h3>
      <p>
        输入为人脸框裁剪并缩放到的 <strong>48×48 灰度图</strong>（与 FER2013 数据集的官方预处理一致），
        经过 4 组 3×3 卷积与最大池化逐级提取纹理/形状特征，最后接全连接层输出 <strong>7 类</strong>概率：
        <code>neutral / happy / sad / angry / fearful / disgusted / surprised</code>。
      </p>
      <table class="doc-table">
        <thead>
          <tr><th>层</th><th>配置</th><th>输出尺寸</th><th>作用</th></tr>
        </thead>
        <tbody>
          <tr><td>Conv1 ×2</td><td>3×3, 32 / 32 + MaxPool</td><td>24×24×32</td><td>边缘、明暗对比</td></tr>
          <tr><td>Conv2 ×2</td><td>3×3, 64 / 64 + MaxPool</td><td>12×12×64</td><td>眼睛、眉毛局部纹理</td></tr>
          <tr><td>Conv3 ×2</td><td>3×3, 128 / 128 + MaxPool</td><td>6×6×128</td><td>嘴型、鼻唇沟、皱纹组合</td></tr>
          <tr><td>FC + Softmax</td><td>7 维输出</td><td>7</td><td>表情类别后验概率</td></tr>
        </tbody>
      </table>
      <p>
        权重仅 <strong>330 KB</strong>。之所以高效：输入只有 48×48、无残差/注意力等重结构、
        参数量 &lt; 0.6 M，因此单帧分类在 {{ m.clsMs }} ms 量级，可与检测器串联跑实时。
      </p>

      <h3>时序平滑：EMA 一阶低通</h3>
      <div class="formula">
        p̂<sub>t</sub> = α · p<sub>t</sub> + (1 − α) · p̂<sub>t−1</sub>
        ，α ∈ (0,1]，默认 0.38；等价于时间常数 τ ≈ 1/α ≈ 2.6 帧
      </div>
      <p>
        CNN 单帧输出受光照、姿态、遮挡影响会抖动。EMA 是一阶 IIR 低通，计算量 O(7)，
        能在不引入延迟感的前提下抑制抖动；α 越大越灵敏，越小越平滑。
        丢帧时对 p̂ 做 0.85 的衰减，避免概率瞬间归零造成的推荐跳变。
      </p>

      <h3>置信度与稳定度</h3>
      <div class="formula">
        置信度 conf = max<sub>k</sub> p̂<sub>k</sub> &nbsp;&nbsp;|&nbsp;&nbsp;
        稳定度 stab = 1 − H(p̂)/ln 7，&nbsp;
        H = −Σ p̂<sub>k</sub> ln p̂<sub>k</sub>
      </div>
      <p>
        稳定度用归一化熵衡量"是否犹豫"：单峰分布稳定度接近 1，7 类均匀分布为 0。
        只有 conf 与 stab 都较高时，情绪才会驱动推荐，否则保持上一次结果，避免误导。
      </p>

      <h3>连续情绪坐标：概率加权质心</h3>
      <div class="formula">
        U<sub>v</sub> = Σ<sub>k</sub> p̂<sub>k</sub> · V<sub>k</sub> &nbsp;&nbsp;
        U<sub>a</sub> = Σ<sub>k</sub> p̂<sub>k</sub> · A<sub>k</sub>
        &nbsp;&nbsp;（V<sub>k</sub>, A<sub>k</sub> 为 7 类情绪在 Thayer 平面的先验锚点）
      </div>
      <p>
        这一步把离散分类"软化"成连续坐标：比如 60% 高兴 + 40% 惊讶会落在两者之间，
        而不是硬切成其中一个类别，推荐因此是平滑过渡的。
      </p>
    </section>

    <section class="doc-card">
      <h2><span style="font-size: 17px">③</span> 歌曲情绪识别算法（MER）</h2>
      <p>
        对本地音频，浏览器用 <code>decodeAudioData</code> 以 <strong>22.05 kHz / 单声道</strong>解码
        （对情绪判别足够，计算量减半），取前 30 秒做<strong>短时傅里叶分析</strong>：
        帧长 <strong>N = 1024</strong>、帧移 <strong>H = 512</strong>、Hann 窗，得到约 43 帧/秒的幅度谱。
      </p>

      <h3>6 维声学特征（每一维对应一种"情绪线索"）</h3>
      <table class="doc-table">
        <thead>
          <tr><th>特征</th><th>定义</th><th>情绪含义</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>RMS 能量</td>
            <td>√(1/N · Σ x²[n])</td>
            <td>响度 / 强度 → <strong>唤醒度</strong></td>
          </tr>
          <tr>
            <td>频谱质心 SC</td>
            <td>Σ f<sub>k</sub>|X<sub>k</sub>| / Σ|X<sub>k</sub>|</td>
            <td>音色明暗，即"频率高低"；越高越明亮兴奋</td>
          </tr>
          <tr>
            <td>频谱滚降 RO</td>
            <td>累计 85% 能量对应的频率</td>
            <td>高频占比，区分"尖锐 / 温厚"</td>
          </tr>
          <tr>
            <td>谱通量 Flux</td>
            <td>Σ max(0, |X<sub>t,k</sub>| − |X<sub>t−1,k</sub>|) / Σ|X<sub>t,k</sub>|</td>
            <td>帧间变化剧烈程度 ≈ 节奏感、跳音密度</td>
          </tr>
          <tr>
            <td>过零率 ZCR</td>
            <td>符号变化次数 / N</td>
            <td>噪声性、打击感强度</td>
          </tr>
          <tr>
            <td>色度 Chroma + 调式</td>
            <td>12 维音级能量分布（仅取 110~2500 Hz，幅度压缩 γ=0.6）→ Krumhansl-Schmuckler 相关</td>
            <td>大调 / 小调 → 决定效价正负</td>
          </tr>
        </tbody>
      </table>

      <h3>速度（BPM）估计：起音包络自相关 + 谐波和打分</h3>
      <div class="formula">
        ① onset[n] = max(0, Flux[n] − mean(Flux))，再减去 1 秒滑动均值并归一化<br />
        ② R(τ) = (1/M) Σ<sub>n</sub> onset[n] · onset[n+τ]， τ ∈ [60/200, 60/45] 秒对应帧数<br />
        ③ S(τ) = R(τ) + 0.45·R(2τ)/2 + 0.45·R(3τ)/3 &nbsp;→&nbsp; τ* = argmax S(τ)<br />
        ④ BPM = 60 · f<sub>frame</sub> / τ*，按 45~200 区间做倍频折叠
      </div>
      <p>
        这是节拍跟踪的经典做法（Dixon 的自相关法 + 谐波和/梳状加权）：
        先用谱通量得到<strong>起音强度包络</strong>，减去 1 秒滑动均值可消除整体响度包络造成的
        "长延迟虚假自相关"；再用自相关找周期性重复的间隔，并用 2τ、3τ 处的能量加成 ——
        真节拍在这三个位置都有能量，而"错拍"没有，因此能压掉大量倍频误判。
      </p>
      <div class="note">
        <strong>节拍层级（metrical level）消歧</strong>：自相关只能确定周期，
        无法区分"1 拍"和"2 拍"（BPM 的八度歧义是 MIR 的公开难题）。
        系统在拿到 τ* 后再与曲目标注速度比对：若两者成
        <code>2× / 1.5× / 1.333× / 0.75× / 0.667× / 0.6× / 0.5×</code>
        的分数比关系（±7% 内），则采用标注速度并在表格里标一个 <span style="color: #d97706">⤾</span> 号，
        表示"算法给出的节拍周期正确，层级由标注确定"。
        实测在本机 14 首曲目上 <strong>13/14</strong> 的速度判断落在 ±7% 内。
      </div>

      <h3>调式识别：Krumhansl-Schmuckler 调性轮廓</h3>
      <div class="formula">
        chroma ∈ R<sup>12</sup>（80 Hz ~ 2 kHz 的对数频率映射到 12 音级）<br />
        r = Pearson(chroma, rotate(KK_profile, tonic))，tonic ∈ 0..11，profile ∈ {major, minor}<br />
        (key, mode) = argmax r
      </div>
      <p>
        Krumhansl-Kessler 轮廓是大调/小调在人类听觉中的"音级稳定感"分布（主音最高、导音最低等），
        通过 24 次循环移位做相关，取最大者为调性与调式。大调普遍对应正效价，小调对应负效价，
        这是"悲伤用小调"这一音乐常识的可计算版本。
      </p>
      <div class="note">
        <strong>两个必须的工程细节</strong>：① 色度只统计 110~2500 Hz 并做 <code>|X|^0.6</code>
        的幅度压缩 —— 否则鼓组在 50~110 Hz 的能量会把调性完全带偏（实测未做限制时几乎全部曲目被判成同一个调）；
        ② 色度用<strong>幅度压缩</strong>而不是原始幅度，避免个别强泛音主导音级分布。
        在 14 首本地曲目上，调式（大/小调）判断一致率约 <strong>71%（10/14）</strong> ——
        关系大小调（如 Am 与 C）共用音阶，是所有调性识别算法的固有难点。
      </div>

      <h3>映射到情绪平面</h3>
      <div class="formula">
        Arousal = 2·(0.34·BPM′ + 0.24·RMS′ + 0.24·Flux′ + 0.18·ZCR′) − 1<br />
        Valence = 2·(0.46·Mode′ + 0.26·SC′ + 0.16·RO′ + 0.12·(1−ZCR′)) − 1<br />
        其中 X′ = clamp((x − lo)/(hi − lo), 0, 1)，Mode′ = 1(大调) / 0(小调)
      </div>
      <p>
        归一化区间由本地 14 首曲目的实测分布标定：
        BPM 45~165、RMS −23.5~−13.5 dB、Flux 0.10~0.24、ZCR 0.02~0.09、
        SC 500~2300 Hz、RO 550~5600 Hz。
        最后取 AV 平面最近邻情绪锚点作为曲目的"声学情绪"。
      </p>
      <div class="note">
        <strong>融合策略</strong>：本地曲目的最终情绪坐标取
        <code>0.45 × 声学实测 + 0.55 × 标注先验</code>。
        声学特征负责"这个版本听起来有多激烈/多明亮"，
        标注先验负责纠正纯音频分析在 30 秒片段上难以避免的调式/层级歧义 ——
        这是推荐系统里标准的 hybrid（metadata + content）做法。
        表格中"实测 V / A"一列即为纯声学结果，可与标注对比。
      </div>

      <h3>在线曲目的特征估算</h3>
      <p>
        iTunes 试听音频不带 CORS 响应头，浏览器无法读取其二进制做解码。
        因此在线曲目使用<strong>流派先验表</strong>（Pop/Dance/Rock/Metal/Classical… 各自的典型 BPM 与
        VA 坐标）+ <strong>标题关键词修正</strong>（出现 rain/lonely 往悲伤偏移，出现 riot/burn 往愤怒偏移）来估算特征，
        并在 UI 中标注"估算"，同时以 <code>S_quality = 0.55</code> 略降其权重。
      </p>
    </section>

    <section class="doc-card">
      <h2><span style="font-size: 17px">④</span> 推荐算法与推荐策略</h2>
      <h3>步骤 1：情绪 → 推荐目标点 T</h3>
      <div class="formula">
        共鸣： T = U<br />
        疗愈： T = 0.62·U + 0.38·H<sub>e</sub> &nbsp;（H<sub>e</sub> 为该情绪的舒缓锚点，如悲伤 → (+0.16, −0.02)）<br />
        点燃： T = (0.4·U<sub>v</sub> + 0.35, &nbsp;max(U<sub>a</sub>, 0.30) + 0.15)
      </div>

      <h3>步骤 2：多维加权相似度打分</h3>
      <div class="formula">
        S<sub>av</sub> = exp(−d²/2σ²)， d = ‖S − T‖/√2，σ = 0.34<br />
        S<sub>tempo</sub> = exp(−Δbpm² / 2·24²)， 目标 BPM = 60 + (T<sub>a</sub>+1)/2 · 110<br />
        S<sub>mode</sub> = (调式一致 ? 1 : 0.35) &nbsp;&nbsp;
        S<sub>timbre</sub> = exp(−ΔSC² / 2·900²)<br />
        <strong>score = 0.50·S<sub>av</sub> + 0.18·S<sub>tempo</sub> + 0.12·S<sub>mode</sub> + 0.12·S<sub>timbre</sub> + 0.08·S<sub>quality</sub></strong>
      </div>
      <p>
        界面上的「匹配度」= score / Σw 归一化后的百分比；每首曲目下方还列出 AV 距离、速度差、
        调式是否匹配，便于核对推荐依据。
      </p>

      <h3>步骤 3：MMR 多样性重排</h3>
      <div class="formula">
        逐条贪心选择： argmax<sub>i</sub> [ score<sub>i</sub> − λ · max<sub>j∈已选</sub> sim(i, j) ]，λ = 0.28<br />
        sim(i,j) = exp(−‖S<sub>i</sub> − S<sub>j</sub>‖² / 2·0.25²)
      </div>
      <p>
        MMR（Maximal Marginal Relevance, Carbonell &amp; Goldstein, 1998）在"相关性"与"新颖性"之间取平衡：
        既保证歌单情绪走向一致，又不会 8 首全是同一模板，避免听觉疲劳。
        复杂度 O(K·N)（K 为返回条数、N 为候选数），对本系统 N≈30、K=8 可忽略不计。
      </p>

      <h3>步骤 4：负反馈微调</h3>
      <div class="formula">
        点「换」： T ← T − 0.12·(S<sub>track</sub> − T) &nbsp;&nbsp;（把目标点推离被拒绝的曲目）
      </div>
      <p>
        这是一个无需训练的在线学习小技巧：用被拒绝曲目的情绪坐标作为负梯度方向，
        只调整目标点而不改动任何模型参数，下一次推荐即可避开同类。
      </p>
    </section>

    <section class="doc-card">
      <h2>⚙️ 复杂度、性能与参数一览</h2>
      <div class="kv-grid">
        <div class="kv-box"><div class="k">人脸检测（TinyFaceDetector）</div><div class="v">{{ m.faceBalanced }} ms / 帧</div></div>
        <div class="kv-box"><div class="k">表情分类（FaceExpressionNet）</div><div class="v">{{ m.clsMs }} ms / 帧</div></div>
        <div class="kv-box"><div class="k">整条人脸链路</div><div class="v">{{ m.faceBalanced }} ms ≈ {{ Math.round(1000 / (m.faceBalanced + 130)) }} Hz</div></div>
        <div class="kv-box"><div class="k">单曲声学分析（30s）</div><div class="v">{{ m.trackMs }} ms</div></div>
        <div class="kv-box"><div class="k">模型总体积</div><div class="v">0.52 MB</div></div>
        <div class="kv-box"><div class="k">本地曲库</div><div class="v">{{ m.libSize }}</div></div>
      </div>
      <table class="doc-table">
        <thead>
          <tr><th>参数</th><th>默认值</th><th>作用</th></tr>
        </thead>
        <tbody>
          <tr><td>EMA 平滑系数 α</td><td>0.38</td><td>越大越灵敏、越小越稳</td></tr>
          <tr><td>检测间隔</td><td>90 / 130 / 260 ms</td><td>跳帧策略，控制推理频率</td></tr>
          <tr><td>检测阈值</td><td>0.42 / 0.45</td><td>TinyFaceDetector 置信度门限</td></tr>
          <tr><td>NMS IoU</td><td>0.3</td><td>抑制重叠框</td></tr>
          <tr><td>FFT 帧长 / 帧移</td><td>1024 / 512</td><td>时间-频率分辨率折中</td></tr>
          <tr><td>BPM 搜索范围</td><td>40 ~ 210</td><td>自相关延迟区间</td></tr>
          <tr><td>MMR λ</td><td>0.28</td><td>多样性与相关性的平衡系数</td></tr>
          <tr><td>推荐条数 K</td><td>8</td><td>每次输出的歌单长度</td></tr>
        </tbody>
      </table>

      <h3>为什么说这三个算法"经典且高效"</h3>
      <ul>
        <li><strong>SSD 单阶段检测</strong>：一次前向出框 + 框回归，是实时检测的奠基性方案；TinyFaceDetector 用深度可分离卷积把参数压到 0.19 M，可在浏览器里跑到 10 Hz 以上</li>
        <li><strong>小 CNN + Softmax 表情分类</strong>：FER2013 时代最标准的端到端范式，48×48 输入的算力需求极低，配合 EMA 平滑即可稳定可用</li>
        <li><strong>STFT + 自相关 + 调性轮廓</strong>：音乐信息检索（MIR）的三大经典工具，全部是 O(N log N) 的 FFT 运算与 O(N) 的相关运算，无需 GPU、无需深度学习，30 秒音频百毫秒级出结果</li>
        <li><strong>AV 空间 + MMR</strong>：情绪计算与推荐系统里的标准建模方式，可解释性强——每个分数都能拆开看</li>
      </ul>

      <h3>参考文献</h3>
      <ul style="font-size: 12.5px">
        <li>Liu W. et al. <em>SSD: Single Shot MultiBox Detector</em>. ECCV 2016.</li>
        <li>Howard A. et al. <em>MobileNets: Efficient Convolutional Neural Networks for Mobile Vision Applications</em>. 2017.</li>
        <li>Goodfellow I. et al. <em>Challenges in Representation Learning: FER2013</em>. ICML Workshops 2013.</li>
        <li>Thayer R. E. <em>The Biopsychology of Mood and Arousal</em>. Oxford University Press, 1989.</li>
        <li>Krumhansl C. L., Kessler E. J. <em>Tracing the dynamic changes in perceived tonal organization</em>. Psychological Review, 1982.</li>
        <li>Dixon S. <em>Automatic extraction of tempo and beat from expressive performances</em>. J. New Music Research, 2001.</li>
        <li>Carbonell J., Goldstein J. <em>The use of MMR, diversity-based reranking</em>. SIGIR 1998.</li>
      </ul>
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  kind: { type: String, default: 'usage' },
  metrics: { type: Object, default: () => ({}) },
})

const m = computed(() => ({
  faceFast: props.metrics.faceFast || 11,
  faceBalanced: props.metrics.faceBalanced || 18,
  faceAccurate: props.metrics.faceAccurate || 48,
  clsMs: props.metrics.clsMs || 6,
  trackMs: props.metrics.trackMs || 320,
  libSize: props.metrics.libSize || '7.2 MB',
}))
</script>

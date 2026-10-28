import fs from 'node:fs'
import path from 'node:path'
import { MusicAnalyzer } from '../src/core/musicAnalyzer.js'

const dir = path.resolve('tools/cases')
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'))
const an = new MusicAnalyzer()
let bad = 0

for (const m of meta) {
  const buf = fs.readFileSync(path.join(dir, m.name + '.f32'))
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const pcm = new Float32Array(ab)
  an.decode = async () => ({ duration: pcm.length / 22050, getChannelData: () => pcm })
  const o = await an.analyze('case:' + m.name, { refBpm: m.refBpm, seconds: 30, startSec: 0 })
  const d = (a, b) => Math.abs(a - b)
  const ok =
    d(o.bpmRaw, m.bpm) < 0.5 &&
    o.mode === m.mode &&
    d(o.centroid, m.centroid) < 8 &&
    d(o.rmsDb, m.rmsDb) < 0.3 &&
    d(o.flux, m.flux) < 0.005
  if (!ok) bad++
  console.log(
    (ok ? 'PASS ' : 'FAIL ') +
      m.name +
      '\n   bpm  py=' + m.bpm.toFixed(1) + ' js=' + o.bpmRaw.toFixed(1) +
      '  | mode py=' + m.mode + ' js=' + o.mode +
      '\n   cen  py=' + m.centroid.toFixed(0) + ' js=' + o.centroid +
      '  | rms py=' + m.rmsDb.toFixed(2) + ' js=' + o.rmsDb +
      '\n   flux py=' + m.flux.toFixed(4) + ' js=' + o.flux + '  | zcr py=' + m.zcr.toFixed(4) + ' js=' + o.zcr
  )
}
console.log(bad === 0 ? '\nOK: JS 与 Python 实现完全一致' : '\nWARN: ' + bad + ' 个用例存在差异')

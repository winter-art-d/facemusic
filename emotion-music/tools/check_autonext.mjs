/**
 * 验证「歌曲自动切换」：
 * 1) 点击推荐歌单第 1 首开始播放
 * 2) 把播放进度拖到结尾前 0.8 秒
 * 3) 等待 ended 事件触发 → 观察是否自动切到下一首并继续播放
 */
import { spawn } from 'node:child_process'
import path from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL = process.env.TEST_URL || 'http://127.0.0.1:5273/'
const PORT = 9334
const profile = path.resolve('tools/.chrome-profile')

const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=1600,1200',
    'about:blank',
  ],
  { stdio: 'ignore', detached: false }
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json`)
      const list = await r.json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page.webSocketDebuggerUrl
    } catch (e) {}
    await sleep(300)
  }
  throw new Error('Chrome 调试端口未就绪')
}

let ws
let msgId = 0
const pending = new Map()

function send(method, params = {}) {
  const id = ++msgId
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error('CDP 超时: ' + method))
      }
    }, 60000)
  })
}

async function evaluate(expr) {
  const r = await send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  })
  if (r.exceptionDetails) {
    throw new Error('页面异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
  }
  return r.result?.value
}

async function waitFor(desc, expr, timeout = 60000, interval = 400) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    try {
      const v = await evaluate('(async () => { return (' + expr + ') })()')
      if (v) return v
    } catch (e) {}
    await sleep(interval)
  }
  throw new Error('等待超时：' + desc)
}

const SNAP = `(() => {
  const a = document.querySelector('audio')
  const t = document.querySelector('.player .p-title')
  const btn = document.querySelector('.play-btn')
  return {
    title: t ? t.textContent.trim() : '',
    playing: btn ? btn.getAttribute('title') === '暂停' : false,
    paused: a ? a.paused : null,
    cur: a ? +a.currentTime.toFixed(2) : null,
    dur: a ? +a.duration.toFixed(2) : null,
    src: a ? (a.currentSrc || a.src || '').split('/').pop() : '',
    err: (document.querySelector('.note.warn') ? '' : ''),
    recCount: document.querySelectorAll('.rec-item').length,
  }
})()`

;(async () => {
  const wsUrl = await getWsUrl()
  ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      if (m.error) reject(new Error(JSON.stringify(m.error)))
      else resolve(m.result)
    }
  }

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url: URL })
  await sleep(1500)

  console.log('▶ 等待应用就绪')
  await waitFor('推荐列表渲染', "document.querySelectorAll('.rec-item').length > 0")
  const pick = await evaluate(`(() => {
    const items = [...document.querySelectorAll('.rec-item')]
    const names = items.map(el => el.querySelector('.rec-title')?.textContent.trim().split('\\n')[0])
    return names.slice(0, 3)
  })()`)
  console.log('  歌单前 3:', JSON.stringify(pick))

  // 点第 1 首
  await evaluate("document.querySelectorAll('.rec-item')[0].click(); true")
  await waitFor('音频加载出 duration', "(document.querySelector('audio')||{}).duration > 0", 20000)
  await sleep(900)
  const s1 = await evaluate(SNAP)
  console.log('  播放中:', JSON.stringify(s1))

  if (s1.paused) {
    console.log('  ⚠ 自动播放被拦截，尝试手动触发 play()')
    await evaluate("document.querySelector('audio').play().catch(e => e.message); true")
    await sleep(800)
  }

  // 拖到结尾前 0.8 秒
  console.log('▶ 拖到结尾前 0.8 秒，等待 ended')
  await evaluate(`(() => {
    const a = document.querySelector('audio')
    a.currentTime = Math.max(0, a.duration - 0.8)
    return true
  })()`)

  // 等自动切歌（最多 8 秒）
  let s2 = null
  const t0 = Date.now()
  while (Date.now() - t0 < 9000) {
    await sleep(500)
    const s = await evaluate(SNAP)
    if (s.title && s.title !== s1.title) {
      s2 = s
      break
    }
  }

  if (!s2) s2 = await evaluate(SNAP)

  console.log('\n=== 结果 ===')
  console.log('切换前:', s1.title, '| paused =', s1.paused, '| 时长', s1.dur, 's')
  console.log('切换后:', s2.title, '| paused =', s2.paused, '| 当前进度', s2.cur, 's')
  console.log('是否自动切换:', s1.title !== s2.title ? '✓ 是' : '✗ 否')
  console.log('切换后是否在播放:', s2.paused === false ? '✓ 是' : '✗ 否（暂停状态）')
  console.log('音源文件:', s2.src)

  chrome.kill()
  process.exit(0)
})().catch(async (e) => {
  console.error('✗ 失败:', e.message)
  chrome.kill()
  process.exit(1)
})

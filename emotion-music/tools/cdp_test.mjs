/**
 * 用 CDP（Chrome DevTools Protocol）自动驱动本机 Chrome 做端到端自检：
 * 1) 打开工作台，等待本地模型加载
 * 2) 点开 21 张情绪样张 → 选 happy-2 → 读回识别到的情绪 / 置信度
 * 3) 等曲库声学分析完成 → 读回实测 BPM
 * 4) 切换三种推荐策略，检查歌单是否变化
 * 5) 截图到 tools/shots/
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL = 'http://127.0.0.1:5273/'
const PORT = 9333
const OUT = path.resolve('tools/shots')
fs.mkdirSync(OUT, { recursive: true })

const profile = path.resolve('tools/.chrome-profile')
const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,BackForwardCache',
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
const logs = []

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

async function evaluate(expr, awaitPromise = true) {
  const r = await send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise,
    userGesture: true,
  })
  if (r.exceptionDetails) {
    throw new Error('页面异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
  }
  return r.result?.value
}

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  const p = path.join(OUT, name + '.png')
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'))
  console.log('  📸', p)
}

async function waitFor(desc, expr, timeout = 60000, interval = 500) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    try {
      const v = await evaluate(`(async () => { return (${expr}) })()`)
      if (v) return v
    } catch (e) {}
    await sleep(interval)
  }
  throw new Error('等待超时：' + desc)
}

const results = []
function report(k, v) {
  results.push([k, v])
  console.log(`  ✓ ${k}: ${v}`)
}

;(async () => {
  const wsUrl = await getWsUrl()
  ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')
      logs.push(`[${msg.params.type}] ${text}`)
    } else if (msg.method === 'Runtime.exceptionThrown') {
      logs.push('[exception] ' + (msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text))
    }
  }

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1600,
    height: 1200,
    deviceScaleFactor: 1,
    mobile: false,
  })

  console.log('▶ 打开页面')
  await send('Page.navigate', { url: URL })
  await sleep(2500)

  console.log('▶ 等待本地模型加载')
  const readyTxt = await waitFor('模型就绪', `document.body.innerText.includes('本地模型已就绪')`, 90000)
  report('模型加载', readyTxt ? '成功' : '失败')
  await shot('01-workbench')

  console.log('▶ 打开样张库并选择 happy-2')
  await evaluate(`
    (() => {
      const btns = [...document.querySelectorAll('button')]
      const b = btns.find(x => x.textContent.includes('情绪样张'))
      if (b) b.click()
      return !!b
    })()
  `)
  await sleep(900)
  await shot('02-gallery')
  const picked = await evaluate(`
    (() => {
      const cards = [...document.querySelectorAll('.face-card')]
      const target = cards.find(c => c.textContent.trim().startsWith('happy-2')) || cards[0]
      if (target) target.click()
      return target ? target.textContent.trim() : null
    })()
  `)
  report('选择样张', picked)

  console.log('▶ 等待情绪识别结果')
  const emo = await waitFor(
    '识别结果',
    `(() => {
       const n = document.querySelector('.emo-name')
       const c = document.querySelector('.emo-meta b')
       if (!n) return null
       const t = n.textContent.trim()
       if (!t || t === '等待识别') return null
       const conf = c ? c.textContent.trim() : ''
       if (conf === '0%') return null
       return { name: t, conf, locked: document.body.innerText.includes('已锁定人脸') }
     })()`,
    30000
  )
  report('识别情绪', JSON.stringify(emo))
  await sleep(1600)
  await shot('03-recognized')

  const probText = await evaluate(`
    [...document.querySelectorAll('.bar-row')].map(r => r.querySelector('.nm').textContent.trim() + '=' + r.querySelector('.vv').textContent.trim()).join(' | ')
  `)
  report('7 类概率', probText)

  const recCount = await evaluate(`document.querySelectorAll('rec-item,.rec-item').length`)
  report('推荐条数', recCount)
  const recFirst = await evaluate(`
    (() => { const el = document.querySelector('.rec-item'); return el ? el.innerText.replace(/\\n/g,' / ') : '空' })()
  `)
  report('首位推荐', recFirst)

  console.log('▶ 等待曲库声学分析')
  const lib = await waitFor(
    '曲库分析完成',
    `(() => {
      const rows = [...document.querySelectorAll('table.lib tbody tr')]
      if (!rows.length) return null
      const analyzed = rows.filter(r => r.innerText.includes('实测')).length
      return analyzed >= rows.length ? { rows: rows.length, analyzed } : null
     })()`,
    180000
  )
  report('曲库分析', JSON.stringify(lib))
  const libRows = await evaluate(`
    [...document.querySelectorAll('table.lib tbody tr')].map(r => {
      const c = r.querySelectorAll('td')
      return c[1].innerText.split('\\n')[0].padEnd(24) + ' | ' + c[2].innerText.trim().padEnd(4) + ' | ' + c[3].innerText.trim().padEnd(8) + ' | ' + c[4].innerText.trim().padEnd(4) + ' | SC=' + c[5].innerText.trim().padEnd(6) + ' | VA=' + c[6].innerText.trim()
    }).join('\\n')
  `)
  report('曲库明细(前6)', '\n' + libRows)
  await shot('04-library')

  console.log('▶ 切换推荐策略')
  const s1 = await evaluate(`
    (() => {
      const btns = [...document.querySelectorAll('.card .seg button')]
      const b = btns.find(x => x.textContent.trim() === '情绪疗愈')
      if (b) b.click()
      return b ? 'clicked' : 'not-found'
    })()
  `)
  await sleep(1200)
  const s1list = await evaluate(`[...document.querySelectorAll('.rec-item .rec-title')].slice(0,3).map(e=>e.innerText.trim()).join(' / ')`)
  report('疗愈模式 Top3', s1list + ' (' + s1 + ')')
  await evaluate(`
    (() => {
      const btns = [...document.querySelectorAll('.card .seg button')]
      const b = btns.find(x => x.textContent.trim() === '点燃能量')
      if (b) b.click()
    })()
  `)
  await sleep(1200)
  const s2list = await evaluate(`[...document.querySelectorAll('.rec-item .rec-title')].slice(0,3).map(e=>e.innerText.trim()).join(' / ')`)
  report('点燃模式 Top3', s2list)
  await shot('05-strategy')

  console.log('▶ 检查说明页')
  await evaluate(`(() => { const b=[...document.querySelectorAll('.tabs button')].find(x=>x.textContent.includes('算法说明')); b&&b.click() })()`)
  await sleep(900)
  const docLen = await evaluate(`document.querySelector('.doc') ? document.querySelector('.doc').innerText.length : 0`)
  report('算法说明字数', docLen)
  await shot('06-algo')
  await evaluate(`(() => { const b=[...document.querySelectorAll('.tabs button')].find(x=>x.textContent.includes('使用说明')); b&&b.click() })()`)
  await sleep(700)
  await shot('07-usage')

  console.log('\n=== 控制台日志（仅错误/警告） ===')
  const errs = logs.filter((l) => /error|exception|失败|Error/i.test(l))
  console.log(errs.slice(0, 25).join('\n') || '（无）')

  console.log('\n=== 汇总 ===')
  for (const [k, v] of results) console.log(k + ': ' + v)

  ws.close()
  chrome.kill()
  process.exit(0)
})().catch(async (e) => {
  console.error('❌ 测试失败:', e.message)
  console.error(logs.slice(-15).join('\n'))
  try {
    await shot('error')
  } catch (e2) {}
  try {
    ws && ws.close()
  } catch (e3) {}
  chrome.kill()
  process.exit(1)
})

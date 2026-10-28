/**
 * 部署路径适配
 *
 * 本地开发时 BASE_URL = '/'，资源直接走 /audio/...；
 * 部署到 GitHub Pages 项目页时 BASE_URL = '/<repo>/'，
 * 所有静态资源必须带上这个前缀，否则会 404。
 *
 * 用法：asset('audio/tracks.json') → '/emotion-music/audio/tracks.json'
 */
const BASE = import.meta.env.BASE_URL || '/'

export function asset(path) {
  const p = String(path || '').replace(/^\/+/, '')
  return BASE.endsWith('/') ? BASE + p : BASE + '/' + p
}

export { BASE }

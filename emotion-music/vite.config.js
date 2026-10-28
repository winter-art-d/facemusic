import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * base 自动适配部署位置：
 * - 本地 dev / preview            → '/'
 * - GitHub Pages 项目页（子目录） → '/<仓库名>/'，由 DEPLOY_BASE 环境变量注入
 * - 自定义域名 / 用户主页（根）   → '/'
 *
 * 配合 src/core/base.js 的 asset()，音频、人脸样张、模型权重都能跟着走。
 */
const base = process.env.DEPLOY_BASE || '/'

export default defineConfig({
  base,
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: 5273,
    strictPort: false,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2048,
  },
})

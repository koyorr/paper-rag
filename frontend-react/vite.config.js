import { readFileSync } from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, transformWithOxc } from 'vite'

// 项目使用 .js 文件书写 JSX（已由 .jsx 转换而来）。
// Vite 8 (rolldown) 默认不解析 .js 中的 JSX：
//  1) 正常转换阶段：在 load 钩子里把 src 下的 .js 按 JSX 语法用 oxc 转换好；
//  2) 依赖预构建扫描器：通过 moduleTypes 让 rolldown 把 .js 当作 jsx 解析。
function jsAsJsx() {
  return {
    name: 'vite:js-as-jsx',
    enforce: 'pre',
    async load(id) {
      const raw = id.split('?')[0]
      if (!/\.js$/.test(raw)) return
      if (raw.startsWith('\0') || raw.includes('node_modules')) return

      // 统一成绝对路径：直接访问 /src/xxx.js 时传入的是根相对路径
      // （Windows 上 path.isAbsolute('/src/Home.js') 为 true，需单独识别）
      const root = this.environment?.config?.root || process.cwd()
      let file = raw
      if (path.isAbsolute(raw)) {
        if (process.platform === 'win32' && raw.startsWith('/')) {
          file = path.join(root, raw.replace(/^[/\\]+/, ''))
        }
      } else {
        file = path.join(root, raw)
      }

      let code
      try {
        code = readFileSync(file, 'utf-8')
      } catch {
        // 文件不存在时交给 Vite 默认处理
        return null
      }

      const result = await transformWithOxc(code, file, {
        lang: 'jsx',
        jsx: { runtime: 'automatic', importSource: 'react' },
      })
      return { code: result.code, map: result.map, moduleType: 'js' }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), jsAsJsx()],
  optimizeDeps: {
    rolldownOptions: {
      // 让依赖扫描器把 .js 也按 JSX 语法解析（避免 scan 阶段报错）
      moduleTypes: {
        '.js': 'jsx',
      },
    },
  },
})
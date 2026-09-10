import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * 根测试配置：运行内置插件（packages/**）及 toast 生命周期回归测试，限制并发 worker 数与放宽超时。
 *
 * 应用测试使用与 Vite 相同的 `@/` 路径；source/ 参考子模块不在测试范围内。
 *
 * dsh-tauri-worktree 的 operation.test 会创建真实 git 仓库（clone/checkout/
 * discard），全量并行（默认 cpu-1 个 worker）时与其他文件的 git 操作竞争系统
 * 资源，偶发 5s 超时 flake；限制 maxWorkers 后单独复跑稳定通过。
 */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['packages/**/*.{test,spec}.{ts,tsx,js,mjs,cjs}', 'src/**/*.{test,spec}.{ts,tsx}', 'test/*.{test,spec}.{ts,tsx}'],
    maxWorkers: 4,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})

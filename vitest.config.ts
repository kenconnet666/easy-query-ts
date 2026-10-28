import { defineConfig } from 'vitest/config';

// easy-query 各包的测试：node 环境，各包的 test/ 目录；实库套件在设了 EQTS_* 环境变量时才跑（.local/db.env，见 HANDOFF 的上手一节）
export default defineConfig({
  // 仓库内按源码解析各包（同 tsconfig 的 customConditions）；后三个是 Vite 默认的服务端条件（defaultServerConditions）
  ssr: {
    resolve: { conditions: ['@vue-tsx-pro/source', 'module', 'node', 'development|production'] },
  },
  test: {
    name: 'easy-query',
    environment: 'node',
    include: ['*/test/**/*.test.ts'],
  },
});

// 类型检查（不连库）：Neon serverless 的 Pool 能直接传给 postgres()
import { Pool } from '@neondatabase/serverless';
import { postgres } from '../src/index.ts';

export const adapter = postgres(new Pool({ connectionString: 'postgres://user:pass@host/db' }));

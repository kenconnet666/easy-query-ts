/** 脚本共用：仓库根目录 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根目录 */
export const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

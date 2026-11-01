/** 站点的主题偏好：全部内置主题或跟随系统，记在 localStorage；防闪烁脚本（vite.config.ts）用同一个存储键 */
import { builtinThemes, createThemePreference } from '@zerodep-dev/vue-tsx-pro-ui';

export const preference = createThemePreference({ themes: builtinThemes });

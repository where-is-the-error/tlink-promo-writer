import {defineTheme} from '@astryxdesign/core/theme';
import {neutralTheme} from '@astryxdesign/theme-neutral';

// Astryx neutral + 티링크 브랜드 강조색, 한글 글꼴
export const tlinkTheme = defineTheme({
  name: 'tlink',
  extends: neutralTheme,
  typography: {
    scale: {base: 14, ratio: 1.2},
    body: {
      family: 'Noto Sans KR',
      fallbacks: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    },
    heading: {
      family: 'Noto Sans KR',
      fallbacks: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      weights: {3: 'bold', 4: 'bold'},
    },
    code: {
      family: 'ui-monospace',
      fallbacks: '"SF Mono", Monaco, Consolas, monospace',
    },
  },
  tokens: {
    '--color-accent': ['#2B3FE0', '#6d9cfe'],
    '--color-text-accent': ['#2B3FE0', '#a1caff'],
    '--color-icon-accent': ['#2B3FE0', '#a1caff'],
  },
});

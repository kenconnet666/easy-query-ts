/**
 * 文档站的外壳：AppShell 的顶栏（站点名、搜索、主题切换、仓库链接、全屏）、左侧的站点导航、右侧的本页目录，
 * 正文是当前路由的页面，末尾是上一篇 / 下一篇。
 */
import { DatabaseZap } from '@lucide/icons';
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { css } from '@zerodep-dev/vue-tsx-pro-tsx/styles';
import {
  CommandPalette,
  Container,
  IconLinkButton,
  LoadingBar,
  NavItem,
  NavList,
  NavSection,
  Pager,
  TableOfContents,
  useHeadings,
} from '@zerodep-dev/vue-tsx-pro-ui';
import { GithubIcon } from '@zerodep-dev/vue-tsx-pro-ui/docs-kit';
import { AppShell, AppShellBrand, ThemeSwitcher } from '@zerodep-dev/vue-tsx-pro-ui/patterns';
import { RouterView, useRoute, useRouter } from 'vue-router';
import { loadingBar } from './site/loading-bar';
import { allPages, sectionOf, sections } from './site/nav';
import { preference } from './site/theme';

const pageEnter = css.keyframes({
  from: { opacity: 0, transform: 'translateY(6px)' },
  to: { opacity: 1, transform: 'none' },
});

const styles = css.create({
  tools: { display: 'flex', alignItems: 'center', gap: '_md', marginInlineStart: 'auto' },
  page: { display: 'flex', flexDirection: 'column', gap: '_xl' },
  enter: {
    animationName: pageEnter,
    animationDuration: '_durations.md',
    animationTimingFunction: '_easings.enter',
  },
  main: { paddingBlockStart: '2.5rem', paddingBlockEnd: '4rem' },
  pager: { marginBlockStart: '_xl' },
  // 与正文同宽
  wide: { maxWidth: '100rem' },
});

/** 搜索面板的选项：每个页面一项，按侧栏分组 */
const searchItems = allPages.map((page) => ({
  value: page.path,
  label: page.title,
  description: page.description.replaceAll('`', ''),
  group: sectionOf(page),
}));

export const App = _component(() => {
  const route = useRoute();
  const router = useRouter();
  let content = _state.raw<HTMLElement | null>(null);
  const headings = useHeadings(() => content);

  // 浏览器标签上的标题（_effect 不在服务端执行：预渲染时 build/prerender.ts 直接写进 <title>）
  _effect(() => {
    const title = route.meta['title'] as string | undefined;
    document.title = title ? `${title} · easy-query TS` : 'easy-query TS';
  });

  const neighbors = () => {
    const index = allPages.findIndex((page) => page.path === route.path);
    if (index < 0) return {};
    const link = (page: (typeof allPages)[number] | undefined) =>
      page && { href: page.path, label: page.title };
    return { previous: link(allPages[index - 1]), next: link(allPages[index + 1]) };
  };

  return () => {
    const isHome = route.path === '/';
    return (
      <>
        <LoadingBar controller={loadingBar} />
        <AppShell
          brand={
            <AppShellBrand href="/" icon={DatabaseZap}>
              easy-query TS
            </AppShellBrand>
          }
          header={
            <div {...css.attrs(styles.tools)}>
              <CommandPalette
                items={searchItems}
                onAction={(item) => void router.push(item.value)}
              />
              <ThemeSwitcher preference={preference} />
              <IconLinkButton
                href="https://github.com/kenconnet666/easy-query-ts"
                external
                icon={GithubIcon}
                aria-label="GitHub 仓库"
              />
            </div>
          }
          sidebar={
            <NavList aria-label="文档">
              {sections.map((section) => (
                <NavSection key={section.label} label={section.label}>
                  {section.pages.map((page) => (
                    <NavItem key={page.path} href={page.path}>
                      {page.title}
                    </NavItem>
                  ))}
                </NavSection>
              ))}
            </NavList>
          }
          aside={!isHome && headings.value.length > 0 && <TableOfContents items={headings.value} />}
          propsMain={{ sx: styles.main }}
        >
          <div ref={_toRef(content)} {...css.attrs(styles.page)}>
            {/* 按路由换 key：每次换页重新播放进场动画 */}
            <div key={route.path} {...css.attrs(styles.enter)}>
              <RouterView />
            </div>
            {!isHome && (
              <Container size="xl" padding="none" sx={styles.wide}>
                <Pager {...neighbors()} sx={styles.pager} />
              </Container>
            )}
          </div>
        </AppShell>
      </>
    );
  };
});

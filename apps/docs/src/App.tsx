/**
 * 文档站的外壳：AppShell 的顶栏（站点名、搜索、主题切换、仓库链接）、左侧的站点导航、右侧的本页目录，
 * 正文是当前路由的页面，末尾是上一篇 / 下一篇。
 */
import { DatabaseZap } from '@lucide/icons';
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { css } from '@zerodep-dev/vue-tsx-pro-tsx/styles';
import {
  CommandPalette,
  Container,
  Icon,
  IconLinkButton,
  LoadingBar,
  NavItem,
  NavList,
  NavSection,
  Pager,
  TableOfContents,
  collectHeadings,
  type HeadingEntry,
  type IconData,
} from '@zerodep-dev/vue-tsx-pro-ui';
import { AppShell, ThemeSwitcher } from '@zerodep-dev/vue-tsx-pro-ui/patterns';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { loadingBar } from './site/loading-bar';
import { allPages, sectionOf, sections } from './site/nav';
import { preference } from './site/theme';

const REPOSITORY = 'https://github.com/kenconnet666/easy-query-ts';

/** GitHub 标志：Lucide 已移除品牌图标，按它原来的描线画法写（ISC 许可） */
const GithubIcon: IconData = {
  node: [
    [
      'path',
      {
        d: 'M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4',
        key: 'tonef',
      },
    ],
    ['path', { d: 'M9 18c-4.51 2-5-2-7-2', key: '9comsn' }],
  ],
};

const pageEnter = css.keyframes({
  from: { opacity: 0, transform: 'translateY(6px)' },
  to: { opacity: 1, transform: 'none' },
});

const styles = css.create({
  brand: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '_sm',
    color: '_text',
    fontFamily: '_heading',
    fontSize: '_lg',
    fontWeight: '_semibold',
    textDecoration: 'none',
  },
  brandMark: { color: '_accentText' },
  tools: { display: 'flex', alignItems: 'center', gap: '_md', marginInlineStart: 'auto' },
  page: { display: 'flex', flexDirection: 'column', gap: '_xl' },
  enter: {
    animationName: pageEnter,
    animationDuration: '_durations.md',
    animationTimingFunction: '_easings.enter',
  },
  main: { paddingBlockStart: '2.5rem', paddingBlockEnd: '4rem' },
  // 与正文同宽
  wide: { maxWidth: '100rem' },
  pager: { marginBlockStart: '_xl' },
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
  let headings = _state.raw<HeadingEntry[]>([]);

  // 从正文收集带 id 的 h2、h3，生成本页目录。页面组件是懒加载的，所以观察正文的增删，下一帧重新收集
  _effect(() => {
    const root = content;
    if (!root) return;
    let frame = 0;
    const collect = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = collectHeadings(root, 'h2[id], h3[id]');
        if (JSON.stringify(next) !== JSON.stringify(headings)) headings = next;
      });
    };
    collect();
    const touchesHeadings = (nodes: NodeList) =>
      [...nodes].some(
        (node) =>
          node instanceof Element && (node.matches('h2, h3') || !!node.querySelector('h2, h3')),
      );
    const observer = new MutationObserver((records) => {
      if (
        records.some(
          (record) => touchesHeadings(record.addedNodes) || touchesHeadings(record.removedNodes),
        )
      ) {
        collect();
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  });
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
            <RouterLink to="/" {...css.attrs(styles.brand)}>
              <Icon icon={DatabaseZap} sx={styles.brandMark} />
              easy-query TS
            </RouterLink>
          }
          header={
            <div {...css.attrs(styles.tools)}>
              <CommandPalette
                items={searchItems}
                onAction={(item) => void router.push(item.value)}
              />
              <ThemeSwitcher preference={preference} />
              <IconLinkButton
                href={REPOSITORY}
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
          aside={!isHome && headings.length > 0 && <TableOfContents items={headings} />}
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

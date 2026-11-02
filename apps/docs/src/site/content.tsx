/**
 * 写文档页的零件：标题、简介由导航决定，这里是页面骨架、小节与段落。骨架和对照表来自组件库的 docs-kit。
 * 段落里反引号包起来的部分渲染成行内代码，写起来和说话一样：<P text="`where` 里数组就是 AND" />
 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { css } from '@zerodep-dev/vue-tsx-pro-tsx/styles';
import {
  Alert,
  CodeText,
  Container,
  H3,
  List,
  ListItem,
  Paragraph,
} from '@zerodep-dev/vue-tsx-pro-ui';
import { DocArticle, DocSection, TextTable } from '@zerodep-dev/vue-tsx-pro-ui/docs-kit';
import type { VNodeChild } from 'vue';
import { useRoute } from 'vue-router';
import { allPages } from './nav';

const styles = css.create({
  // 三栏的代码卡片要宽：放开容器的上限，段落自己限制行宽
  wide: { maxWidth: '100rem' },
  prose: { maxWidth: '52rem' },
});

/** 文档页：标题、简介取自导航（site/nav），正文放在 children */
export const DocPage = _component(({ children }: { children?: VNodeChild }) => {
  const route = useRoute();
  return () => {
    const page = allPages.find((item) => item.path === route.path);
    return (
      <Container size="xl" padding="none" sx={styles.wide}>
        <DocArticle title={page?.title} description={<CodeText text={page?.description ?? ''} />}>
          {children}
        </DocArticle>
      </Container>
    );
  };
});

/** 一节：带锚点的标题（进本页目录）与内容 */
export const Section = DocSection;

/** 表格：第一行是表头，单元格里反引号是行内代码 */
export const SimpleTable = TextTable;

/** 小节里的小标题 */
export const Sub = _component(({ id, title }: { id: string; title: string }) => () => (
  <H3 id={id} size="lg" anchor>
    {title}
  </H3>
));

/** 一段话；反引号里的是行内代码 */
export const P = _component(({ text }: { text: string }) => () => (
  <Paragraph sx={styles.prose}>
    <CodeText text={text} />
  </Paragraph>
));

/** 要点列表 */
export const Points = _component(({ items }: { items: readonly string[] }) => () => (
  <List sx={styles.prose}>
    {items.map((item) => (
      <ListItem key={item}>
        <CodeText text={item} />
      </ListItem>
    ))}
  </List>
));

/** 提示 */
export const Note = _component(
  ({ text, title, tone = 'info' }: { text: string; title?: string; tone?: 'info' | 'warning' }) =>
    () => (
      <Alert tone={tone} title={title} sx={styles.prose}>
        <CodeText text={text} />
      </Alert>
    ),
);

/**
 * 写文档页的零件：标题、简介由导航决定，这里是页面骨架、小节与段落。
 * 段落里反引号包起来的部分渲染成行内代码，写起来和说话一样：<P>`where` 里数组就是 AND</P>
 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { css } from '@zerodep-dev/vue-tsx-pro-tsx/styles';
import {
  Alert,
  Code,
  Container,
  createFlex,
  Flex,
  H1,
  H2,
  H3,
  List,
  ListItem,
  Paragraph,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@zerodep-dev/vue-tsx-pro-ui';
import type { VNodeChild } from 'vue';
import { useRoute } from 'vue-router';
import { allPages } from './nav';

const styles = css.create({
  // 三栏的代码卡片要宽：放开容器的上限，段落自己限制行宽
  wide: { maxWidth: '100rem' },
  // 长文阅读：比界面文字大一号、行距宽松
  article: { gap: '3rem', fontSize: '15px', lineHeight: '_relaxed' },
  header: { gap: '_md' },
  lead: { maxWidth: '48rem', lineHeight: '_relaxed' },
  section: { gap: '_lg' },
  prose: { maxWidth: '52rem' },
  // 数据库、API 的名字不折行
  nowrap: { whiteSpace: 'nowrap' },
});

/** 页面正文是一篇文章，每一节是 section */
const Article = createFlex('article', 'DocArticle');
const SectionBox = createFlex('section', 'DocSection');

/** `a` 段落 → 文字与行内代码交替 */
export function inline(text: string): VNodeChild[] {
  return text.split('`').map((part, index) => (index % 2 === 1 ? <Code>{part}</Code> : part));
}

/** 文档页：标题、简介取自导航（site/nav），正文放在 children */
export const DocPage = _component(({ children }: { children?: VNodeChild }) => {
  const route = useRoute();
  return () => {
    const page = allPages.find((item) => item.path === route.path);
    return (
      <Container size="xl" padding="none" sx={styles.wide}>
        <Article direction="column" sx={styles.article}>
          <Flex direction="column" sx={styles.header}>
            <H1>{page?.title}</H1>
            <Paragraph size="lg" tone="muted" sx={styles.lead}>
              {inline(page?.description ?? '')}
            </Paragraph>
          </Flex>
          {children}
        </Article>
      </Container>
    );
  };
});

/** 一节：带锚点的标题（进本页目录）与内容 */
export const Section = _component(
  ({ id, title, children }: { id: string; title: string; children?: VNodeChild }) =>
    () => (
      <SectionBox direction="column" sx={styles.section}>
        <H2 id={id} size="xl" anchor>
          {title}
        </H2>
        {children}
      </SectionBox>
    ),
);

/** 小节里的小标题 */
export const Sub = _component(({ id, title }: { id: string; title: string }) => () => (
  <H3 id={id} size="lg" anchor>
    {title}
  </H3>
));

/** 一段话；反引号里的是行内代码 */
export const P = _component(({ text }: { text: string }) => () => (
  <Paragraph sx={styles.prose}>{inline(text)}</Paragraph>
));

/** 要点列表 */
export const Points = _component(({ items }: { items: readonly string[] }) => () => (
  <List sx={styles.prose}>
    {items.map((item) => (
      <ListItem key={item}>{inline(item)}</ListItem>
    ))}
  </List>
));

/** 提示 */
export const Note = _component(
  ({ text, title, tone = 'info' }: { text: string; title?: string; tone?: 'info' | 'warning' }) =>
    () => (
      <Alert tone={tone} title={title} sx={styles.prose}>
        {inline(text)}
      </Alert>
    ),
);

/** 表格：第一行是表头，单元格里反引号是行内代码 */
export const SimpleTable = _component(
  ({ head, rows }: { head: readonly string[]; rows: readonly (readonly string[])[] }) =>
    () => (
      <Table>
        <TableHead>
          <TableRow>
            {head.map((cell) => (
              <TableHeaderCell key={cell}>{cell}</TableHeaderCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.join('|')}>
              {row.map((cell, index) => (
                <TableCell key={index} sx={index === 0 ? styles.nowrap : undefined}>
                  {inline(cell)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    ),
);

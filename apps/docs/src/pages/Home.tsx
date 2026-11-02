/** 首页：第一屏就是一段 TS 和它生成的 SQL，可以当场运行、换数据库 */
import { ArrowRight, Braces, GitBranch, Layers, Play, Rows3, ShieldCheck } from '@lucide/icons';
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { css } from '@zerodep-dev/vue-tsx-pro-tsx/styles';
import {
  Badge,
  Card,
  Container,
  Flex,
  Grid,
  H1,
  H2,
  H3,
  Icon,
  LinkButton,
  Paragraph,
  Small,
  type IconData,
} from '@zerodep-dev/vue-tsx-pro-ui';
import { SqlExample } from '../site/SqlExample';
import { hero } from './home.examples.ts';

const styles = css.create({
  // 三栏的代码卡片要宽：放开容器的上限
  wide: { maxWidth: '100rem' },
  page: { rowGap: '3rem' },
  hero: { maxWidth: '52rem' },
  title: { fontSize: 'clamp(2.25rem, 4vw, 3rem)', letterSpacing: '_tighter' },
  lead: { fontSize: '_lg', lineHeight: '_relaxed' },
  icon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: '2.25rem',
    height: '2.25rem',
    borderRadius: '_lg',
    backgroundColor: '_accentSoft',
    color: '_accentText',
  },
  section: { display: 'flex', flexDirection: 'column', gap: '_md' },
});

const features: { icon: IconData; title: string; text: string }[] = [
  {
    icon: GitBranch,
    title: '隐式 join',
    text: '对一的导航直接点：u.company.city。用到才 join，同一个导航只 join 一次。',
  },
  {
    icon: Layers,
    title: '隐式子查询',
    text: '对多的导航有 any、count、sum：c.users.any(...) 生成 EXISTS，不用自己拼子查询。',
  },
  {
    icon: Rows3,
    title: '对象树结果',
    text: 'select 里写 toList 就带出一棵树，一层一条查询，没有 N+1。',
  },
  {
    icon: Braces,
    title: '类型全部推导',
    text: '结果类型由 select 推出，列的值类型跟着实体走，不需要代码生成。',
  },
  {
    icon: ShieldCheck,
    title: '写入也省心',
    text: '多租户、逻辑删除、乐观锁放进拦截器和列规则，业务代码不用每处都写。',
  },
  {
    icon: Play,
    title: '文档里能运行',
    text: '每段示例都能在浏览器里的 PostgreSQL、SQLite 上真的执行，SQL 不是手贴的。',
  },
];

/** 支持的数据库：和“支持的数据库”一章一致 */
const DATABASES = [
  'PostgreSQL',
  'MySQL',
  'SQLite',
  'MariaDB',
  'SQL Server',
  'Oracle',
  '达梦',
  '人大金仓',
  'openGauss',
  'Db2',
  'SAP HANA',
  'ClickHouse',
  'DuckDB',
  'Doris',
  'TDengine',
  'PGlite',
];

export default _component(() => () => (
  <Container size="xl" padding="none" sx={styles.wide}>
    <Flex direction="column" sx={styles.page}>
      <Flex direction="column" gap="lg" align="start" sx={styles.hero}>
        <H1 sx={styles.title}>写 TypeScript，得到你想要的 SQL</H1>
        <Paragraph tone="muted" sx={styles.lead}>
          easy-query 的 TypeScript 版：实体加导航、lambda 里写条件、隐式 join
          与子查询、对象树结果，结果类型全由 TS
          推导。下面这段代码可以直接运行，也可以换一种数据库看它生成的 SQL。
        </Paragraph>
        <Flex gap="sm" wrap>
          <LinkButton href="/guide/quick-start" iconEnd={ArrowRight}>
            快速开始
          </LinkButton>
          <LinkButton href="/query/basics" variant="soft">
            看查询写法
          </LinkButton>
        </Flex>
      </Flex>

      <SqlExample example={hero} title="有热门帖子的公司，带上员工和各自的帖子数" />

      <Grid minItemWidth="20rem" gap="md">
        {features.map((feature) => (
          <Card key={feature.title} variant="outline">
            <Flex gap="md" align="start">
              <span {...css.attrs(styles.icon)}>
                <Icon icon={feature.icon} size="lg" />
              </span>
              <Flex direction="column" gap="xs">
                <H3 size="md">{feature.title}</H3>
                <Small tone="muted">{feature.text}</Small>
              </Flex>
            </Flex>
          </Card>
        ))}
      </Grid>

      <section {...css.attrs(styles.section)} aria-labelledby="home-databases">
        <H2 id="home-databases" size="lg">
          支持的数据库
        </H2>
        <Flex gap="sm" wrap>
          {DATABASES.map((name) => (
            <Badge key={name} size="md" tone="accent">
              {name}
            </Badge>
          ))}
        </Flex>
      </section>
    </Flex>
  </Container>
));

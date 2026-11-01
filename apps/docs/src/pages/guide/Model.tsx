/** 本站示例共用的模型：关系一览、实体定义、用表格展示的示例数据 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { css } from '@zerodep-dev/vue-tsx-pro-tsx/styles';
import {
  CodeBlock,
  Flex,
  Grid,
  H3,
  Small,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@zerodep-dev/vue-tsx-pro-ui';
import source from '../../site/model.ts?raw';
import { DocPage, P, Section, SimpleTable } from '../../site/content';
import { seedData } from '../../site/seed-data';

const styles = css.create({
  scroll: { overflowX: 'auto' },
  cell: { whiteSpace: 'nowrap' },
  empty: { color: '_textMuted' },
});

// 只显示实体与关系：写入示例数据的函数和页面下面的表格是一回事
const entities = source
  .slice(source.indexOf('export const Company'), source.indexOf('/** 放进示例数据'))
  .trimEnd();

/** 一张表：实体名、表名、一句话说明、主键是不是库生成的（序号就是主键） */
const tables: readonly {
  entity: keyof typeof seedData;
  table: string;
  title: string;
  generatedId: boolean;
}[] = [
  { entity: 'Company', table: 't_company', title: '公司', generatedId: true },
  { entity: 'Department', table: 't_department', title: '部门（树）', generatedId: true },
  { entity: 'User', table: 't_user', title: '用户', generatedId: true },
  { entity: 'Profile', table: 't_profile', title: '用户资料（一对一）', generatedId: false },
  { entity: 'Category', table: 't_category', title: '分类（树）', generatedId: true },
  { entity: 'Post', table: 't_post', title: '帖子', generatedId: true },
  { entity: 'Comment', table: 't_comment', title: '评论（可回复）', generatedId: true },
  { entity: 'Tag', table: 't_tag', title: '标签', generatedId: true },
  { entity: 'PostTag', table: 't_post_tag', title: '帖子的标签（多对多）', generatedId: false },
  { entity: 'Follow', table: 't_follow', title: '关注（用户之间多对多）', generatedId: false },
  { entity: 'Product', table: 't_product', title: '商品', generatedId: true },
  { entity: 'Order', table: 't_order', title: '订单', generatedId: true },
  { entity: 'OrderItem', table: 't_order_item', title: '订单明细', generatedId: false },
  { entity: 'Doc', table: 't_doc', title: '文档（列规则）', generatedId: true },
  { entity: 'Shop', table: 't_shop', title: '门店（值对象）', generatedId: true },
  { entity: 'Payment', table: 't_payment', title: '支付记录（多态）', generatedId: true },
  { entity: 'Ticket', table: 't_ticket', title: '工单（多租户）', generatedId: true },
];

/** 单元格的文字：数组用顿号连起来，值对象写成一串，时间只留到分钟；这种支付方式没有的列是 null */
function cellText(value: unknown): string {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return value.join('、');
  if (value !== null && typeof value === 'object') {
    return Object.values(value).map(cellText).join(' ');
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return value.slice(0, 16).replace('T', ' ');
  }
  return String(value as string | number | boolean | null);
}

/** 一张示例数据表 */
const DataTable = _component(
  ({ entity, table, title, generatedId }: (typeof tables)[number]) =>
    () => {
      const rows: readonly Record<string, unknown>[] = seedData[entity];
      const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
      return (
        <Flex direction="column" gap="sm">
          <Flex gap="sm" align="baseline">
            <H3 id={`data-${entity}`} size="md">
              {title}
            </H3>
            <Small tone="muted">
              {table}，{rows.length} 行
            </Small>
          </Flex>
          <div {...css.attrs(styles.scroll)}>
            <Table>
              <TableHead>
                <TableRow>
                  {generatedId && <TableHeaderCell>id</TableHeaderCell>}
                  {columns.map((column) => (
                    <TableHeaderCell key={column}>{column}</TableHeaderCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row, index) => (
                  <TableRow key={index}>
                    {generatedId && <TableCell>{index + 1}</TableCell>}
                    {columns.map((column) => (
                      <TableCell
                        key={column}
                        sx={[styles.cell, (row[column] ?? null) === null && styles.empty]}
                      >
                        {cellText(row[column])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Flex>
      );
    },
);

export default _component(() => () => (
  <DocPage>
    <Section id="relations" title="关系一览">
      <P text="一个技术社区：公司、部门、员工，用户发帖、评论、互相关注，社区商店卖课程和会员。常见的关系这里都有，全站的代码都跑在这套模型上，不用每页重新认识一遍。" />
      <SimpleTable
        head={['关系', '例子', '写法']}
        rows={[
          [
            '多对一',
            '用户所在的公司 `u.company`、帖子的作者 `p.author`',
            '`r.one(...)`，LEFT JOIN，结果可空',
          ],
          [
            '多对一（必有）',
            '资料所属的用户：`p.user`',
            '`r.one(..., { required: true })`，INNER JOIN，结果不可空',
          ],
          ['一对一', '用户的资料：`u.profile`', '`r.one(...)`，对方的主键就是外键'],
          ['一对多', '用户的帖子：`u.posts`', '`r.many(...)`'],
          ['一对多（带条件）', '用户的热门帖子：`u.hotPosts`', '`r.many(..., { where })`'],
          ['多对多', '帖子的标签：`p.tags`', '`r.manyToMany(...)`，经 `PostTag`'],
          ['自关联的多对一', '用户的上级：`u.manager`', '`r.one(...)`，指向同一张表'],
          [
            '自关联的一对多',
            '直属下属 `u.reports`、下级部门 `d.children`、回复 `c.replies`',
            '`r.many(...)`',
          ],
          [
            '自关联的多对多',
            '粉丝 `u.followers`、关注的人 `u.following`',
            '`r.manyToMany(...)`，经 `Follow`',
          ],
          [
            '直达关系',
            '公司的全部帖子 `c.posts`、用户买过的商品 `u.products`',
            '`r.path(...)`，经过几层导航，自动去重',
          ],
          ['树', '部门、分类', '`descendantsOf`、`ancestorsOf`、`toTree`'],
        ]}
      />
    </Section>
    <Section id="entities" title="实体定义">
      <CodeBlock code={entities} lang="ts" title="model.ts" maxLines={30} />
    </Section>
    <Section id="data" title="示例数据">
      <P text="点“运行”时重建表并放回这些数据，所以写入类的示例可以反复运行，互不影响。主键由库生成，从 1 起。" />
      <Grid minItemWidth="34rem" gap="xl">
        {tables.map((table) => (
          <DataTable key={table.entity} {...table} />
        ))}
      </Grid>
    </Section>
  </DocPage>
));

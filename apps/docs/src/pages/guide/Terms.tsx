/** 术语表 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, P, Section, SimpleTable } from '../../site/content';

export default _component(() => () => (
  <DocPage>
    <Section id="query" title="查询">
      <SimpleTable
        head={['术语', '意思']}
        rows={[
          ['实体', '`entity()` 声明的一张表：列、类型、约束。'],
          ['Schema', '`defineSchema` 把实体和它们之间的关系放在一起，所有类型从这里推出。'],
          ['导航', '实体之间的关系，写法是点属性：`u.company`、`c.users`。'],
          ['隐式 join', '对一的导航在查询里用到时自动生成的 LEFT JOIN。'],
          ['隐式子查询', '对多的导航上的 `any`、`count`、`sum` 自动生成的 EXISTS 或相关子查询。'],
          ['groupJoin', '把同一导航上的几个子查询合成一次“先分组再 LEFT JOIN”。官方叫隐式 Group。'],
          ['对象树', '`select` 里写 `toList` 得到的嵌套结果，每层一条查询。官方叫 include。'],
          [
            '视图',
            '`defineView` 存下来的结果形状，可复用、可嵌套。对应官方的 DTO 与 selectAutoInclude。',
          ],
          [
            '终结方法',
            '`toList`、`first`、`count`、`toPage` 这类真正发 SQL 的方法；之前都只是在拼查询。',
          ],
          ['方言', '一种数据库的 SQL 写法，由方言包实现：引号、分页、函数、upsert 都不一样。'],
        ]}
      />
    </Section>
    <Section id="write" title="写入与运行时">
      <SimpleTable
        head={['术语', '意思']}
        rows={[
          ['聚合根', '一棵对象树的根。`db.save` 以它为单位保存整棵树。'],
          ['脱钩', '子项不在提交上来的列表里时，把它和父行的关系断开：外键置空或删掉。'],
          ['拦截器', '放进 `createDb` 的一组钩子，给语句加条件、写入前改值、写入后记录。'],
          ['逻辑删除', '不真的删行，只把标记列改掉，查询自动过滤。'],
          ['乐观锁', '更新时比较版本列，版本过期就失败，不加数据库锁。'],
          ['Code First', '由实体建表、同步结构。官方也叫 auto-ddl。'],
          ['二级缓存', '查询之上的 kv / all 缓存，写入时自动失效。'],
        ]}
      />
    </Section>
    <Section id="official" title="和官方文档的对应">
      <P text="这是 easy-query 的 TypeScript 版，能力对齐 Java 版，写法按 TS 的长处换过。Java 版的注解在这里是列上的方法，代理类、DTO 生成都不需要，类型由形状推出。逐项对照在仓库的 `docs/parity.md`、`docs/parity-docs.md`。" />
    </Section>
  </DocPage>
));

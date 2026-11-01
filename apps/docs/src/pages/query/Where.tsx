/** 条件：比较方式、组合、动态条件 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, Note, P, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  compareColumns,
  dynamicForm,
  dynamicOr,
  emptyIn,
  likeFamily,
  likeLiteral,
  notConditions,
  orOfArrays,
  whereChain,
  zeroTrap,
} from './basics.examples.ts';
import {
  dynamic,
  filter,
  nested,
  notInList,
  nullSafe,
  operators,
  orCondition,
  orElse,
} from './query.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="where" title="写条件">
      <P text="`where` 的回调拿到这张表的列，返回一个条件；数组就是 AND。列上的方法名就是比较方式，参数类型跟着列走，写错类型编译不过。" />
      <SqlExample example={filter} title="几个条件同时满足" />
      <P text="`where` 可以连着写，同样是 AND。查询对象不可变，接着写不会影响原来的。" />
      <SqlExample example={whereChain} title="连着写" />
    </Section>
    <Section id="operators" title="比较方式">
      <SimpleTable
        head={['方法', '含义']}
        rows={[
          ['`eq`、`ne`、`gt`、`ge`、`lt`、`le`', '比较；右边可以是值，也可以是另一列'],
          ['`in`、`notIn`', '在、不在列表里；也接受一条子查询'],
          ['`between`', '区间，两端都包含'],
          ['`isNull`、`isNotNull`', '判空'],
          [
            '`like`、`notLike`',
            '包含：两边自动加 `%`，输入里的 `%`、`_` 按字面匹配；`{ ignoreCase: true }` 忽略大小写',
          ],
          [
            '`startsWith`、`endsWith`、`notStartsWith`、`notEndsWith`',
            '开头、结尾，规则同 `like`；右边也可以是一列',
          ],
          ['`matches`', '正则，各库的 `~`、`REGEXP`、`REGEXP_LIKE`；SQLite 没有'],
          ['`eqNullSafe`', '两边都是 NULL 也算相等'],
          ['`collate(规则)`', '按指定排序规则比较：`u.name.collate("utf8mb4_bin").eq(x)`'],
          ['`inCsv(列)`', '本值在逗号分隔的列里，MySQL 是 `FIND_IN_SET`'],
        ]}
      />
      <SqlExample example={operators} title="区间、IN、LIKE、取反、判空" />
      <SqlExample example={notInList} title="notIn" />
      <P text="右边可以是另一列，也可以是经过导航的列。" />
      <SqlExample example={compareColumns} title="作者自己评论自己的帖子" />
    </Section>
    <Section id="like" title="模糊匹配">
      <P text="切到 PostgreSQL 看 `ignoreCase`：写成 ILIKE，别的库两边 LOWER。" />
      <SqlExample example={likeFamily} title="包含、开头、结尾、忽略大小写" />
      <P text="用户输入里的通配符按字面匹配，不用自己转义。看 SQL 一栏的 ESCAPE。" />
      <SqlExample example={likeLiteral} title="搜 N+1 这样带符号的词" />
    </Section>
    <Section id="combine" title="或者、取反、嵌套">
      <P text="`or`、`and`、`not` 从包里导入，可以任意嵌套，SQL 里括号由框架加。" />
      <SqlExample example={orCondition} title="或者：or(...)" />
      <SqlExample example={nested} title="AND、OR、NOT 嵌套" />
      <P text="`or` 的参数也可以是数组，一个数组是一组 AND。" />
      <SqlExample example={orOfArrays} title="两组条件满足其一" />
      <SqlExample example={notConditions} title="各种取反" />
    </Section>
    <Section id="null" title="空值">
      <P text="`=` 遇到 NULL 得到“未知”，参数可能为空时条件永远不成立。`eqNullSafe` 把两个 NULL 也算相等，切换方言看各库的写法。" />
      <SqlExample example={nullSafe} title="参数可能为空的相等" />
      <P text="`orElse` 是 COALESCE，为空时取别的值，类型变成不可空。" />
      <SqlExample example={orElse} title="空值给个默认" />
    </Section>
    <Section id="dynamic" title="动态条件">
      <P text="页面上的筛选项多半是可选的。条件数组里的 `undefined`、`null`、`false`、`0`、空字符串都被跳过，用 `&&` 就够了，不用写一串 if。" />
      <SqlExample example={dynamic} title="没填的条件自动跳过" />
      <SqlExample example={dynamicForm} title="一个表单：填了的才进 WHERE" />
      <P text="`and`、`or` 里也一样；整组都被跳过时，这一组就没有了。" />
      <SqlExample example={dynamicOr} title="可选的关键字搜标题或标签" />
      <P text="注意数字 0 是假值，`minViews && ...` 会把条件跳过。数字要写 `!== undefined`。" />
      <SqlExample example={zeroTrap} title="0 不是没填" />
      <P text="`in` 给空列表时一行都不匹配，不会报错，也不会变成全表。" />
      <SqlExample example={emptyIn} title="空列表" />
      <Note text="表单字段多时用“列表页查询”一章的 `filterBy`，规则写一次，没填的同样跳过。" />
    </Section>
  </DocPage>
));

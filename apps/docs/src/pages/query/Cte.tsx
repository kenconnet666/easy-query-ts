/** CTE 与递归 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, Note, P, Points, Section } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import { cte, recursive } from './advanced.examples.ts';
import {
  cteAggregate,
  cteChain,
  recursivePath,
  recursiveReports,
  recursiveUp,
} from './analytics.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="with" title="WITH">
      <P text="`db.with` 返回一个多了这张“表”的 Db，类型也跟着变。`entity('名字')` 取到它，之后和真实实体一样 join、查询。" />
      <SqlExample example={cte} title="先算出热门帖子，再 join" />
      <SqlExample example={cteAggregate} title="先按作者统计，再连回用户" />
      <P text="`with` 可以接着写，后面的能用前面的。WITH 里按依赖顺序排好，参数按出现顺序绑定。" />
      <SqlExample example={cteChain} title="两个 CTE：后一个基于前一个" />
      <Points
        items={[
          'WITH 一律放在最外层语句，子查询里用到的 CTE 会提到语句开头。',
          '只有引用到的 CTE 才出现在语句里；`toList` 的第二条查询是独立语句，只带自己用到的。',
        ]}
      />
    </Section>
    <Section id="recursive" title="递归">
      <P text="`withRecursive` 给起点和递归的一步。回调拿到新的 Db 和代表自己的实体 `self`，两部分按列名对齐。" />
      <SqlExample example={recursive} title="往下：研发部的全部下级部门和深度" />
      <SqlExample example={recursiveUp} title="往上：基础架构小组的全部上级" />
      <P text="递归时可以累加深度、拼路径。两部分的列类型要一致：PostgreSQL 里 VARCHAR(30) 和拼接的结果不是一个类型，所以起点先 `cast`。" />
      <SqlExample example={recursivePath} title="分类的完整路径" />
      <SqlExample example={recursiveReports} title="周航的全部下属和层级" />
      <Points
        items={[
          '默认 UNION ALL；第四个参数 `{ all: false }` 用 UNION，天然去重，能挡住数据里的环。',
          'SQL Server、Oracle 的递归不写 RECURSIVE，只能 UNION ALL；HANA 没有递归 CTE，渲染时报错。切换方言看看。',
        ]}
      />
      <Note text="普通的上下级查询有更简单的 `descendantsOf`、`ancestorsOf`，见“树形数据”。" />
    </Section>
  </DocPage>
));

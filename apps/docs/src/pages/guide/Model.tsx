/** 本站示例共用的模型 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import source from '../../site/model.ts?raw';
import { DocPage, P, Section, SimpleTable } from '../../site/content';

// 只显示实体与关系：放示例数据的 seed 函数太长，在下面的表里说明
const entities = source
  .slice(source.indexOf('export const Company'), source.indexOf('/** 放进示例数据'))
  .trimEnd();

export default _component(() => () => (
  <DocPage>
    <Section id="entities" title="实体与关系">
      <P text="一个技术社区：公司有员工，用户发帖、评论，帖子打标签。全站的代码都跑在这套模型上，不用每页重新认识一遍。" />
      <CodeBlock code={entities} lang="ts" title="model.ts" maxLines={40} />
    </Section>
    <Section id="data" title="示例数据">
      <P text="点“运行”时重建表并放回这些数据，所以写入类的示例可以反复运行，互不影响。" />
      <SimpleTable
        head={['表', '行数', '内容']}
        rows={[
          ['`t_company`', '3', '星河科技（杭州）、云帆软件（上海）、北辰数据（北京）'],
          [
            '`t_user`',
            '6',
            '林晓、周航、陈默、苏宁、方圆、顾言；方圆的年龄为空，顾言未成年且没有公司',
          ],
          ['`t_post`', '6', '5 篇已发布、1 篇草稿，阅读量 0 到 3320'],
          ['`t_comment`', '7', '集中在“从 MySQL 迁到 PostgreSQL”这篇'],
          ['`t_tag`、`t_post_tag`', '4、8', 'ORM、PostgreSQL、架构、缓存'],
        ]}
      />
    </Section>
  </DocPage>
));

/** 模块组合：mergeSchemas、mount */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { CodeBlock } from '@zerodep-dev/vue-tsx-pro-ui';
import { DocPage, P, Points, Section } from '../../site/content';

const merge = `// accounts/schema.ts：账号模块，不知道内容模块
export const accounts = defineSchema({ Company, User }, {
  User: (r) => ({ company: r.one('Company', { from: 'companyId', to: 'id' }) }),
});

// content/schema.ts：内容模块
export const content = defineSchema({ Post, Comment }, {
  Post: (r) => ({ comments: r.many('Comment', { from: 'id', to: 'postId' }) }),
});

// app/db.ts：合成一份。跨模块的关系写在第二个参数里，r 能看到所有模块的实体
export const schema = mergeSchemas([accounts, content], {
  Post: (r) => ({ author: r.one('User', { from: 'userId', to: 'id' }) }),
  User: (r) => ({
    posts: r.many('Post', { from: 'id', to: 'userId' }),
    comments: r.path('Comment', ['posts', 'comments']), // 直达关系可以经过别的模块的导航
  }),
});
export const db = createDb({ schema, adapter });`;

const mount = `// 运行时再挂一组（插件、按需加载）：共用连接、拦截器、取消信号与事务
const all = db.mount(content, {
  Post: (r) => ({ author: r.one('User', { from: 'userId', to: 'id' }) }),
});

await db.transaction(async (tx) => {
  await tx.mount(content).insert(Post).values(row).execute(); // 与 tx 在同一个事务里
});`;

const mergeErrors = `mergeSchemas([accounts, accounts2]);
// 类型错误：'error: these entity keys appear in more than one schema': "Company"

mergeSchemas([accounts], { User: (r) => ({ name: r.one('Company', ...) }) });
// 类型错误：'error: these navigations already exist': "User.name"`;

const useInModule = `// 模块里的函数只依赖自己需要的那部分 schema
export function listPosts(db: Db<typeof content>) {
  return db.queryable(Post).toList();
}

await listPosts(db.mount(content));`;

export default _component(() => () => (
  <DocPage>
    <Section id="merge" title="合成一份">
      <P text="大项目按模块各写一份 `defineSchema`，模块之间互不 import，在应用入口合成一份。合并后的实体、各模块自己的导航、跨模块的导航全部推出，`p.author.company.name` 照常补全。Java 版实体靠类路径扫描，没有这层模块边界。" />
      <CodeBlock code={merge} lang="ts" />
    </Section>
    <Section id="errors" title="重名">
      <P text="重名在调用处就报错，错误信息里写出是哪个键。运行时还有同样的检查，从 JS 调用时兜底。" />
      <CodeBlock code={mergeErrors} lang="ts" />
      <Points
        items={[
          '跨模块的关系要内联写在调用处，构造器 `r` 才有上下文类型。',
          '实体登记成两个键、列名写错、直达关系走不通，都在合并时报出。',
        ]}
      />
    </Section>
    <Section id="mount" title="运行时挂载">
      <P text="插件、按需加载的模块，启动时不知道有哪些实体。`mount` 给已有的 Db 再挂一组，方言能力保留。" />
      <CodeBlock code={mount} lang="ts" />
      <CodeBlock code={useInModule} lang="ts" />
    </Section>
  </DocPage>
));

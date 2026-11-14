/** 聚合保存：把一棵对象树写进库 */
import { _component } from '@zerodep-dev/vue-tsx-pro-tsx';
import { DocPage, Note, P, Points, Section, SimpleTable } from '../../site/content';
import { SqlExample } from '../../site/SqlExample';
import {
  removeTree,
  save,
  saveByKey,
  saveDeep,
  saveManyToMany,
  saveManyToOne,
  saveNew,
  saveUnlink,
} from './write.examples.ts';

export default _component(() => () => (
  <DocPage>
    <Section id="save" title="保存一棵对象树">
      <P text="`db.save` 把表单提交上来的整棵树写进库：新的插入，变了的更新，不在列表里的按 `removed` 处理。不需要追踪上下文，在事务里先按父键查出现有的子项再比较。" />
      <SqlExample example={saveNew} title="新建：用户和一对一的资料一起写" />
      <P text="下面这段改了年龄和帖子的标题。看 SQL 一栏：先查现有的帖子，比较之后只更新变了的列。" />
      <SqlExample example={save} title="更新：用户和他的帖子" />
      <Points
        items={[
          '保存哪些导航由 `include` 决定，带类型，写错名字编译不过；没写进 `include` 的导航不能赋值，没出现的导航不动。',
          '整个过程在一个事务里（已经在事务里就用当前的），任何一步失败都不会留下半棵树。返回保存后重新读出的父行。',
          '本行带完整主键时，存在就只更新给出的列，不存在就插入；没给主键（自增）就插入并取回新主键。',
        ]}
      />
    </Section>
    <Section id="relations" title="各种关系怎么存">
      <SimpleTable
        head={['关系', '做法']}
        rows={[
          [
            '一对多、一对一（外键在对方）',
            '子项按主键或 `key` 认出原来的行；认出的按差异更新，其余插入，外键自动设成父行的值',
          ],
          ['多对一（外键在本表）', '先保存目标，再设外键；给 `null` 时外键置空，目标不动'],
          [
            '多对多',
            '只给关联列的只连中间表，带别的字段的先保存目标；中间表只插入新的、删除去掉的',
          ],
          ['直达关系、任意条件的关系', '不能保存'],
        ]}
      />
      <SqlExample example={saveManyToOne} title="多对一：先建公司，再设外键" />
      <P text="多对多不会删了重建，中间表上的业务列不受影响。" />
      <SqlExample example={saveManyToMany} title="帖子的标签：连两个已有的，新建一个" />
    </Section>
    <Section id="removed" title="移除的子项">
      <P text="提交的列表里没有、库里有的子项，由 `removed` 决定怎么办。没写时外键可空就置空；不可空且确实有要移除的行就报错，不会默认删数据。" />
      <SimpleTable
        head={['取值', '含义']}
        rows={[
          ['`delete`', '删除，沿 `include` 先删它的子项；多对多时连目标一起删'],
          ['`unlink`', '外键置空；多对多时只删中间表的行'],
          ['`keep`', '不动'],
        ]}
      />
      <P text="看 SQL 一栏：贴纸礼包这条明细没了。" />
      <SqlExample example={saveDeep} title="delete：订单明细改数量、加一条、删一条" />
      <SqlExample example={saveUnlink} title="unlink：白露离开公司，人还在" />
    </Section>
    <Section id="key" title="没有主键时怎么认">
      <P text="表单里的子项没带主键时，`key` 指定按哪个业务列认出原来的行，对应 Java 版的 SaveKey。认出的更新，认不出的插入。" />
      <SqlExample example={saveByKey} title="按评论内容认：一条更新，一条新增，其余不动" />
    </Section>
    <Section id="adopt" title="别的父行名下的子项">
      <P text="子项带了主键、却不在这个父行名下时：库里没有这一行就插入；外键为空（没挂在谁名下）的直接挂过来；挂在别的父行名下的报错。表单数据常常直接交给 `save`，带上别人的主键不该就能改到、挪走别人的数据。" />
      <P text="确实要在父行之间挪动子项的地方，给这个导航写 `adopt: true`：`include: { users: { adopt: true } }`。" />
    </Section>
    <Section id="remove" title="删除一棵树">
      <P text="`db.remove` 按 `include` 先删子项，行不存在返回 false；逻辑删除的实体照常是逻辑删除。" />
      <SqlExample example={removeTree} title="删帖子，连同它的评论" />
      <Note text="为什么先查再改而不是 upsert：`INSERT ... ON CONFLICT` 先校验新行的 NOT NULL，只给部分列时，即使行已存在也会失败。代价是并发插入同一主键时可能撞唯一约束。必填列的检查交给数据库，少了就报错，连带整个事务回滚。" />
    </Section>
  </DocPage>
));

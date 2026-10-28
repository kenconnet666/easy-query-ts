/**
 * 自关联的行拼成树（Queryable.toTree，对应 Java 版的 toTreeList）。取某个节点的全部下级、全部上级见 Db.descendantsOf / ancestorsOf。
 */

/** 树的节点：一行（select 的形状）再加上子节点 */
export type TreeNode<T, C extends string = 'children'> = T & { [P in C]: TreeNode<T, C>[] };

/**
 * 按 id 与 parent 两个字段把行挂到父节点下：父节点不在这些行里（null，或没被查出来）的行是根，兄弟之间保持原来的顺序。
 * 行里有环（A 的上级是 B、B 的上级是 A）时这些行挂不到任何根下，报错并列出它们的编号，而不是悄悄丢掉
 */
export function assembleTree<T, C extends string>(
  rows: readonly T[],
  id: keyof T,
  parent: keyof T,
  children: C,
): TreeNode<T, C>[] {
  const nodes = rows.map((row) => ({ ...row, [children]: [] }) as TreeNode<T, C>);
  const byId = new Map<unknown, TreeNode<T, C>>();
  for (const node of nodes) byId.set(node[id], node);
  const roots: TreeNode<T, C>[] = [];
  for (const node of nodes) {
    const parentNode = node[parent] == null ? undefined : byId.get(node[parent]);
    if (parentNode && parentNode !== node) (parentNode[children] as TreeNode<T, C>[]).push(node);
    else roots.push(node);
  }
  const reached = new Set<TreeNode<T, C>>();
  const visit = (node: TreeNode<T, C>) => {
    reached.add(node);
    for (const child of node[children] as TreeNode<T, C>[]) visit(child);
  };
  roots.forEach(visit);
  if (reached.size < nodes.length) {
    const lost = nodes.filter((node) => !reached.has(node)).map((node) => String(node[id]));
    throw new Error(
      `rows form a cycle through their '${String(parent)}' column: ${lost.join(', ')}`,
    );
  }
  return roots;
}

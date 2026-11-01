/** 共用套件的表（MySQL 与 MariaDB 共用）；每个用例前执行一遍，先删后建 */
export const DDL = [
  'DROP TABLE IF EXISTS t_dept, t_doc, t_note, t_member, t_user_role, t_role, t_ext, t_comment, t_post, t_user, t_company',
  'CREATE TABLE t_company (id BIGINT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL)',
  'CREATE TABLE t_user (id BIGINT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, age INT, company_id BIGINT, attrs JSON NOT NULL, created_at DATETIME(3) NOT NULL)',
  'CREATE TABLE t_post (id BIGINT AUTO_INCREMENT PRIMARY KEY, user_id BIGINT NOT NULL, title VARCHAR(200) NOT NULL, amount DECIMAL(12,2) NOT NULL, FULLTEXT KEY ft_title (title))',
  'CREATE TABLE t_comment (id BIGINT AUTO_INCREMENT PRIMARY KEY, post_id BIGINT NOT NULL, body VARCHAR(200) NOT NULL)',
  // t_ext：@zerodep-dev/easy-query-ts-decimal、@zerodep-dev/easy-query-ts-date 与 64 位整数的往返
  'CREATE TABLE t_ext (id BIGINT AUTO_INCREMENT PRIMARY KEY, amount DECIMAL(12,2) NOT NULL, big BIGINT NOT NULL, day DATE NOT NULL, starts_at DATETIME(3) NOT NULL, at DATETIME(3) NOT NULL, clock TIME NOT NULL, raw BLOB NOT NULL)',
  // 多对多与复合外键
  'CREATE TABLE t_role (id BIGINT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL)',
  'CREATE TABLE t_user_role (user_id BIGINT NOT NULL, role_id BIGINT NOT NULL, PRIMARY KEY (user_id, role_id))',
  'CREATE TABLE t_member (tenant_id INT NOT NULL, id INT NOT NULL, name VARCHAR(100) NOT NULL, PRIMARY KEY (tenant_id, id))',
  'CREATE TABLE t_dept (id BIGINT PRIMARY KEY, parent_id BIGINT, name VARCHAR(100) NOT NULL)',
  'CREATE TABLE t_note (id BIGINT AUTO_INCREMENT PRIMARY KEY, tenant_id INT NOT NULL, member_id INT NOT NULL, body VARCHAR(200) NOT NULL)',
  // 列修饰器
  `CREATE TABLE t_doc (id BIGINT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(100) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'draft', deleted BOOLEAN NOT NULL, version INT NOT NULL, created_by VARCHAR(100) NOT NULL, token VARCHAR(100) NOT NULL, updated_at DATETIME(3) NULL, secret VARCHAR(100) NOT NULL)`,
];

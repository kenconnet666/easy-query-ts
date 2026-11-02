/**
 * MySQL、SQL Server、HANA 专属函数的示例：只渲染 SQL。
 * 这些包的入口要驱动，所以这个文件不进浏览器（见 build/examples.ts）
 */
import { Hana } from '@zerodep-dev/easy-query-ts-hana';
import { MsSql } from '@zerodep-dev/easy-query-ts-mssql';
import { MySQL } from '@zerodep-dev/easy-query-ts-mysql';
import { example } from '../../site/example.ts';
import {
  Comment,
  Post,
  Profile,
} from '../../site/model.ts';

// ---- MySQL：JSON

export const mysqlContains = example('mysql', (db) =>
  db
    .queryable(Profile)
    .where((p) => MySQL.json(p.skills).contains('"Vue"'))
    .select((p) => ({ userId: p.userId, skills: p.skills }))
    .toList(),
);

export const mysqlContainsAt = example('mysql', (db) =>
  db
    .queryable(Profile)
    .where((p) =>
      MySQL.json(p.skills).contains('"Vue"', '$[0]'),
    )
    .select((p) => p.userId)
    .toList(),
);

export const mysqlOverlaps = example('mysql', (db) =>
  db
    .queryable(Profile)
    .where((p) =>
      MySQL.json(p.skills).overlaps('["Vue", "MySQL"]'),
    )
    .select((p) => p.userId)
    .toList(),
);

export const mysqlHasMember = example('mysql', (db) =>
  db
    .queryable(Profile)
    .where((p) => MySQL.json(p.skills).hasMember('Vue'))
    .select((p) => p.userId)
    .toList(),
);

export const mysqlHasMemberAt = example('mysql', (db) =>
  db
    .queryable(Profile)
    .where((p) =>
      MySQL.json(p.skills).hasMember('Vue', '$'),
    )
    .select((p) => p.userId)
    .toList(),
);

export const mysqlContainsPath = example('mysql', (db) =>
  db
    .queryable(Profile)
    .where((p) =>
      MySQL.json(p.skills).containsPath('$[2]', '$[3]'),
    )
    .select((p) => p.userId)
    .toList(),
);

export const mysqlContainsAllPaths = example(
  'mysql',
  (db) =>
    db
      .queryable(Profile)
      .where((p) =>
        MySQL.json(p.skills).containsAllPaths(
          '$[0]',
          '$[1]',
        ),
      )
      .select((p) => p.userId)
      .toList(),
);

// ---- MySQL：全文检索

export const mysqlMatch = example('mysql', (db) =>
  db
    .queryable(Post)
    .where((p) => MySQL.match(p.title).against('缓存'))
    .select((p) => p.title)
    .toList(),
);

export const mysqlMatchColumns = example('mysql', (db) =>
  db
    .queryable(Profile)
    .where((p) =>
      MySQL.match(p.bio, p.website).against('后端'),
    )
    .select((p) => p.userId)
    .toList(),
);

export const mysqlMatchBoolean = example('mysql', (db) =>
  db
    .queryable(Post)
    .where((p) =>
      MySQL.match(p.title).against(
        '+mysql -redis',
        'boolean',
      ),
    )
    .select((p) => p.title)
    .toList(),
);

export const mysqlMatchExpansion = example('mysql', (db) =>
  db
    .queryable(Post)
    .where((p) =>
      MySQL.match(p.title).against('数据库', 'expansion'),
    )
    .select((p) => p.title)
    .toList(),
);

export const mysqlScore = example('mysql', (db) =>
  db
    .queryable(Post)
    .where((p) => MySQL.match(p.title).against('缓存'))
    .orderBy((p) =>
      MySQL.match(p.title).score('缓存').desc(),
    )
    .select((p) => ({
      title: p.title,
      score: MySQL.match(p.title).score('缓存'),
    }))
    .toList(),
);

// ---- SQL Server

export const mssqlContains = example('mssql', (db) =>
  db
    .queryable(Post)
    .where((p) => MsSql.contains(p.title, '"缓存*"'))
    .select((p) => p.title)
    .toList(),
);

export const mssqlFreetext = example('mssql', (db) =>
  db
    .queryable(Comment)
    .where((c) => MsSql.freetext(c.body, '性能优化'))
    .select((c) => c.body)
    .toList(),
);

export const mssqlInSelect = example('mssql', (db) =>
  db
    .queryable(Post)
    .select((p) => ({
      title: p.title,
      hit: MsSql.contains(p.title, '"缓存*"'),
    }))
    .toList(),
);

export const mssqlDataLength = example('mssql', (db) =>
  db
    .queryable(Post)
    .where((p) => MsSql.dataLength(p.title).gt(40))
    .select((p) => ({
      title: p.title,
      bytes: MsSql.dataLength(p.title),
    }))
    .toList(),
);

// ---- SAP HANA

export const hanaContains = example('hana', (db) =>
  db
    .queryable(Post)
    .where((p) => Hana.text(p.title).contains('缓存'))
    .select((p) => p.title)
    .toList(),
);

export const hanaColumns = example('hana', (db) =>
  db
    .queryable(Profile)
    .where((p) =>
      Hana.text(p.bio, p.website).contains('后端 OR 前端'),
    )
    .select((p) => p.userId)
    .toList(),
);

export const hanaFuzzy = example('hana', (db) =>
  db
    .queryable(Post)
    .where((p) =>
      Hana.text(p.title).fuzzy('PostgreSQl', 0.8),
    )
    .select((p) => p.title)
    .toList(),
);

export const hanaScore = example('hana', (db) =>
  db
    .queryable(Post)
    .where((p) =>
      Hana.text(p.title).fuzzy('PostgreSQl', 0.8),
    )
    .orderBy((p) => Hana.text(p.title).score().desc())
    .select((p) => ({
      title: p.title,
      score: Hana.text(p.title).score(),
    }))
    .toList(),
);

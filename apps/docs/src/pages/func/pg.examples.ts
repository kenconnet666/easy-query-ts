/** PostgreSQL 专属函数的示例：在 PGlite 上真的执行。入口从 pglite 取，浏览器里不用 pg 驱动 */
import { sql } from '@zerodep-dev/easy-query-ts';
import { Pg } from '@zerodep-dev/easy-query-ts-pg/pglite';
import { example } from '../../site/example.ts';
import {
  Company,
  Post,
  Profile,
  User,
} from '../../site/model.ts';

// ---- JSONB

export const jsonbContains = example('pg', (db) =>
  db
    .queryable(Profile)
    .where((p) => Pg.jsonb(p.skills).contains('["Vue"]'))
    .select((p) => ({ userId: p.userId, skills: p.skills }))
    .toList(),
);

export const jsonbContainedBy = example('pg', (db) =>
  db
    .queryable(Profile)
    .where((p) =>
      Pg.jsonb(p.skills).containedBy(
        '["Vue", "CSS", "TypeScript", "SSR"]',
      ),
    )
    .select((p) => ({ userId: p.userId, skills: p.skills }))
    .toList(),
);

export const jsonbHasKey = example('pg', (db) =>
  db
    .queryable(Profile)
    .where((p) => Pg.jsonb(p.skills).hasKey('PostgreSQL'))
    .select((p) => ({ userId: p.userId, skills: p.skills }))
    .toList(),
);

export const jsonbHasAnyKey = example('pg', (db) =>
  db
    .queryable(Profile)
    .where((p) =>
      Pg.jsonb(p.skills).hasAnyKey('Vue', 'MySQL'),
    )
    .select((p) => ({ userId: p.userId, skills: p.skills }))
    .toList(),
);

export const jsonbHasAllKeys = example('pg', (db) =>
  db
    .queryable(Profile)
    .where((p) =>
      Pg.jsonb(p.skills).hasAllKeys('PostgreSQL', 'MySQL'),
    )
    .select((p) => ({ userId: p.userId, skills: p.skills }))
    .toList(),
);

export const jsonbPathExists = example('pg', (db) =>
  db
    .queryable(Profile)
    .where((p) =>
      Pg.jsonb(p.skills).pathExists(
        '$[*] ? (@ like_regex "^Post")',
      ),
    )
    .select((p) => ({ userId: p.userId, skills: p.skills }))
    .toList(),
);

export const jsonbPathMatch = example('pg', (db) =>
  db
    .queryable(Profile)
    .where((p) =>
      Pg.jsonb(p.skills).pathMatch('$.size() >= 3'),
    )
    .select((p) => ({ userId: p.userId, skills: p.skills }))
    .toList(),
);

export const jsonbThroughJoin = example('pg', (db) =>
  db
    .queryable(User)
    .where((u) => Pg.jsonb(u.profile.skills).hasKey('Vue'))
    .select((u) => ({
      name: u.name,
      company: u.company.name,
    }))
    .toList(),
);

export const jsonbInAny = example('pg', (db) =>
  db
    .queryable(Company)
    .where((c) =>
      c.users.any((u) =>
        Pg.jsonb(u.profile.skills).hasKey('SSR'),
      ),
    )
    .select((c) => c.name)
    .toList(),
);

// ---- 数组

export const arrayHas = example('pg', (db) =>
  db
    .queryable(Post)
    .where((p) =>
      Pg.array(
        sql<string[]>`string_to_array(${p.title}, ' ')`,
      ).has('MySQL'),
    )
    .select((p) => p.title)
    .toList(),
);

export const arrayHasAll = example('pg', (db) =>
  db
    .queryable(Post)
    .where((p) =>
      Pg.array(
        sql<string[]>`string_to_array(${p.title}, ' ')`,
      ).hasAll('MySQL', 'PostgreSQL'),
    )
    .select((p) => p.title)
    .toList(),
);

export const arrayHasAny = example('pg', (db) =>
  db
    .queryable(Post)
    .where((p) =>
      Pg.array(
        sql<string[]>`string_to_array(${p.title}, ' ')`,
      ).hasAny('N+1', 'TSX'),
    )
    .select((p) => p.title)
    .toList(),
);

export const arrayLength = example('pg', (db) =>
  db
    .queryable(Post)
    .where((p) => p.id.in([1, 4, 7]))
    .select((p) => ({
      title: p.title,
      words: Pg.array(
        sql<string[]>`string_to_array(${p.title}, ' ')`,
      ).length(),
    }))
    .toList(),
);

// ---- 全文检索

export const fulltextMatches = example('pg', (db) =>
  db
    .queryable(Post)
    .where((p) => Pg.fulltext(p.title).matches('mysql'))
    .select((p) => p.title)
    .toList(),
);

export const fulltextOrNot = example('pg', (db) =>
  db
    .queryable(Post)
    .where((p) =>
      Pg.fulltext(p.title).matches(
        'mysql or tsx -postgresql',
      ),
    )
    .select((p) => p.title)
    .toList(),
);

export const fulltextRank = example('pg', (db) =>
  db
    .queryable(Post)
    .where((p) =>
      Pg.fulltext(p.title).matches(
        'mysql or postgresql or tsx',
      ),
    )
    .orderBy((p) =>
      Pg.fulltext(p.title)
        .rank('mysql or postgresql or tsx')
        .desc(),
    )
    .select((p) => ({
      title: p.title,
      rank: Pg.fulltext(p.title).rank(
        'mysql or postgresql or tsx',
      ),
    }))
    .toList(),
);

export const fulltextConfig = example('pg', (db) =>
  db
    .queryable(Post)
    .where((p) =>
      Pg.fulltext(p.title, 'english').matches('joins'),
    )
    .select((p) => p.title)
    .toList(),
);

export const fulltextChinese = example('pg', (db) =>
  db
    .queryable(Post)
    .where((p) => Pg.fulltext(p.title).matches('入门'))
    .select((p) => p.title)
    .toList(),
);

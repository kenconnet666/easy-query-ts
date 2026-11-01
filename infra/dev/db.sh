#!/usr/bin/env bash
# 本仓库开发数据库的 docker compose 包装：首次运行时在 .local/ 生成密码、连接说明与实库测试的环境变量，之后原样转发参数。
# 在 WSL 里从仓库任意位置执行：bash infra/dev/db.sh up -d
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
local_dir="$root/.local"
env_file="$local_dir/db.env"

if [[ ! -f $env_file ]]; then
  mkdir -p "$local_dir"
  random() { od -An -N9 -tx1 /dev/urandom | tr -d ' \n'; }
  mysql_password="eqts$(random)"
  pg_password="eqts$(random)"
  # HANA 要求 16-64 位且含大小写和数字
  hana_password="Eqts$(random)9"
  # SQL Server 要求大小写、数字、符号
  mssql_password="Eqts$(random)9!"
  oracle_password="Eqts$(random)9"
  cat >"$env_file" <<EOF
EQTS_DEV_MYSQL_PASSWORD=$mysql_password
EQTS_DEV_PG_PASSWORD=$pg_password
EQTS_DEV_HANA_PASSWORD=$hana_password
EQTS_DEV_MSSQL_PASSWORD=$mssql_password
EQTS_DEV_ORACLE_PASSWORD=$oracle_password
# 实库测试读这几个变量：本地只跑 MySQL 8.4；要加 8.0.18（polardb profile）时逗号分隔追加 33318
EQTS_MYSQL_URLS=mysql://root:$mysql_password@127.0.0.1:33306/eqts
EQTS_PG_URLS=postgres://postgres:$pg_password@127.0.0.1:35432/eqts
EQTS_HANA_URL=hana://SYSTEM:$hana_password@127.0.0.1:39041
EQTS_MSSQL_URL=mssql://sa:$mssql_password@127.0.0.1:31433
EQTS_ORACLE_URL=oracle://eqts:$oracle_password@127.0.0.1:31521/FREEPDB1
EOF
  cat >"$local_dir/connections.md" <<EOF
# 本仓库的开发数据库连接（仅本机，勿提交）

| 库 | 地址 | 库名 | 用户 | 密码 |
|---|---|---|---|---|
| MySQL 8.0.18（PolarDB 基线，polardb profile） | 127.0.0.1:33318 | eqts | root | $mysql_password |
| MySQL 8.4 | 127.0.0.1:33306 | eqts | root | $mysql_password |
| PostgreSQL 17 | 127.0.0.1:35432 | eqts | postgres | $pg_password |
| HANA 2.00.088 租户 HXE（hana profile） | 127.0.0.1:39041 | - | SYSTEM | $hana_password |
| SQL Server 2022（mssql profile） | 127.0.0.1:31433 | eqts | sa | $mssql_password |
| Oracle 23ai Free（oracle profile） | 127.0.0.1:31521/FREEPDB1 | - | eqts | $oracle_password |

实库测试的环境变量在 .local/db.env（EQTS_*）。
启停：bash infra/dev/db.sh up -d ｜ bash infra/dev/db.sh --profile hana up -d ｜ bash infra/dev/db.sh stop
EOF
  echo "created $env_file and $local_dir/connections.md"
fi

# 后来加的库：已有的 db.env 里缺这个库的变量时补上（不动已有的密码）
# 用法：add_db 密码变量 '测试连接串，{p} 处换成密码'
add_db() {
  grep -q "^$1=" "$env_file" && return
  local password
  password="Eqts$(od -An -N9 -tx1 /dev/urandom | tr -d ' \n')9-"
  printf '%s=%s\n%s\n' "$1" "$password" "${2//\{p\}/$password}" >>"$env_file"
}
add_db EQTS_DEV_DAMENG_PASSWORD 'EQTS_DAMENG_URL=dm://SYSDBA:{p}@127.0.0.1:35236'
# 密码含大小写、数字与符号（openGauss 只认 #?!@$%^&*- 这几个符号；- 在连接串里不用转义）
add_db EQTS_DEV_OPENGAUSS_PASSWORD 'EQTS_OPENGAUSS_URL=postgres://gaussdb:{p}@127.0.0.1:35433/eqts'
add_db EQTS_DEV_CLICKHOUSE_PASSWORD 'EQTS_CLICKHOUSE_URL=http://eqts:{p}@127.0.0.1:38123/eqts'
# 连接串里有分号：值加单引号，source 时才不会拆开
add_db EQTS_DEV_DB2_PASSWORD "EQTS_DB2_URL='DATABASE=eqts;HOSTNAME=127.0.0.1;PORT=35000;PROTOCOL=TCPIP;UID=db2inst1;PWD={p}'"
add_db EQTS_DEV_MARIADB_PASSWORD 'EQTS_MARIADB_URL=mysql://root:{p}@127.0.0.1:33307/eqts'
add_db EQTS_DEV_REDIS_PASSWORD 'EQTS_REDIS_URL=redis://:{p}@127.0.0.1:36379/0'
grep -q '^EQTS_DORIS_URL=' "$env_file" || echo 'EQTS_DORIS_URL=mysql://root@127.0.0.1:39030/eqts' >>"$env_file"
grep -q '^EQTS_TDENGINE_URL=' "$env_file" || echo 'EQTS_TDENGINE_URL=ws://root:taosdata@127.0.0.1:36041/eqts' >>"$env_file"

exec docker compose -f "$here/compose.yaml" --env-file "$env_file" "$@"

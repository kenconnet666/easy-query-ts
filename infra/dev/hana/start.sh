#!/usr/bin/env bash
set -euo pipefail

password=${EQ_HANA_PASSWORD:?Set EQ_HANA_PASSWORD}
if [[ ! $password =~ ^[a-zA-Z0-9]{16,64}$ || ! $password =~ [a-z] || ! $password =~ [A-Z] || ! $password =~ [0-9] ]]; then
  echo 'HANA password must be 16-64 letters and digits with lower case, upper case and digits.' >&2
  exit 1
fi

# 启动完成后（run_hana 写出 /hana/.ready）再关两样 slim.sh 在启动前关不住的东西：
#   - web dispatcher：nameserver 每次启动都按拓扑把它的实例数写回 1
#   - 嵌入式统计服务：首次启动的初始化会把它打开（关掉之后的设置留在数据卷里，以后的启动不再打开）
trim() {
  local sql=/usr/sap/HXE/HDB90/exe/hdbsql
  until [[ -f /hana/.ready ]]; do sleep 2; done
  "$sql" -n 127.0.0.1:39017 -d SYSTEMDB -u SYSTEM -p "$1" \
    "ALTER SYSTEM ALTER CONFIGURATION ('daemon.ini','HOST','$(hostname)') SET ('webdispatcher','instances') = '0' WITH RECONFIGURE" >/dev/null
  "$sql" -n 127.0.0.1:39017 -d SYSTEMDB -u SYSTEM -p "$1" \
    "ALTER SYSTEM ALTER CONFIGURATION ('nameserver.ini','SYSTEM') SET ('statisticsserver','active') = 'false' WITH RECONFIGURE" >/dev/null
  echo 'eq: webdispatcher and the statistics service are off'
}
trim "$password" &

# SAP 入口脚本只接受 JSON 密码文件，放在私有 tmpfs 里，健康检查通过后删除
umask 077
printf '{"master_password":"%s"}\n' "$password" > /run/eq/password.json
unset password EQ_HANA_PASSWORD
exec /run_hana --passwords-url file:///run/eq/password.json --agree-to-sap-license

#!/usr/bin/env bash
# pre_start 钩子（每次启动、HANA 起来之前执行）：diserver（HDI 部署）测试用不到，把它的实例数写成 0，进程根本不启动。
# 直接改 daemon.ini：这时库还没起来，没法用 ALTER SYSTEM；hdbdaemon 启动时读到的就是改过的值。
# web dispatcher 与统计服务在这里关不住（启动过程会改回去），放在 start.sh 里等启动完成后关。
# 内存上限不在这里设：HANA 按容器的 cgroup 上限（compose 的 mem_limit）取 90%，限制只写在 compose 一处。
set -euo pipefail

# 把 ini 文件里 [section] 的 key 设成 value：有就改，没有就加在这一节里，连这一节都没有就加在文件末尾
set_ini() {
  local file=$1 section=$2 key=$3 value=$4
  touch "$file"
  awk -v section="[$section]" -v key="$key" -v value="$value" '
    # 节与节之间的空行先攒着：新加的键要写在空行前面
    function close_section() {
      if (inside && !done) { print key " = " value; done = 1 }
      printf "%s", blanks; blanks = ""
    }
    /^[ \t]*$/ { blanks = blanks $0 "\n"; next }
    /^\[/ { close_section(); inside = ($0 == section); print; next }
    inside && $0 ~ "^" key "[ \t]*=" { $0 = key " = " value; done = 1 }
    { printf "%s", blanks; blanks = ""; print }
    END { close_section(); if (!done) { if (NR > 0) print ""; print section; print key " = " value } }
  ' "$file" > "$file.eq" && cat "$file.eq" > "$file" && rm -f "$file.eq"
}

set_ini "$SAP_RETRIEVAL_PATH/daemon.ini" diserver instances 0
echo 'eq: diserver is off'

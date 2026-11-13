# SAP HANA Express 原样镜像，放进启动与健康检查脚本，并裁掉测试用不到的东西；基础镜像按 digest 固定，只在这里改。
ARG BASE_IMAGE=saplabs/hanaexpress:2.00.088.00.20251110.1@sha256:432be2785506e97cefc413f495393fc22fcdda034c2c80db2f0f88efeb16dfaf
FROM ${BASE_IMAGE}

COPY start.sh health.sh /eq/
# HANA 启动之前关掉用不到的服务，见 slim.sh
COPY --chown=hxeadm:sapsys --chmod=0755 slim.sh /hana/hooks/pre_start/900_eq_slim
# SAP 的首次启动钩子：配遥测、向 SAP 注册、整理数据卷，还会把统计服务和 diserver 重新打开——测试库都用不到
RUN rm /hana/hooks/post_start/201_hxe_optimize

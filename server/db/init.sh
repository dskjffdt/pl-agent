#!/bin/bash
# 数据库初始化脚本：docker-entrypoint-initdb.d 在首次启动时自动执行（仅执行一次）
# 创建应用专用账号（非超级用户）与业务库，实现权限最小化：应用被攻破也动不了系统库
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE USER plagent WITH PASSWORD '${APP_DB_PASSWORD}';
    CREATE DATABASE plagent OWNER plagent;
EOSQL

echo "init: 应用账号 plagent 与数据库 plagent 已创建"

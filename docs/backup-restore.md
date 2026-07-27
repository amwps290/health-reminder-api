# 备份与恢复

## 定期备份

建议每周从管理端“系统”页面导出一次 JSON，并在重大计划调整、D1 migration 或修改保留期限前额外
导出一次。CSV 用于人工核对，不替代 JSON 恢复文件。备份包含健康记录、计划、注射执行记录、通知
任务和投递历史；不包含任何 Worker Secret、Bark device key、高频调度明细或内部维护状态。

建议至少保留最近 4 份周备份和 3 份月备份，并将文件存放在受访问控制且有版本历史的位置。文件中
包含个人健康信息，不应放入 Git、公开网盘或聊天附件。

## 恢复 D1

1. 在当前环境先导出一份 JSON，作为恢复前快照。
2. 在“系统”页面选择目标 JSON。系统会验证格式版本、字段、记录数量、重复主键和主要外键。
3. 核对预览中的导出时间、业务时区以及每类数据的“当前/恢复后”数量。
4. 确认恢复。恢复会整体替换业务数据和通知历史；任一 D1 语句失败时整批回滚。
5. 刷新系统页，确认 Cron 最近一次成功、没有过期任务，并重新发送 Bark 测试。

不要从 CSV 自动恢复。CSV 的每行由数据表名和原始 JSON 记录组成，只用于审阅、检索或人工取证。

## 完整灾难恢复清单

- D1：创建或绑定目标数据库，应用 `worker/migrations`，再从管理端导入 JSON。
- `ADMIN_API_TOKEN`：重新写入 Worker Secret，用于管理端登录。
- `SESSION_SECRET`：重新生成并写入 Worker Secret；旧会话会自然失效。
- `BARK_DEVICE_KEY`：从 Bark App 或自建 Bark 服务重新取得并写入 Worker Secret。
- `BARK_BASIC_AUTH_USER` / `BARK_BASIC_AUTH_PASSWORD`：如 Bark 服务启用 Basic Auth，两项必须同时恢复。
- Worker Variables：核对 `APP_TIME_ZONE=Asia/Shanghai`、`BARK_BASE_URL`、任务窗口、重试次数和保留天数。
- Static Assets：运行 `corepack pnpm run build`，确认 `web/dist` 已生成后部署 Worker。
- Cron：确认触发器为每分钟一次，并观察至少两次连续成功运行。
- Bark：发送测试并在 iPhone 上人工确认展示。接口成功只表示 Bark 服务端接受，不证明 APNs 最终送达。

完成恢复后再删除恢复前快照或调整保留策略。

# 健康提醒项目开发方案

## 1. 目标与范围

本项目用于个人管理家人的服药、注射、孕周、孕期体重、挂号、检查、复诊、医嘱和就诊问题。Cloudflare Worker 同时提供业务 API、定时调度和响应式 Web 管理端，完成后由使用者进行远程 API、Web 页面与 iPhone Bark 真机测试。

MVP 的约束如下：

- 只有一个管理员，不提供公开注册和多账户登录。
- 默认只有一个被提醒成员，但数据模型保留扩展能力。
- 服药计划支持每天一个或多个固定时间点。
- 注射计划支持每隔指定天数执行，并按每次注射在左侧、右侧之间交替。
- 挂号、检查、复诊由管理员手动创建，可配置多个提醒时间。
- Bark 只做单向通知，不要求接收者确认。
- 不开发 Android 原生客户端。Web 管理端适配手机与桌面，并支持作为 PWA 添加到手机桌面。
- 业务时区固定为 `Asia/Shanghai`，服务端时间戳统一保存为 UTC。

## 2. 总体架构

```text
React Web 管理端（Worker 静态资源）
        | 同源 HttpOnly 会话
        v
health-reminder Worker + D1
        | POST /push
        v
bark.191315.xyz
        | APNs
        v
家人的 iPhone Bark
```

健康提醒 Worker 与 Bark Worker 分开部署。健康提醒 Worker 负责业务数据、任务生成、Cron 调度、失败重试和投递记录；现有 `bark-serverless` 只负责设备注册与 APNs 推送。

## 3. 仓库结构

```text
healthreminder/
|- worker/                 Cloudflare Worker 后端
|  |- src/api/             HTTP API
|  |- src/modules/         业务模块
|  |- src/scheduler/       任务生成与定时发送
|  |- src/integrations/    Bark 适配器
|  |- migrations/          D1 数据库迁移
|  `- test/                自动化测试
|- web/                    React/Vite 响应式管理端
|- docs/                   方案、API、部署和测试文档
`- README.md
```

后端采用 TypeScript、Hono、Zod、D1、Vitest 和 Wrangler。Web 端采用 React、Vite 和 TypeScript，由同一个 Worker 通过静态资源绑定提供。保持模块化单体结构，避免 MVP 阶段引入微服务、消息队列和独立认证服务。

## 4. 数据设计

| 数据表 | 用途 |
| --- | --- |
| `profiles` | 被提醒的家庭成员，MVP 自动创建一个默认成员 |
| `notification_targets` | 通知目标，MVP 使用 Bark，未来可扩展 FCM 等渠道 |
| `medications` | 药物、补充剂、剂量和服用说明 |
| `medication_schedules` | 起止日期、时区、周期类型和版本 |
| `medication_times` | 一天内一个或多个服用时间 |
| `medication_records` | 计划服用时间、已服用/跳过状态、实际服用时间和备注 |
| `injection_plans` | 注射名称、剂量、部位、间隔天数、时间和左右交替起始侧 |
| `injection_records` | 注射计划日期、完成/跳过/改期状态、实际时间和实际左右侧 |
| `events` | 挂号、检查、复诊和其他一次性事项 |
| `event_reminders` | 一个事件对应的多个提醒时间 |
| `medical_notes` | 医嘱原文、记录时间和来源 |
| `questions` | 就诊问题、状态和医生回答 |
| `pregnancy_settings` | 孕周校准日期、校准孕周和自动推算配置 |
| `weight_records` | 按日期保存的孕期体重和测量备注 |
| `notification_jobs` | 待发送、重试、已发送或已取消的通知任务 |
| `notification_deliveries` | Bark 请求结果和失败原因 |
| `scheduler_runs` | Cron 运行时间及处理统计 |
| `scheduler_daily_stats` | 清理调度明细前生成的长期按日统计 |

药物周期第一版只实现 `daily`。周期和来源均保留类型及版本字段，后续增加每周指定日期、隔天、每 N 小时或新提醒来源时，不需要重写投递核心。

## 5. 调度与可靠性

计划新增或修改时，Worker 生成未来 30 天的 `notification_jobs`。每日 Cron 会继续补足滚动窗口。每分钟 Cron 领取到期任务，调用 Bark，记录成功结果或按有限次数安排重试。

每个任务使用唯一去重键，例如：

```text
medication:{scheduleId}:{scheduleVersion}:2026-07-30T00:00:00.000Z
```

修改计划时增加版本，取消旧版本尚未发送的任务并生成新任务。任务领取使用带 claim token 的条件更新，降低 Cron 重叠造成的重复发送风险。由于 Bark/APNs 不提供端到端的幂等确认，系统采用“至少一次发送”语义：极端网络故障时允许极少数重复通知，以避免主动丢弃不确定的通知。

## 6. API 与安全

API 统一使用 `/api/v1`。首次登录时输入 `ADMIN_API_TOKEN`，Worker 验证后签发带签名、有效期有限的 `HttpOnly + Secure + SameSite=Strict` 会话 Cookie。Bark device key、Bark Basic Auth 和会话签名密钥均通过 Worker Secrets 注入，不写入 D1、浏览器存储或 Git。Bearer Token 仍保留给命令行手动测试。

主要接口：

```text
GET/POST/PUT/DELETE  /api/v1/medications
GET/POST             /api/v1/medications/:id/records
DELETE               /api/v1/medications/:id/records/:recordId
GET/POST/PUT/DELETE  /api/v1/injections
GET/POST             /api/v1/injections/:id/records
DELETE               /api/v1/injections/:id/records/:recordId
GET/POST/PUT/DELETE  /api/v1/events
GET/POST/PUT/DELETE  /api/v1/medical-notes
GET/POST/PUT/DELETE  /api/v1/questions
GET/PUT/DELETE       /api/v1/pregnancy
GET/POST/PUT/DELETE  /api/v1/weights
GET                  /api/v1/timeline
GET                  /api/v1/deliveries
GET                  /api/v1/backup/export?format=json|csv
POST                 /api/v1/backup/validate
POST                 /api/v1/backup/restore
POST                 /api/v1/notifications/test
POST                 /api/v1/notification-jobs/:id/retry
GET                  /api/v1/system/status
```

系统状态只有在最近一次 Cron 于 3 分钟内成功完成、没有过期或失败任务，并且 Bark 在最近 7 天
存在成功测试或投递时才返回 `healthy`；其余情况返回 `attention` 或 `unavailable`。Bark 成功仅表示
服务端接受请求，不代表 APNs 已经让 iPhone 展示通知。失败任务可由管理员手动重新排队。

系统页支持全量 JSON 与 CSV 导出。JSON 带格式版本和记录数量，可在恢复前校验字段、主外键和
记录数并预览替换范围；确认后以 D1 原子批处理恢复。CSV 用于人工审阅，不用于自动恢复。备份包含
业务数据、长期日统计、提醒任务和投递历史，但不包含 Worker Secrets、高频调度明细或内部维护状态。
具体操作和恢复清单见 [backup-restore.md](backup-restore.md)。

日志使用 request ID，并禁止输出令牌、Bark key、药名、剂量、医嘱和通知正文。

## 7. 开发阶段

| 阶段 | 内容 | 完成标准 |
| --- | --- | --- |
| Worker 1 | 工程初始化、D1 migration、鉴权、错误格式、健康检查 | 本地测试和类型检查通过 |
| Worker 2 | 药物、事件、医嘱、问题 CRUD | API 测试覆盖新增、修改、停用和删除 |
| Worker 3 | 任务生成、Cron、Bark 适配器、重试与去重 | 模拟时间测试及 Bark 测试接口通过 |
| Worker 4 | 日志脱敏、部署配置、API 文档和测试手册 | 可部署到 `health.191315.xyz` |
| Web 1 | React/Vite、同源会话、响应式导航 | 手机和桌面均可登录及查看状态 |
| Web 2 | 今日、提醒、就诊、医嘱和问题页面 | 可完成全部 CRUD 操作 |
| Web 3 | PWA 元数据、错误状态、表单校验和生产构建 | Worker 可直接提供完整管理页面 |
| 统一验收 | 使用者进行远程 API、Web 和 Bark 真机测试 | 使用者明确确认 MVP 通过 |

## 8. 后续扩展

- 新周期规则通过新的任务生成器实现。
- FCM、邮件等渠道通过 `NotificationChannel` 适配器实现。
- 多个家庭成员使用现有 `profiles` 关系扩展。
- 未服药升级提醒可基于 `medication_records` 的缺失记录扩展，不与 Bark 投递状态混用。
- 检查报告等附件存入 R2，不直接存入 D1。
- 未来如需原生客户端，可继续复用 `/api/v1`，无需修改调度器。
- 后续增加加密备份存储、自动异地归档和更细粒度的审计查询。

本软件只记录和执行人工输入的医嘱，不自行推荐孕期剂量、判断药物相互作用或给出漏服后的补服建议。

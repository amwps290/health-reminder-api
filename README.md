# Health Reminder

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/amwps290/healthreminder)

个人健康提醒工具。支持服药、间隔注射、注射部位左右交替、孕周校准与孕期体重增长曲线。Cloudflare Worker + D1 负责数据和调度，通过自建 Bark 服务向 iPhone 单向推送，并由同一个 Worker 提供响应式 Web 管理端。

详细方案见 [docs/development-plan.md](docs/development-plan.md)。

Cloudflare 自动部署见 [docs/cloudflare-deploy.md](docs/cloudflare-deploy.md)。

本地排查 Bark 推送时，可在 `.dev.vars` 中设置 `BARK_DEBUG=true`。Worker 会输出结构化的请求阶段、HTTP 状态、Bark 返回码、错误消息与耗时，但不会记录 Device Key、Basic Auth、通知标题或正文。生产环境默认不输出成功请求的调试日志，失败日志仍会保留诊断信息。

管理端“系统”页面可以导出完整 JSON/CSV 备份，并在校验和预览后从 JSON 恢复。备份包含健康记录、提醒计划和投递历史，但不包含 Worker Secrets；操作步骤见 [备份与恢复说明](docs/backup-restore.md)。Cron 每日先按天聚合再清理超过 30 天的调度运行明细，并清理超过 365 天且已经发送或取消的通知历史。失败和待处理任务不会被自动删除。

> Cloudflare Deploy Button 目前要求源仓库是 GitHub/GitLab 的公开仓库。

## 目录

- `worker/`: Cloudflare Worker 后端
- `web/`: React/Vite Web 管理端
- `docs/`: 开发、部署和测试文档

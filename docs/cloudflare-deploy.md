# Cloudflare 自动部署

本项目只使用 Cloudflare Workers Builds 部署。Cloudflare 连接 GitHub 仓库后，每次推送到生产分支都会自动构建、迁移 D1 并发布 Worker，无需配置 GitHub Actions 或 Cloudflare API Token。

## 首次部署

公开仓库可以直接使用 README 顶部的 `Deploy to Cloudflare` 按钮。已有 Worker 也可以在 Cloudflare 控制台的 `Settings` -> `Builds` 中连接 GitHub 仓库。

构建配置如下：

| 配置 | 值 |
| --- | --- |
| Git repository | `amwps290/healthreminder` |
| Production branch | `main` |
| Root directory | `/` |
| Build command | `npm run build` |
| Deploy command | `npm run deploy` |

根目录的 `deploy` 脚本会先对 `DB` 绑定执行尚未应用的 D1 migrations，再部署 Worker 和 Web 静态资产。已执行的迁移不会重复运行。

## Cloudflare 资源

在 Worker 的 `Settings` -> `Bindings` 中确认存在以下绑定：

| 类型 | 变量名 | 资源 |
| --- | --- | --- |
| D1 database | `DB` | 现有的 `health-reminder` 数据库 |

在 `Settings` -> `Variables and Secrets` 中配置：

| 名称 | 类型 | 用途 |
| --- | --- | --- |
| `ADMIN_API_TOKEN` | Secret | 管理端登录令牌 |
| `SESSION_SECRET` | Secret | HttpOnly 会话签名密钥 |
| `BARK_DEVICE_KEY` | Secret | Bark 设备 key |
| `BARK_BASIC_AUTH_USER` | Secret，可选 | Bark Basic Auth 用户名 |
| `BARK_BASIC_AUTH_PASSWORD` | Secret，可选 | Bark Basic Auth 密码 |
| `BARK_BASE_URL` | Variable | 自建 Bark 服务地址 |

Basic Auth 用户名和密码必须同时配置，未启用时两项都不要添加。

## 更新部署

完成修改后推送到 `main`：

```powershell
git push origin main
```

Cloudflare Workers Builds 会自动拉取最新提交并运行构建和部署命令。可以在 Worker 的 `Deployments` 或 `Builds` 页面查看提交、D1 迁移和部署日志。

部署成功后先访问 `/healthz`，确认返回 `ok`，再登录管理端测试 Bark 通知。

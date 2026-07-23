# 四站统一 SSO 设计

## 目标

让主站 `qy-dianshangjiqiren` 中已获访问权限的用户自动登录以下四个独立应用：

- `xhstw.qycm.top`（`zxc9802/xhstw`）
- `xiaoshou.qycm.top`（`zxc9802/xiaoshou`）
- `sabc.qycm.top`（`zxc9802/sabc`）
- `baokuangaixie.qycm.top`（`zxc9802/baokuangaixie`）

“已获访问权限”沿用主站现有规则：管理员或 `accessGrantedAt` 已设置的用户。四个子站不维护独立准入名单。

## 不在范围内

- 不共享主站数据库、密码、Cookie 或长期密钥。
- 不迁移四个应用已有的 IndexedDB、本地文件、业务记录或模型配置。
- 不改变主站以外的既有业务 API 语义。

## 选定协议

采用服务端一次性 ticket 换票，替代跨子域 Cookie 和 URL 长期 JWT。

1. 主站首页入口调用 `POST /api/external-sso/:product/start`。
2. 主站校验当前登录用户及访问权限，在既有 `video_sso_tickets` 表创建 `product` 绑定、60 秒过期、只能使用一次的 ticket。
3. 主站 302 跳转到产品固定的 HTTPS 回调地址，例如 `https://xhstw.qycm.top/api/sso/callback?ticket=<ticket>`。
4. 子站回调仅从环境变量读取主站地址和本产品客户端密钥；不信任 URL 中的主站地址。
5. 子站服务端将 ticket 与 `x-qycm-sso-client-secret` 请求头发给 `POST {MAIN_APP_URL}/api/external-sso/:product/exchange`。
6. 主站以 timing-safe 比较验证该产品客户端密钥，验证 ticket 产品、过期、未使用状态及用户权限，并原子标记 ticket 已使用。
7. 主站返回最小用户资料、受主站签名的短期 token 与安全的站内 `redirectPath`。
8. 子站把 token 和用户资料封装为自身 HttpOnly、Secure、SameSite=Lax、加密且签名的会话 Cookie，再重定向到站内路径。
9. 每个受保护请求由子站服务端用会话中的主站 token 调用 `GET {MAIN_APP_URL}/api/sso/session`。校验失败时清除子站会话并重定向到主站登录入口。

ticket 只出现在一次 HTTPS 回调 URL 中；主站 token 永不暴露给浏览器 JavaScript。

## 主站改动

在 `zxc9802/qy-dianshangjiqiren` 中新增通用产品注册表和两类路由：

| 产品 | 产品键 | 子站回调 URL | 主站环境变量 |
| --- | --- | --- | --- |
| 小红书图文自动生成 | `xhstw` | `https://xhstw.qycm.top/api/sso/callback` | `SSO_XHSTW_CLIENT_SECRET` |
| 销转智能体 | `xiaoshou` | `https://xiaoshou.qycm.top/api/sso/callback` | `SSO_XIAOSHOU_CLIENT_SECRET` |
| SABC 项目评级智能体 | `sabc` | `https://sabc.qycm.top/api/sso/callback` | `SSO_SABC_CLIENT_SECRET` |
| 爆款改写智能体 | `baokuangaixie` | `https://baokuangaixie.qycm.top/api/sso/callback` | `SSO_BAOKUANGAIXIE_CLIENT_SECRET` |

- `start` 只接受已登录的主站用户；`redirectPath` 必须是以单个 `/` 开头的站内路径。
- `exchange` 只接受 JSON `{ ticket }` 和匹配产品的客户端密钥；不返回密码或数据库字段。
- 现有首页四个外链入口改为调用对应 `start` 路由，登录后直接进入目标站的 SSO 回调。
- `sso-client-cors` 仅为确有浏览器请求的现有应用保留；新回调采用服务端换票，不依赖浏览器跨域 CORS。

## 子站改动

四个仓库都增加同一组职责，但按各自技术栈实现：

| 仓库 | 技术栈 | 入口保护 |
| --- | --- | --- |
| `xhstw` | Next.js 15 | `/api/sso/callback` 负责换票和设 Cookie；middleware 放行回调与静态资源，其余页面转主站 SSO。 |
| `xiaoshou` | Vite + Fastify | Fastify 增加回调、会话解析与 `/api/v1` preHandler；Vite 页面只调用已受保护的 API。 |
| `sabc` | Next.js 16 | Route Handler 换票设 Cookie；middleware 保护评估页面、报告页和 API。 |
| `baokuangaixie` | Next.js 16 | Route Handler 换票设 Cookie；middleware 保护选题、产品、脚本与 API。 |

每个子站新增以下未提交的部署变量：

```dotenv
MAIN_APP_URL=https://www.qycm.top
MAIN_APP_SSO_EXCHANGE_URL=https://www.qycm.top/api/external-sso/<product>/exchange
MAIN_APP_SSO_CLIENT_SECRET=<与主站该产品变量匹配>
APP_SESSION_SECRET=<该子站独有的随机密钥>
```

子站回调必须拒绝缺失 ticket、主站换票失败、用户资料缺失、无效签名和跨站 `redirectPath`。任何失败均不能留下局部登录状态。

## 会话与撤销

- ticket 有效期固定 60 秒，换票成功后不可重放。
- 子站 Cookie 只对自己的 host 有效，不设置 `.qycm.top` 域。
- 子站每次服务端校验主站会话；主站撤销访问权限或令牌失效后，子站在下一次请求清除本地会话。
- 登出只清理当前子站 Cookie；主站登出或撤权通过主站会话校验传播。

## 测试与验收

主站测试覆盖：

- 无主站登录、无访问权限、错误产品密钥、错误产品 ticket、过期 ticket、重复 ticket。
- 成功换票只返回允许字段，并将 ticket 标记为已使用。
- 首页四个入口调用正确的 `start` 端点和 HTTPS 回调。

子站测试覆盖：

- 正确 ticket 换票后设置 HttpOnly Secure Cookie 并跳转站内首页。
- 换票失败时不设 Cookie。
- 缺失或失效会话拒绝受保护页面/API。
- 主站会话检查失败时清除 Cookie 并进入主站登录流程。

最终验收按四站分别执行：主站已授权用户从首页进入无需二次登录；未授权用户和已撤权用户不能进入；每个站的业务数据仍与其他站隔离。

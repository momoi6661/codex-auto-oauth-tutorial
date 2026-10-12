# 如何在 Codex 中自动完成 OAuth 授权

[English](README.md)

独立教学项目，已包含从 Sub2API runner 提取的完整协议模块。
`npm run authorize` 接到 `src/reference-core/`，按配置授权已有账号：

```text
读取配置 -> IMAP 记录 UID 起点 -> OAuth/PKCE -> 提交邮箱 -> 请求/读取验证码
-> 校验验证码 -> 团队/个人空间授权 -> 校验回调 state
-> Token 交换 -> 检查身份 -> 保存授权 JSON
```

可读参考是 Wenfxl-Codex-Manager-v18.2.0 的 OAuth-only 和邮箱流程。
这里是我们在 runner 中开发的独立实现，不是闭源 auth_core 的源码移植，
也不包含其编译扩展。[来源和改动](src/reference-core/NOTICE.md)。

## 安装与使用

需要 Node.js 22+（推荐 24）、Python 3.10+。在项目目录执行：

```powershell
npm ci
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

填写 .env 中已有账号的登录邮箱、接收验证码的 IMAP 邮箱、用户名、应用专用密码
和实际收件地址。Windows 设置 `CURL_CFFI_PYTHON=.venv/Scripts/python.exe`。
Linux/macOS 用 `.venv/bin/python -m pip install -r requirements.txt` 安装，
并设置 `CURL_CFFI_PYTHON=.venv/bin/python`。

```powershell
npm test
npm run authorize
```

授权命令会发起真实登录，可能发送邮件。成功后保存 codex-auth.json，格式沿用
runner 的平铺授权文件，不会覆盖 Codex 应用自己的授权文件。不要把 .env、
邮箱密码、验证码和 Token 文件提交到 Git、发给 AI 或贴到 issue。

## 配置字段

| 字段 | 含义 |
| --- | --- |
| LOGIN_EMAIL | 要授权的已有 OpenAI/Codex 账号，不创建新账号 |
| IMAP_HOST / IMAP_PORT | TLS IMAP 服务，默认端口 993 |
| IMAP_USER / IMAP_PASSWORD | 收信邮箱用户名、应用专用密码，不是 Codex 密码 |
| IMAP_FOLDER | 验证码文件夹，默认 INBOX |
| MAILBOX_ADDRESS | 实际收件邮箱，支持转发改写 |
| OTP_PATTERN | 正则第一个捕获组为验证码 |
| OTP_SENDER | 可选的精确发件人邮箱过滤 |
| MAILBOX_WAIT_SECONDS | 收信等待 30–180 秒，默认 90 |
| EMAIL_RESEND_SECONDS | 等待 10–90 秒后重发一次，默认 30 |
| WORKSPACE_INDEX | 0 选个人；1 及以上按可用团队列表顺序选 |
| EXPECTED_ACCOUNT_ID | 可选：重新授权时的旧工作区 ID |
| AUTH_PROXY_URL | OAuth/Sentinel 的 HTTP/HTTPS/SOCKS 代理，空值直连 |
| CURL_CFFI_PYTHON | 安装了 curl_cffi 的 Python 路径 |
| OUTPUT_FILE | 输出文件，默认 codex-auth.json |

本机代理示例：`AUTH_PROXY_URL=http://127.0.0.1:7890`。
OAuth 和 Sentinel 共用代理和会话，IMAP 仍直连。传输模块不继承系统代理变量，
需要显式填写 AUTH_PROXY_URL。

## 提取的核心模块

| src/reference-core 中的模块 | 作用 |
| --- | --- |
| protocol-auth.mjs | PKCE、登录、验证码发送/重发/校验、空间授权、回调、Token 交换和身份检查 |
| imap-code.mjs | 只读 IMAP、UIDNEXT/UIDVALIDITY、投递时间、收件人/转发地址过滤 |
| curl-cffi-fetch.mjs / curl-transport.py | 每个任务独立的 Python curl 会话、Chrome 142 TLS 配置 |
| sentinel.mjs / sentinel-runtime.mjs | 固定版本 SDK 适配，每个受保护请求生成新证据 |
| consent-form.mjs | 解析表单和 React Router 工作区数据，不执行页面脚本 |
| executor.mjs / script-process.mjs | 有超时和取消的邮箱子进程，已去掉自定义脚本 |
| proxy-url.mjs / browser-profile.mjs | 代理标准化、浏览器特征一致性 |
| index.mjs | 导出入口 |

src/task.mjs 将配置转换为核心协议的任务参数，接入其他项目时：

```js
import { loadConfig } from './src/config.mjs'
import { buildTask } from './src/task.mjs'
import { authorizeWithProtocol, executeScript } from './src/reference-core/index.mjs'

const result = await authorizeWithProtocol(
  buildTask(loadConfig()), executeScript, AbortSignal.timeout(600_000),
  step => console.log(step)
)
// 返回 auth_file 或 error；不要打印 result.auth。
```

较短的 pkce.mjs、mailbox.mjs、protocol.mjs、workspace.mjs 是入门拆解。
简化 protocol 在 consent 阶段停止，不是默认命令调用的实现。完整流程和收信
隔离应参考 reference-core。

## 自动回退个人账号

默认 1 优先使用第一个可用团队；0 明确选个人，即使团队存在。
没有可用团队时，使用上游提供的个人空间；若个人账号只有 Continue 表单、
没有空间选择器，就直接提交该表单，不继续寻找不存在的团队 ID。

重新授权时先查 EXPECTED_ACCOUNT_ID。原团队消失且只剩个人空间时，允许回退。
Token 邮箱必须仍匹配登录邮箱，账号 ID 必须匹配本次选择的空间；
合法回退后不能再用旧团队 ID 拒绝新的个人 ID。
团队仍存在时，越界序号会报错，不静默换到其他团队。

## 提交邮箱后不发送验证码

邮箱 body 只有：

```json
{ "username": { "value": "owner@example.com", "kind": "email" } }
```

这次集成时补上的关键缺失项是 **openai-sentinel-token 请求头**，不是 JSON 参数。
完整模块为提交邮箱、发送验证码、重发、校验生成新证据，保持同一个设备 ID、
Cookie 和代理；SDK 提供观察器证据时还发送 openai-sentinel-so-token。
不能写死，也不能跨账号复用。原实现后来移除了 screen_hint: login，
不能把缺少它写成不发邮件的原因。

代码和 mock 测试证明证据已接入请求，不能仅凭这些证明所有历史投递失败都由
同一个请求头造成。HTTP 200 不代表邮件已投递。
密码页使用 /api/accounts/passwordless/send-otp；验证码页等待到配置时间后
调用 /api/accounts/email-otp/resend 一次，保留原 UID 起点和收信任务。
成功状态中的 HTML 错误页不会被当成已发送。

## 收信和失败处理

- 先记录 UID 再触发邮件，避免验证码先到达却被后建的起点漏掉。
- 按服务器投递时间过滤，UIDVALIDITY 改变时停止，避免复用旧代码。
- 检查 To、Cc、Delivered-To、X-Original-To 等地址，支持转发改写；共享投递
  地址不能覆盖另一个明确的登录收件人。
- 邮箱子进程上限 190 秒，覆盖最长等待，避免外层 30 秒提前截断。
- 最多重发一次，失败不会循环发送。Ctrl+C 取消，总上限 10 分钟。
- 缺少空间列表时检查 consent 表单/loader，不编造个人 ID。
- 邮箱或本次选定的账号 ID 不匹配时丢弃结果。注册、手机验证、MFA、
  未满足的安全挑战停止并人工处理。

## 交给 AI 使用

> 先读 README_CN.md、src/task.mjs 和 src/reference-core，使用完整模块，
> 不要把停在 consent 的入门示例当成完整授权器。state、verifier、Cookie、
> 设备 ID 和邮箱 UID 起点只属于当前任务。为每个请求生成新证据，不写死 Token。
> 只选上游提供的空间；无团队时走个人空间或个人授权表单。Token 交换后核对
> 登录邮箱和本次空间 ID。不要输出密码、验证码和 Token。保留只读收信、
> 一次重发、取消和超时。遇到注册、MFA、手机验证或未知安全挑战停止。
> 运行测试，区分本地测试、真实授权和 GitHub 推送状态。

## 验证和限制

npm test 包含原流程的协议、Sentinel、consent、邮箱、代理测试及本项目配置测试。
所有 provider/SDK 响应为模拟数据，不发送真实邮件。
安装 Python 依赖后可运行 `npm run test:transport`，检查本地 Python 传输桥。

本独立仓库尚未做真实账号授权验收。SDK 适配固定版本 20260219f9f6，
上游 SDK/接口改变时可能需要更新；不支持的 SDK 或未满足的挑战会停止，
不伪造成功。不包含面板、账号数据库、注册、自定义脚本、自动队列或重试循环。

## 许可证

原创教学/CLI 文件为 MIT。提取模块和适配的原测试沿用 LGPL v3。
原许可证、GPL 文本和来源记录在 src/reference-core，分发时请保留。

# 如何在 Codex 中自动完成 OAuth 授权

这是一个独立的教学项目，拆出了 Codex 一键授权的核心流程：

```text
配置邮箱 -> 创建 OAuth/PKCE 会话 -> 提交登录邮箱 -> IMAP 读取验证码
-> 校验验证码 -> 选择工作区 -> 换取 OAuth Token -> 保存授权文件
```

它不依赖面板，也不包含账号数据库、注册流程或自动绕过安全挑战的逻辑，
适合给开发者或 AI 参考授权流程。

## 使用方法

1. 安装 Node.js 20 或更高版本。
2. 复制 `.env.example` 为 `.env`。
3. 填写已有 Codex 账号邮箱、IMAP 地址、IMAP 用户名和邮箱应用专用密码。
4. 执行 `npm install` 和 `npm test`。
5. 执行 `npm run authorize` 查看授权流程。

当前示例会在 provider 的 consent 页面停止。真实接入时，需要根据当时返回的
页面读取工作区列表，再提交工作区 ID 并完成 token exchange；不能凭空猜 ID。

## 邮箱配置

`LOGIN_EMAIL` 是要授权的已有账号。`IMAP_HOST`、`IMAP_USER` 和
`IMAP_PASSWORD` 是接收验证码的邮箱配置，不是 Codex 登录密码。优先使用邮箱
服务商提供的应用专用密码。

读取器会：

- 记录授权开始前的 UID 边界；
- 以只读模式打开 IMAP；
- 过滤授权开始时间之后的新邮件；
- 检查 To、Cc、Delivered-To 等收件人；
- 按 `OTP_PATTERN` 提取验证码。

## 工作区和个人空间自动回退

`WORKSPACE_INDEX` 的含义：

- `0`：明确选择个人空间；
- `1` 及以上：按 consent 页面返回的团队工作区顺序选择。

如果配置为 `1`，但当前账号没有任何团队工作区，代码会自动回退到返回列表中
标记为个人空间的工作区。它不会伪造个人空间 ID，也不会切换到另一个账号。

核心逻辑在 `src/workspace.mjs`：

```js
chooseWorkspace(workspaces, { index: 1 })
```

重新授权已有账号时，可以设置 `EXPECTED_ACCOUNT_ID`。如果当前 consent 列表中
找不到这个 ID，流程应该停止并报告错误，不能静默使用其他账号。

## 验证码不发送的排查

初始邮箱请求的 body 只有：

```json
{
  "username": { "value": "owner@example.com", "kind": "email" }
}
```

`screen_hint: "login"` 不是已经证实的修复；原实现后来明确移除了它。当前最有
证据支持的遗漏是 `openai-sentinel-token` 请求头。它不是 body 参数，而是每个受
保护请求动态生成的安全凭证。请求还必须保持同一个：

- `oai-device-id`；
- OAuth 会话 Cookie；
- `openai-sentinel-token`；
- provider 要求挑战时的 `openai-sentinel-so-token`。

这些值不能写死，也不能跨账号复用。HTTP 200 只说明请求被接受，不代表邮件已经
投递。还要确认是否调用了 `passwordless/send-otp`，并检查邮箱垃圾箱、过滤器和
收件人别名。

## 给 AI 的使用说明

可以把下面的要求交给 AI：

> 先阅读 `.env.example`、`src/protocol.mjs`、`src/mailbox.mjs` 和
> `src/workspace.mjs`。保持 OAuth state、PKCE verifier、Cookie、设备 ID 和
> 邮箱 UID 边界只属于当前任务。不要输出密码、Cookie、验证码、access token
> 或 refresh token。工作区必须使用 consent 页面返回的 ID；没有团队空间时按
> `chooseWorkspace` 自动回退个人空间。遇到注册、CAPTCHA、MFA、手机号验证或
> 未知页面时停止并报告，不要伪造成功。最后区分本地测试、真实授权和部署状态。

## 常见问题

- **收不到邮件**：对比完整请求头，重点检查 Sentinel token、设备 ID、Cookie 和
  `passwordless/send-otp`；不要只看 HTTP 200。
- **找不到验证码**：检查 IMAP 文件夹、服务器时间、转发地址和垃圾邮件；不要读
  授权开始前的旧验证码。
- **没有团队空间**：使用 `WORKSPACE_INDEX=1`，代码会回退个人空间；`0` 表示
  明确只选个人空间。
- **403 或安全挑战**：停止并改为人工授权。本项目不绕过 provider 安全验证。
- **账号不一致**：验证邮箱或账号 ID 不匹配时丢弃结果，不写入授权文件。

## 范围

本项目可以直接作为代码和流程参考，但不是无需适配即可用于生产的完整授权器。
Provider 的 consent 页面、Sentinel 生成和 token exchange 可能变化，发布贡献前
应先用 mock 测试，再做一次受控的真实授权验证。

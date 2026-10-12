# 模块边界与许可证

**中文** | [English](NOTICE_EN.md)

本目录的协议核心及对应测试使用 LGPL v3；完整 LGPL 文本保留在 `LICENSE`，其包含的 GPL 文本在 `COPYING`。根目录 MIT 许可证适用于独立教学文件和 UI/CLI 适配层，不将这些核心模块重新许可为 MIT。

独立执行链保留 OAuth/PKCE、IMAP 验证码、curl_cffi 传输、Sentinel、consent、工作区回退及身份检查。`script-process.mjs` 只接受 IMAP 任务，去除了自定义脚本执行、直接返回自定义授权文件及其专用代理适配。`executeScript` 名称仅用于调用接口兼容。`index.mjs` 是独立导出入口。

项目不包含面板、数据库、账号批处理、任务队列和编译的 `auth_core`。

Sentinel SDK 在运行时下载，没有打包在仓库中。测试中的 `sentinel-fixture.mjs` 仅模拟 SDK 行为，不能生成真实服务的授权凭据，也不用于真实请求。

分发时请保留适用的许可证文本，并遵守修改和分发对应模块的许可证要求。

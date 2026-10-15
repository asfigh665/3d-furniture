# 上线检查记录

2026-10-15，首轮部署。

- GitHub：`https://github.com/asfigh665/3d-furniture`，`main` 已推送。
- 服务器：`139.199.89.115`，独立 systemd 服务 `furniture` 已启动并启用开机自启。
- Nginx：独立站点 `furniture.zhenpinfa.cn`，静态页面及 `/api` 代理已配置。
- 从外网使用指定 IP 的域名请求，首页 HTTP 200，健康端点返回演示模式。
- 部署实例的语言修改、版本保存/读取/删除已通过实际 HTTP 验证。
- 服务器已有 admin、test、vip 网站均仍返回 HTTPS 200。
- 本地 16 项后端测试、4 项前端测试及生产构建通过。
- 服务端密钥文件权限为 `600 root:root`，应用仅监听 `127.0.0.1:8787`。
- DeepSeek 官方 URL 和 `deepseek-flash` 已预设；等待用户输入真实 API Key，尚未做真实模型鉴权。

## 当前域名阻塞

截至本轮检查，DNSPod 权威服务器 `pub.dnspod.net`、Google、Cloudflare 以及服务器解析均返回 `furniture.zhenpinfa.cn` 的 NXDOMAIN，权威结果没有 A 记录。因此正常域名访问和 HTTPS 签发尚未完成；这不是应用服务故障，也不能仅按传播延迟视为已经上线。

需要在 `zhenpinfa.cn` 的有效 DNS 区域添加并启用主机记录 `furniture`、类型 A、值 `139.199.89.115`。解析正确后，服务器的 `furniture-https.timer` 会自动完成证书签发和 HTTP 至 HTTPS 跳转。

检查待办：公共 DNS 返回预期 IP、HTTPS 证书有效、HTTPS 页面和同源 API 请求通过。

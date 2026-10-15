# 上线检查记录

2026-10-15 15:04（北京时间），部署完成并通过外网验证。

- GitHub：`https://github.com/asfigh665/3d-furniture`，`main` 已推送。
- 服务器：`139.199.89.115`，独立 systemd 服务 `furniture` 已启动并启用开机自启。
- Nginx：独立站点 `furniture.zhenpinfa.cn`，静态页面及 `/api` 代理已配置。
- 公共 DNS、DNSPod 权威解析均返回 `139.199.89.115`。
- 从外网正常解析访问：首页 HTTPS 200，HTTP 301 跳转至 HTTPS，证书校验通过。
- 部署实例的语言修改、版本保存/读取/删除已通过实际 HTTP 验证。
- 服务器已有 admin、test、vip 网站均仍返回 HTTPS 200。
- 本地 16 项后端测试、4 项前端测试及生产构建通过。
- 服务端密钥文件权限为 `600 root:root`，应用仅监听 `127.0.0.1:8787`。
- 用户已配置 DeepSeek API Key；健康端点返回 `mode:ai`、`provider:api.deepseek.com`、`model:deepseek-flash`。
- HTTPS 同源语言修改请求成功，台面材质修改为洞石。
- Let's Encrypt 证书已签发，当前有效期至 2027-01-13，现有 Certbot 定时器负责自动续期。
- 初次签发检查定时器 `furniture-https.timer` 已在成功后自动关闭。

## DNS 问题处理记录

首次部署时，DNSPod 权威服务器 `pub.dnspod.net`、Google、Cloudflare 以及服务器解析均返回 NXDOMAIN。用户重新配置腾讯云解析后，记录生效。

首次签发时证书机构的次级验证节点仍保留旧的 DNS 缓存；等待缓存到期后重试成功。

已完成：公共解析、证书签发、HTTPS 页面、HTTP 跳转、HTTPS 同源 API 请求。

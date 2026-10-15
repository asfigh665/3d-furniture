# 服务器部署

项目仓库：https://github.com/asfigh665/3d-furniture

目标站点：https://furniture.zhenpinfa.cn ，服务器 `139.199.89.115`（Ubuntu 22.04）。

## 运行方式

- Nginx 提供构建后的静态页面，将 `/api/` 反向代理至 `127.0.0.1:8787`。
- systemd 服务名 `furniture`，使用独立系统账号 `furniture`，配置开机启动和故障重启。
- 独立 Node.js 24.15.0 位于 `/opt/3d-furniture/runtime/`，不替换服务器其他项目使用的 Node。
- 版本目录 `/opt/3d-furniture/releases/`，当前版本链接 `/opt/3d-furniture/current`。
- 数据目录 `/var/lib/3d-furniture`，部署切换不会覆盖保存版本。
- 私密环境文件 `/etc/3d-furniture/furniture.env`，仅 root 可读写，不进入仓库。
- Nginx 按 IP 限制模型修改请求（12 次/分钟，允许短时 3 次突发），限制单次请求大小。

这是第一阶段试用实例，目前保存版本属于同一个共享工作区。面向多个独立客户之前，需要增加账号和项目隔离。

## 配置 DeepSeek 密钥

在服务器交互终端执行：

```bash
sudo /usr/local/sbin/furniture-set-api-key
```

提示后粘贴 API Key，输入过程隐藏，密钥不进入命令行历史。脚本写入以下配置并重启服务：

```dotenv
AI_BASE_URL=https://api.deepseek.com
AI_MODEL=deepseek-flash
AI_THINKING=disabled
```

`AI_THINKING=disabled` 使用官方非思考模式，以减少第一阶段交互的等待时间与成本。模型请求保留 JSON 输出，限制输出 2048 tokens。可以在环境文件中手动改为 `enabled` 并重启。

健康端点的 `mode:ai` 表示已加载密钥和模型配置，实际鉴权及模型可用性以第一次语言请求为准。没有密钥时仍可使用明确标识的本地演示。

官方依据：[模型与官方地址](https://api-docs.deepseek.com/quick_start/pricing)、[JSON 输出](https://api-docs.deepseek.com/guides/json_mode)、[思考模式](https://api-docs.deepseek.com/guides/thinking_mode)。

## 运维命令

```bash
sudo systemctl status furniture --no-pager
sudo journalctl -u furniture -n 80 --no-pager
sudo systemctl restart furniture
curl -fsS http://127.0.0.1:8787/api/health
sudo nginx -t
sudo certbot certificates
```

## 发布与回退

本地使用 `npm ci`、`npm test`、`npm run build`。将 `dist server shared package.json package-lock.json deploy README.md docs` 打包为 tar.gz，传到服务器临时目录，再执行：

```bash
sudo bash /tmp/furniture-bootstrap.sh /tmp/furniture-release.tar.gz UNIQUE_RELEASE_ID
```

`furniture-bootstrap.sh` 来自仓库的 `deploy/bootstrap.sh`。脚本从 Node.js 官方地址下载独立运行时并校验 SHA256，只安装生产依赖。后续发布保留已配置的环境文件与 Nginx HTTPS 配置。

回退时将 `current` 指向明确的旧版本目录并重启服务；`/var/lib/3d-furniture` 独立保留：

```bash
sudo ln -sfn /opt/3d-furniture/releases/PREVIOUS_RELEASE_ID /opt/3d-furniture/current
sudo systemctl restart furniture
```

## 域名和证书

DNSPod 主机记录为 `furniture`，记录类型 A，值为 `139.199.89.115`。HTTPS 证书签发需要公共 DNS 已解析到此服务器。

初次安装生成独立 HTTP 虚拟主机，确认解析后执行：

```bash
sudo certbot --nginx --non-interactive --agree-tos --register-unsafely-without-email --redirect -d furniture.zhenpinfa.cn
```

证书由服务器现有 Certbot 定时器续期。具体上线检查结果记录在 `docs/DEPLOYMENT_STATUS.md`。

初次部署额外安装 `furniture-https.timer`：每 5 分钟检查解析，解析正确后自动签发并启用 HTTPS，成功后自动关闭此初次部署定时器。证书申请失败时至少间隔一小时才重试。可以手动执行 `sudo /usr/local/sbin/furniture-enable-https` 立即检查；它不会在 DNS 不匹配时申请证书。

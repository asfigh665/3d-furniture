# FORM · 家具共创工作台

定制家具三阶段系统的第一阶段原型。当前专注**边柜外观**：在浏览器中探索造型、材质和视觉比例，通过语言连续修改，保存并比较版本。展示网格不包含制造结构，不能直接用于生产。

三阶段计划已固化在 [产品计划](docs/PRODUCT_PLAN.md)，技术边界见 [架构文档](docs/ARCHITECTURE.md)。

## 本机启动

依赖 Node.js 22.12 或更新版本、npm，以及支持 WebGL 的现代浏览器。本阶段无需安装 Python、Blender、CAD、CUDA 或本地语言模型。

```powershell
cd D:\3d-furniture
npm.cmd install
npm.cmd run dev
```

打开 http://127.0.0.1:5173 。前端端口 5173，后端端口 8787，默认仅监听本机。

编译后以单个服务运行：

```powershell
npm.cmd run build
npm.cmd start
```

然后打开 http://127.0.0.1:8787 。后台服务启动时需已有 `dist`；开发期间使用 `npm run dev`。

## 当前功能

- 三种边柜灵感方向：暖调奶油、自然木作、静谧意式。
- 实时三维预览、旋转缩放、正/侧/背视角、全屏与当前视角 PNG。
- 柜体、门板、台面材质；平面/竖纹门面；圆腿/锥腿/落地/悬浮底部。
- 自然语言调整比例、分区、材质、圆角、底部及把手，能力受场景 schema 限制。
- 整体造型、材质配色、门面细节三类锁定，服务端再次执行锁定规则。
- 撤销/重做、浏览器草稿自动保存、服务端命名版本、恢复、双视图比较。
- PNG、GLB、JSON 导出与 JSON 设计导入。GLB 仅导出家具，不包含地面和灯光。
- 石材、竖纹、悬浮、超长尺寸的轻量制作提示，不构成报价或工程验证。

示例描述：

```text
柜体换成胡桃木，台面改成洞石
改成三扇门，圆润一点
去掉竖纹，把底部改成悬浮
宽度改成180厘米
```

第一版不支持任意家具、自由曲面、参考图片生成、抽屉或开放格、工程结构、精确 CAD 图纸、摄影级离线渲染。预设卡片是风格示意，实际外观以主三维画面为准。

## 接入真实 AI

不配置模型时，页面明确显示 **本地演示**。此模式使用有限的中文规则解析，不调用语言模型，不会理解任意复杂要求。

将 `.env.example` 复制为 `.env`，在本机编辑：

```dotenv
AI_API_KEY=你的服务密钥
AI_MODEL=deepseek-flash
AI_BASE_URL=https://api.deepseek.com
AI_THINKING=disabled
PORT=8787
```

`AI_API_KEY` 和 `AI_MODEL` 同时填写才启用 AI。自定义兼容服务须支持 `POST /chat/completions`、`response_format: {"type":"json_object"}` 及标准 `choices[0].message.content` 返回格式。不是所有标记为兼容的模型都支持该模式，需针对选定供应商实测。

编辑环境文件后重启服务。服务端发送当前外观数据、修改要求和最近对话给所配置的模型提供方；密钥不传到浏览器，也不写入导出文件。模型输出经过严格 schema 校验与锁定过滤，不执行模型生成代码。超时、鉴权或格式错误会保留当前方案。

当前默认配置为 DeepSeek 官方 `deepseek-flash`，通过兼容的 Chat Completions 接口调用，使用 JSON 输出并关闭思考模式。依据：[DeepSeek 模型文档](https://api-docs.deepseek.com/quick_start/pricing)、[JSON 输出](https://api-docs.deepseek.com/guides/json_mode)。未填入真实密钥前，外部模型链路仅通过 mock 验证。

服务器部署及密钥配置见 [部署说明](docs/DEPLOYMENT.md)。

## 数据与文件

| 位置 | 内容 |
| --- | --- |
| `shared/design.js` | 外观 schema、材质、预设和锁定规则 |
| `src/Scene.jsx` | Three.js 家具几何、程序纹理、灯光与 GLB 导出 |
| `src/App.jsx` | 工作台、对话、历史、版本和导出 |
| `server/` | API、模型适配器、本地规则和 JSON 版本存储 |
| `data/versions.json` | 服务端保存的版本，首次保存时创建 |
| 浏览器 localStorage | 当前草稿、锁定状态和最近对话，仅属于当前浏览器与网址 |
| `tests/design.test.js` | 修改稳定性、schema、provider 和 API/持久化测试 |
| `tests/workspace.test.jsx` | 连续对话、锁定、撤销重做、保存恢复、草稿和错误重试 |

撤销栈仅在当前页面会话保留；刷新后恢复当前草稿。恢复保存版本会整体恢复外观，不受当前局部锁定限制，并可以撤销。保存版本保留完整设计，不代表客户签署或生产审批。

导出的 JSON 为 `schemaVersion:1`、`stage:appearance`、`furnitureType:sideboard`、米制单位、`engineeringVerified:false`，可再次导入；它不包含对话全文与服务配置。

本版本是本机单用户开发原型。不要直接暴露到公网；客户部署前需要认证、项目隔离、配额、数据库、备份和并发控制。多进程写入同一 JSON 文件不受支持。

## 验证

```powershell
npm.cmd test
npm.cmd run build
```

当前 16 项后端测试和 4 项前端交互测试通过，另在浏览器中检查了实际三维显示。前端测试中的 API 和三维组件为 mock，不替代真实模型或导出文件验收。详见 [验收记录](docs/VALIDATION.md)。

## 后续顺序

1. 真实供应商联调和交互质量评测，拓展描述理解与支持的外观编辑。
2. 高质量部件/材质资产库、参考图片工作流和更丰富的边柜几何。
3. 标准多视图确认包、项目管理和客户可用的部署能力。
4. 第一阶段稳定后引入 CAD 精确重建，再接入工厂知识和生产工程流程。

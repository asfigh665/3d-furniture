import express from 'express';
import { z } from 'zod';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DesignSchema, getDesignWarnings } from '../shared/design.js';
import { interpretDemo } from './demo.js';
import { providerConfig, publicProviderInfo, requestAiDesign, ProviderError } from './ai.js';
import { createVersionStore } from './store.js';

const locksSchema = z.array(z.enum(['shape', 'material', 'detail'])).max(3).default([]);
const requestSchema = z.object({
  message: z.string().trim().min(1).max(2000), design: DesignSchema,
  locked: locksSchema,
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(2500) }).strict()).max(20).default([]),
}).strict();
const versionInput = z.object({ name: z.string().trim().min(1).max(80), design: DesignSchema }).strict();

export function createApp({ root = process.cwd(), config = providerConfig(), fetchImpl = fetch, dataDirectory = join(root, 'data'), allowedOrigins = [] } = {}) {
  const app = express();
  const store = createVersionStore(dataDirectory);
  app.disable('x-powered-by');
  // Production allows only the configured site origins; local development stays local.
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      try {
        const parsed = new URL(origin);
        const permitted = allowedOrigins.length
          ? allowedOrigins.includes(parsed.origin)
          : ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
        if (!permitted) return res.status(403).json({ error: '不允许从此来源访问工作台。' });
      } catch { return res.status(403).json({ error: '请求来源无效。' }); }
    }
    next();
  });
  app.use(express.json({ limit: '128kb' }));

  app.get('/api/health', (_req, res) => res.json(publicProviderInfo(config)));
  app.post('/api/design', async (req, res, next) => {
    try {
      // Accept descriptive aliases used by clients, normalize to one strict internal contract.
      const source = req.body ?? {};
      const { prompt, currentDesign, locks, ...rest } = source;
      const input = requestSchema.parse({ ...rest, message: source.message ?? prompt, design: source.design ?? currentDesign, locked: source.locked ?? locks });
      const result = config.enabled
        ? await requestAiDesign(input, config, fetchImpl)
        : interpretDemo(input.message, input.design, input.locked);
      res.json({ ...result, message: result.reply });
    } catch (error) { next(error); }
  });
  app.get('/api/versions', async (_req, res, next) => {
    try { res.json({ versions: await store.list() }); } catch (error) { next(error); }
  });
  app.post('/api/versions', async (req, res, next) => {
    try { const input = versionInput.parse(req.body); res.status(201).json({ version: await store.add(input.name, input.design) }); }
    catch (error) { next(error); }
  });
  app.delete('/api/versions/:id', async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const removed = await store.remove(id);
      if (!removed) return res.status(404).json({ error: '未找到这个已保存方案。' });
      res.json({ deleted: true });
    } catch (error) { next(error); }
  });
  app.post('/api/confirm', (req, res, next) => {
    try {
      const { design } = z.object({ design: DesignSchema }).strict().parse(req.body);
      const confirmation = {
        schemaVersion: 1, status: 'concept_only', category: 'sideboard', createdAt: new Date().toISOString(), units: 'metres', design,
        assumptions: [
          '本文件只记录第一阶段的外观意向，并非生产或承重认证。',
          '尺寸仅用于视觉比例；板厚、连接、开合、公差、安装及可靠性尚未设计。',
          '材质与颜色为屏幕模拟，需以实体色板和最终材料确认。',
          '本包不含精确 CAD、工程图纸、离线渲染或客户签名。',
        ], warnings: getDesignWarnings(design), nextStage: '精确外观建模、功能与尺寸深化、客户确认',
      };
      res.setHeader('Content-Disposition', 'attachment; filename="appearance-confirmation.json"');
      res.json(confirmation);
    } catch (error) { next(error); }
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在。' }));
  const dist = resolve(root, 'dist');
  if (existsSync(join(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.get(/.*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
  }
  app.use((error, _req, res, _next) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: '输入的设计或请求格式无效。', details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) });
    if (error instanceof ProviderError) return res.status(error.status).json({ error: error.message });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: '请求内容过大。' });
    if (error instanceof SyntaxError && error.status === 400) return res.status(400).json({ error: '请求必须为有效 JSON。' });
    console.error('[server]', error.code || error.name || 'Unknown error');
    res.status(500).json({ error: '服务暂时无法完成请求，现有方案未修改。请查看本地服务日志与数据文件。' });
  });
  return app;
}

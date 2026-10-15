import { z } from 'zod';
import { DesignSchema, applyLocks, changedFields, FIELD_LABELS, getDesignWarnings } from '../shared/design.js';

export class ProviderError extends Error {
  constructor(message, status = 502) { super(message); this.name = 'ProviderError'; this.status = status; }
}

export function providerConfig(env = process.env) {
  const enabled = Boolean(env.AI_API_KEY?.trim() && env.AI_MODEL?.trim());
  const thinking = env.AI_THINKING || 'disabled';
  if (!['enabled', 'disabled'].includes(thinking)) throw new Error('AI_THINKING 必须为 enabled 或 disabled。');
  return {
    enabled, apiKey: env.AI_API_KEY?.trim(), model: env.AI_MODEL?.trim(),
    baseUrl: (env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    thinking,
  };
}

export function publicProviderInfo(config) {
  let provider = '本地规则演示';
  if (config.enabled) {
    try { provider = new URL(config.baseUrl).hostname; } catch { provider = '已配置的 AI 服务'; }
  }
  return { mode: config.enabled ? 'ai' : 'demo', provider, model: config.enabled ? config.model : null };
}

const ProviderResponseSchema = z.object({ design: DesignSchema, reply: z.string().min(1).max(1200) }).strict();

const systemPrompt = `你是家具边柜外观设计助手。仅设计边柜外观，不生成工程结构、生产图纸、承重结论或任意代码。
用户给出当前设计 JSON 和修改要求。只改变明确要求的字段，保留其他字段。锁定字段不得变化。
支持的字段与范围：name(1-60字符),width(1-2.4米),height(0.55-1.2米),depth(0.3-0.7米),doors(2-6整数),cornerRadius(0.01-0.12米),legHeight(0.04-0.3米),legStyle(plinth|round|tapered|floating),bodyMaterial和doorMaterial(cream|oak|walnut|sage|charcoal),topMaterial(cream|oak|walnut|sage|charcoal|travertine),handleStyle(none|brass|wood),detail(plain|fluted),style(soft|minimal|natural)。
这是一套受限的网格造型工具。不能表示抽屉、开放格、玻璃门、雕刻、不同家具品类或任意自由曲面。如果用户要求超出以上能力，保持原设计并在 reply 诚实说明。不得声称渲染、制造、结构可靠性或未支持功能已完成。
输出 JSON 对象，必须且只包含 design（全部上述字段）和 reply（简短中文回复）。不要输出 Markdown。reply 说明实际修改以及需要澄清的内容。`;

export async function requestAiDesign({ message, design, locked = [], history = [] }, config, fetchImpl = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);
  try {
    let endpoint;
    try {
      endpoint = new URL(`${config.baseUrl}/chat/completions`);
      if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('protocol');
    } catch { throw new ProviderError('AI_BASE_URL 配置无效，请填写服务的 HTTP(S) API 地址。', 503); }
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-8).map(({ role, content }) => ({ role, content })),
      { role: 'user', content: JSON.stringify({ currentDesign: design, locked, request: message }) },
    ];
    const deepSeekOptions = endpoint.hostname === 'api.deepseek.com'
      ? { thinking: { type: config.thinking || 'disabled' }, max_tokens: 2048 }
      : {};
    const response = await fetchImpl(endpoint, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages, response_format: { type: 'json_object' }, ...deepSeekOptions }),
    });
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw new ProviderError('AI 服务鉴权失败，请检查服务端 API Key 与模型权限。', 503);
      if (response.status === 429) throw new ProviderError('AI 服务额度不足或请求过于频繁，请稍后重试。', 429);
      throw new ProviderError(`AI 服务返回错误（HTTP ${response.status}）。请检查模型是否支持 JSON 输出；现有方案已保留。`);
    }
    let parsed;
    try {
      const payload = await response.json();
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('empty response');
      parsed = ProviderResponseSchema.parse(JSON.parse(content));
    } catch { throw new ProviderError('AI 返回了不符合设计格式的结果，已拒绝应用；现有方案保持不变。'); }
    const finalDesign = DesignSchema.parse(applyLocks(design, parsed.design, locked));
    const fields = changedFields(design, finalDesign);
    const requested = changedFields(design, parsed.design);
    const blocked = requested.filter((field) => !fields.includes(field));
    const changes = fields.map((field) => FIELD_LABELS[field]);
    const lockNotice = blocked.length ? `已保留锁定内容：${blocked.map((field) => FIELD_LABELS[field]).join('、')}。` : '';
    // A provider's prose may describe changes removed by locks, so replace it in that case.
    const reply = blocked.length
      ? `${changes.length ? `已调整${changes.join('、')}。` : '没有应用新的修改。'}${lockNotice}`
      : parsed.reply;
    return { design: finalDesign, reply, mode: 'ai', changes, warnings: getDesignWarnings(finalDesign) };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (error.name === 'AbortError') throw new ProviderError('AI 请求超时，请重试；现有方案保持不变。', 504);
    throw new ProviderError('暂时无法连接 AI 服务，请检查服务地址或网络；现有方案保持不变。', 503);
  } finally { clearTimeout(timeout); }
}

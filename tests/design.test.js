import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_DESIGN, DesignSchema, applyLocks } from '../shared/design.js';
import { interpretDemo } from '../server/demo.js';
import { requestAiDesign, ProviderError, publicProviderInfo, providerConfig } from '../server/ai.js';
import { createVersionStore } from '../server/store.js';
import { createApp } from '../server/app.js';

test('local material changes preserve all unmentioned parts', () => {
  const result = interpretDemo('柜体改成胡桃木，台面改成洞石', DEFAULT_DESIGN);
  assert.equal(result.design.bodyMaterial, 'walnut');
  assert.equal(result.design.topMaterial, 'travertine');
  assert.equal(result.design.doorMaterial, 'cream');
  assert.equal(result.design.width, DEFAULT_DESIGN.width);
  assert.equal(result.design.legStyle, DEFAULT_DESIGN.legStyle);
  assert.match(result.reply, /规则演示/);
});

test('explicit whole-furniture material request includes the tabletop', () => {
  const result = interpretDemo('整体换成温润的胡桃木', DEFAULT_DESIGN);
  assert.equal(result.design.bodyMaterial, 'walnut');
  assert.equal(result.design.doorMaterial, 'walnut');
  assert.equal(result.design.topMaterial, 'walnut');
  assert.equal(result.design.legStyle, DEFAULT_DESIGN.legStyle);
});

test('rounding and explicit door count apply only requested geometry changes', () => {
  const result = interpretDemo('更圆润一点，柜门改成三扇', DEFAULT_DESIGN);
  assert.equal(result.design.doors, 3);
  assert.equal(result.design.cornerRadius, 0.08);
  assert.equal(result.design.width, 1.6);
});

test('metric sizes work and unsupported sizes remain unchanged', () => {
  assert.equal(interpretDemo('宽度改成180厘米', DEFAULT_DESIGN).design.width, 1.8);
  assert.equal(interpretDemo('深度改成500mm', DEFAULT_DESIGN).design.depth, 0.5);
  const tooLarge = interpretDemo('宽度改成4米', DEFAULT_DESIGN);
  assert.equal(tooLarge.design.width, 1.6);
  assert.match(tooLarge.reply, /100–240 cm/);
});

test('negative material instruction does not accidentally apply that material', () => {
  const result = interpretDemo('不要胡桃木', DEFAULT_DESIGN);
  assert.deepEqual(result.design, DEFAULT_DESIGN);
  assert.match(result.reply, /替换成的材质/);
});

test('unsupported structural requests and unknown language return honest unchanged design', () => {
  for (const request of ['增加两个抽屉', '改成沙发', '给我一个非常复杂的概念']) {
    const result = interpretDemo(request, DEFAULT_DESIGN);
    assert.deepEqual(result.design, DEFAULT_DESIGN);
    assert.equal(result.changes.length, 0);
  }
});

test('locked shape survives a shape change while unlocked material changes', () => {
  const result = interpretDemo('加宽一点，台面改成洞石', DEFAULT_DESIGN, ['shape']);
  assert.equal(result.design.width, 1.6);
  assert.equal(result.design.topMaterial, 'travertine');
  assert.match(result.reply, /锁定/);
});

test('all lock groups protect all declared visual fields', () => {
  const candidate = { ...DEFAULT_DESIGN, width: 2, style: 'minimal', topMaterial: 'walnut', handleStyle: 'brass', detail: 'plain' };
  assert.deepEqual(applyLocks(DEFAULT_DESIGN, candidate, ['shape', 'material', 'detail']), DEFAULT_DESIGN);
});

test('schema rejects non-finite values, out of range sizes, unknown fields and enums', () => {
  for (const patch of [{ width: Infinity }, { height: 8 }, { doors: 2.5 }, { legStyle: 'unknown' }, { script: 'run code' }]) {
    assert.equal(DesignSchema.safeParse({ ...DEFAULT_DESIGN, ...patch }).success, false);
  }
});

const config = { enabled: true, apiKey: 'never-return-this-key', model: 'configured-model', baseUrl: 'https://example.com/v1' };
const input = { message: '台面洞石，柜子加宽', design: DEFAULT_DESIGN, locked: ['shape'] };
const jsonResponse = (payload) => async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('provider response validates and server lock enforcement overrides provider prose', async () => {
  const fetchMock = jsonResponse({ choices: [{ message: { content: JSON.stringify({ design: { ...DEFAULT_DESIGN, width: 2, topMaterial: 'travertine' }, reply: '已经加宽并换了台面。' }) } }] });
  const result = await requestAiDesign(input, config, fetchMock);
  assert.equal(result.design.width, DEFAULT_DESIGN.width);
  assert.equal(result.design.topMaterial, 'travertine');
  assert.doesNotMatch(result.reply, /已经加宽/);
  assert.match(result.reply, /锁定/);
  assert.equal(JSON.stringify(publicProviderInfo(config)).includes(config.apiKey), false);
});

test('malformed and unbounded provider output never reaches client design', async () => {
  for (const content of ['not json', JSON.stringify({ design: { ...DEFAULT_DESIGN, width: 100 }, reply: '完成' })]) {
    await assert.rejects(requestAiDesign(input, config, jsonResponse({ choices: [{ message: { content } }] })), (error) => error instanceof ProviderError && /不符合设计格式/.test(error.message));
  }
});

test('provider failure messages are helpful and do not leak remote error bodies', async () => {
  await assert.rejects(requestAiDesign(input, config, async () => new Response(config.apiKey, { status: 401 })), (error) => error.status === 503 && /鉴权失败/.test(error.message) && !error.message.includes(config.apiKey));
  await assert.rejects(requestAiDesign(input, config, async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }), (error) => error.status === 504);
});

test('official DeepSeek flash uses JSON output and explicitly disables expensive thinking by default', async () => {
  const deepseek = providerConfig({ AI_API_KEY: 'test-only-key', AI_MODEL: 'deepseek-flash', AI_BASE_URL: 'https://api.deepseek.com' });
  let request;
  await requestAiDesign({ message: '保持当前方案', design: DEFAULT_DESIGN }, deepseek, async (url, options) => {
    assert.equal(url.toString(), 'https://api.deepseek.com/chat/completions');
    request = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ design: DEFAULT_DESIGN, reply: '保持当前方案。' }) } }] }));
  });
  assert.equal(request.model, 'deepseek-flash');
  assert.deepEqual(request.response_format, { type: 'json_object' });
  assert.deepEqual(request.thinking, { type: 'disabled' });
  assert.equal(request.max_tokens, 2048);
});

test('deployment origins allow the configured HTTPS domain and reject unrelated origins', async () => {
  const app = createApp({ config: { enabled: false }, allowedOrigins: ['https://furniture.zhenpinfa.cn'] });
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const url = `http://127.0.0.1:${server.address().port}/api/design`;
  const call = origin => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ message: '换成胡桃木', design: DEFAULT_DESIGN }) });
  try {
    assert.equal((await call('https://furniture.zhenpinfa.cn')).status, 200);
    assert.equal((await call('https://unrelated.example')).status, 403);
    assert.equal((await call('https://furniture.zhenpinfa.cn.attacker.example')).status, 403);
    assert.equal((await call('http://furniture.zhenpinfa.cn')).status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('concurrent versions persist without lost updates and reload correctly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'furniture-versions-'));
  try {
    const store = createVersionStore(directory);
    const [first, second] = await Promise.all([store.add('第一版', DEFAULT_DESIGN), store.add('第二版', { ...DEFAULT_DESIGN, topMaterial: 'travertine' })]);
    assert.equal((await createVersionStore(directory).list()).length, 2);
    const disk = JSON.parse(await readFile(join(directory, 'versions.json'), 'utf8'));
    assert.equal(disk[0].id, second.id);
    assert.equal(await store.remove(first.id), true);
    assert.equal(await store.remove(first.id), false);
    assert.equal((await store.list()).length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('HTTP API supports actual design, persistence, validation, and concept export', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'furniture-api-'));
  const app = createApp({ dataDirectory: directory, config: { enabled: false } });
  const server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body) => fetch(`${url}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await (await fetch(`${url}/api/health`)).json()).mode, 'demo');
    const designResponse = await post('/api/design', { prompt: '台面改洞石', currentDesign: DEFAULT_DESIGN, locks: [] });
    assert.equal(designResponse.status, 200);
    const changed = await designResponse.json();
    assert.equal(changed.design.topMaterial, 'travertine');
    assert.equal(changed.message, changed.reply);
    assert.equal((await post('/api/design', { message: '改宽', design: { ...DEFAULT_DESIGN, width: -1 } })).status, 400);
    const saved = await (await post('/api/versions', { name: '测试', design: changed.design })).json();
    assert.equal((await (await fetch(`${url}/api/versions`)).json()).versions[0].id, saved.version.id);
    const exported = await (await post('/api/confirm', { design: changed.design })).json();
    assert.equal(exported.status, 'concept_only');
    assert.equal(exported.design.topMaterial, 'travertine');
    assert.equal((await fetch(`${url}/api/versions/${saved.version.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await fetch(`${url}/api/design`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://malicious.example' }, body: JSON.stringify({ message: '改宽', design: DEFAULT_DESIGN }) })).status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

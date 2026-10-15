import { DesignSchema, applyLocks, changedFields, FIELD_LABELS, getDesignWarnings } from '../shared/design.js';

const materialPatterns = [
  [/奶油|米白|象牙|暖白|白色/, 'cream'], [/胡桃|深木|深色木/, 'walnut'],
  [/橡木|原木|浅木|浅色木|木色/, 'oak'], [/鼠尾草|绿色|灰绿|墨绿/, 'sage'],
  [/炭黑|黑色|深灰/, 'charcoal'], [/洞石|大理石|石材|石面/, 'travertine'],
];
const numerals = { 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
const round = (value) => Math.round(value * 1000) / 1000;
const clamp = (value, min, max) => Math.min(max, Math.max(min, round(value)));

function findMaterial(text) { return materialPatterns.find(([pattern]) => pattern.test(text))?.[1]; }

export function interpretDemo(message, previous, locked = []) {
  DesignSchema.parse(previous);
  const text = message.trim();
  let candidate = { ...previous };
  const notes = [];
  // Unsupported categories and structural details must never masquerade as completed modelling.
  if (/沙发|椅子|餐桌|书桌|床头|衣柜|书架|床架|圆桌|茶几|抽屉|玻璃|开放格|开放式|雕刻|榫卯|铰链|承重|生产图|孔位|改成.*床|改成.*桌/.test(text)) {
    return { design: candidate, reply: '当前是边柜外观规则演示，只支持比例、门板分区、圆角、底部、材质和纹理修改。这个要求超出当前造型能力，我保留了现有方案，没有生成该结构。', mode: 'demo', changes: [], warnings: [] };
  }

  // Separate clauses to support mixed materials, e.g. "柜体胡桃木，台面洞石".
  const clauses = text.split(/[，,。；;！!\n]|(?:然后|同时|但是|但)/).map((s) => s.trim()).filter(Boolean);
  for (const clause of clauses) {
    const mat = findMaterial(clause);
    const negated = /不要|别用|不想要|不使用|去掉/.test(clause);
    if (mat && !negated) {
      if (/台面|顶板|顶部/.test(clause)) candidate.topMaterial = mat;
      else if (/门板|柜门/.test(clause)) {
        if (mat !== 'travertine') candidate.doorMaterial = mat;
        else notes.push('当前石材仅支持台面，门板材质保持不变。');
      } else if (/柜体|侧板/.test(clause)) {
        if (mat !== 'travertine') candidate.bodyMaterial = mat;
        else notes.push('当前石材仅支持台面，柜体材质保持不变。');
      } else if (mat === 'travertine') candidate.topMaterial = mat;
      else {
        candidate.bodyMaterial = mat; candidate.doorMaterial = mat;
        if (/整体|全部|全都|整个/.test(clause)) candidate.topMaterial = mat;
      }
    } else if (mat && negated) notes.push('请指定要替换成的材质，例如“柜体改成橡木”；本次没有推测替代材质。');
  }

  if (/圆润|更圆|圆一点|圆角大|柔和|柔软/.test(text) && !/不要.*(圆|柔)|别.*圆/.test(text)) {
    candidate.cornerRadius = clamp(previous.cornerRadius + 0.025, 0.01, 0.12); candidate.style = 'soft';
  }
  if (/方正|直角|硬朗|圆角小|不要圆角|不那么圆/.test(text)) candidate.cornerRadius = 0.015;
  if (/简约|极简|干净|不要装饰/.test(text)) { candidate.detail = 'plain'; candidate.handleStyle = 'none'; candidate.style = 'minimal'; }
  if (/自然风|自然一点|日式|侘寂/.test(text)) candidate.style = 'natural';
  if (/竖纹|条纹|格栅|线条纹/.test(text)) candidate.detail = /不要|去掉|取消|没有/.test(text) ? 'plain' : 'fluted';
  if (/平整|平板|光滑/.test(text)) candidate.detail = 'plain';
  if (/无把手|不要把手|隐藏把手|去掉把手|取消把手/.test(text)) candidate.handleStyle = 'none';
  else if (/黄铜|金属把手|金色把手/.test(text)) candidate.handleStyle = 'brass';
  else if (/木把手|木质把手/.test(text)) candidate.handleStyle = 'wood';
  if (/悬浮|挂墙|壁挂/.test(text) && !/不要悬浮|不悬浮/.test(text)) candidate.legStyle = 'floating';
  if (/落地|踢脚|底座|藏.*腿|隐藏.*腿|不要.*腿|去掉.*腿/.test(text)) { candidate.legStyle = 'plinth'; candidate.legHeight = 0.06; }
  if (/圆腿|圆柱腿|圆形.*腿/.test(text)) candidate.legStyle = 'round';
  if (/锥形.*腿|锥腿|细腿|腿.*细|轻盈/.test(text)) candidate.legStyle = 'tapered';
  if (/腿.*高|抬高|离地高/.test(text)) candidate.legHeight = clamp(previous.legHeight + 0.04, 0.04, 0.3);
  if (/腿.*短|腿.*低|离地低/.test(text)) candidate.legHeight = clamp(previous.legHeight - 0.04, 0.04, 0.3);

  const dimensions = [
    { key: 'width', labels: '(?:宽(?:度)?|长(?:度)?)', min: 1, max: 2.4, plus: /加宽|更宽|宽一点|宽一些|拉长/, minus: /窄一点|窄一些|缩窄|短一点/ },
    { key: 'height', labels: '(?:总高|高度|柜高|高)', min: 0.55, max: 1.2, plus: /柜体.*高一点|整体.*高一点|柜子.*高一点/, minus: /柜体.*矮|整体.*矮|柜子.*矮|矮一点/ },
    { key: 'depth', labels: '(?:深(?:度)?)', min: 0.3, max: 0.7, plus: /加深|深一点|深一些/, minus: /浅一点|薄一点|薄一些/ },
  ];
  for (const dim of dimensions) {
    const absolute = text.match(new RegExp(`${dim.labels}(?:约|为|是|做成|改成|设为|到|做|改到|增加到|减少到|调整为)?\\s*(\\d+(?:\\.\\d+)?)\\s*(毫米|厘米|公分|米|mm|cm|m)`, 'i'));
    if (absolute) {
      const units = absolute[2].toLowerCase();
      const value = Number(absolute[1]) / (['毫米', 'mm'].includes(units) ? 1000 : ['厘米', '公分', 'cm'].includes(units) ? 100 : 1);
      if (value < dim.min || value > dim.max) notes.push(`${FIELD_LABELS[dim.key]}支持 ${Math.round(dim.min * 100)}–${Math.round(dim.max * 100)} cm，本次保留原${FIELD_LABELS[dim.key]}。`);
      else candidate[dim.key] = round(value);
    } else if (dim.plus.test(text)) candidate[dim.key] = clamp(previous[dim.key] + (dim.key === 'width' ? 0.15 : 0.05), dim.min, dim.max);
    else if (dim.minus.test(text)) candidate[dim.key] = clamp(previous[dim.key] - (dim.key === 'width' ? 0.15 : 0.05), dim.min, dim.max);
  }
  const doorMatch = text.match(/([2-6二两三四五六])\s*(?:扇|个)?\s*(?:柜门|门板|门)|(?:柜门|门板|分区)(?:改成|改为|变成|做成|分成|为|数量)?\s*([2-6二两三四五六])/);
  if (doorMatch) { const value = doorMatch[1] ?? doorMatch[2]; candidate.doors = numerals[value] ?? Number(value); }
  else if (/门.*少一点|分区.*少|不要.*碎|门板.*大一点/.test(text)) candidate.doors = clamp(previous.doors - 1, 2, 6);
  else if (/门.*多一点|分区.*多/.test(text)) candidate.doors = clamp(previous.doors + 1, 2, 6);

  const requested = changedFields(previous, candidate);
  candidate = DesignSchema.parse(applyLocks(previous, candidate, locked));
  const fields = changedFields(previous, candidate);
  const blocked = requested.filter((field) => !fields.includes(field));
  if (blocked.length) notes.push(`已保留锁定内容：${blocked.map((field) => FIELD_LABELS[field]).join('、')}。`);
  const changes = fields.map((field) => FIELD_LABELS[field]);
  const reply = fields.length
    ? `已调整${changes.join('、')}，其他部分保持不变。${notes.join('')}当前为本地规则演示，尚未调用 AI。`
    : `${notes.join('') || '没有识别到可执行的新修改。可以试试“台面改成洞石”“柜门改成三扇”“更圆润一点”。'}当前为本地规则演示，方案保持不变。`;
  return { design: candidate, reply, mode: 'demo', changes, warnings: getDesignWarnings(candidate) };
}

import { z } from 'zod';

export const MATERIALS = {
  cream: { label: '奶油白', color: '#e6dfce', roughness: 0.58, kind: 'paint' },
  oak: { label: '浅橡木', color: '#bba17b', roughness: 0.58, kind: 'wood' },
  walnut: { label: '胡桃木', color: '#68503d', roughness: 0.5, kind: 'wood' },
  sage: { label: '鼠尾草绿', color: '#929d89', roughness: 0.58, kind: 'paint' },
  charcoal: { label: '炭黑', color: '#393d39', roughness: 0.5, kind: 'paint' },
  travertine: { label: '浅色洞石', color: '#d4c5a9', roughness: 0.72, kind: 'stone' },
};

export const DEFAULT_DESIGN = {
  name: '暖调 · 奶油边柜', width: 1.6, height: 0.8, depth: 0.44,
  doors: 4, cornerRadius: 0.055, legStyle: 'round', legHeight: 0.14,
  bodyMaterial: 'cream', doorMaterial: 'cream', topMaterial: 'oak',
  handleStyle: 'none', detail: 'fluted', style: 'soft',
};

export const PRESETS = [
  { id: 'soft', name: '暖调奶油', label: '暖调奶油', description: '柔和圆角与细密竖纹', design: { ...DEFAULT_DESIGN } },
  { id: 'natural', name: '自然木作', label: '自然木作', description: '温润橡木与轻盈锥腿', design: { ...DEFAULT_DESIGN, name: '自然 · 橡木边柜', bodyMaterial: 'oak', doorMaterial: 'oak', topMaterial: 'oak', legStyle: 'tapered', handleStyle: 'wood', detail: 'plain', style: 'natural', cornerRadius: 0.035 } },
  { id: 'minimal', name: '静谧意式', label: '静谧意式', description: '深色柜体与浅色石面', design: { ...DEFAULT_DESIGN, name: '静谧 · 意式边柜', bodyMaterial: 'walnut', doorMaterial: 'walnut', topMaterial: 'travertine', legStyle: 'plinth', legHeight: 0.07, detail: 'plain', style: 'minimal', cornerRadius: 0.025, handleStyle: 'brass' } },
];

const bodyMaterial = z.enum(['cream', 'oak', 'walnut', 'sage', 'charcoal']);
export const DesignSchema = z.object({
  name: z.string().trim().min(1).max(60),
  width: z.number().finite().min(1).max(2.4),
  height: z.number().finite().min(0.55).max(1.2),
  depth: z.number().finite().min(0.3).max(0.7),
  doors: z.number().int().min(2).max(6),
  cornerRadius: z.number().finite().min(0.01).max(0.12),
  legStyle: z.enum(['plinth', 'round', 'tapered', 'floating']),
  legHeight: z.number().finite().min(0.04).max(0.3),
  bodyMaterial, doorMaterial: bodyMaterial,
  topMaterial: z.enum(['cream', 'oak', 'walnut', 'sage', 'charcoal', 'travertine']),
  handleStyle: z.enum(['none', 'brass', 'wood']),
  detail: z.enum(['plain', 'fluted']),
  style: z.enum(['soft', 'minimal', 'natural']),
}).strict();

export const LOCK_FIELDS = {
  shape: ['width', 'height', 'depth', 'doors', 'cornerRadius', 'legStyle', 'legHeight', 'style'],
  material: ['bodyMaterial', 'doorMaterial', 'topMaterial'],
  detail: ['handleStyle', 'detail'],
};

export const FIELD_LABELS = {
  name: '方案名称', width: '宽度', height: '高度', depth: '深度', doors: '门板分区', cornerRadius: '圆角',
  legStyle: '底部造型', legHeight: '离地高度', bodyMaterial: '柜体材质', doorMaterial: '门板材质',
  topMaterial: '台面材质', handleStyle: '把手', detail: '门板纹理', style: '整体风格',
};

export function applyLocks(previous, candidate, locked = []) {
  const result = { ...candidate };
  for (const group of locked) for (const field of LOCK_FIELDS[group] ?? []) result[field] = previous[field];
  return result;
}

export function changedFields(previous, candidate) {
  return Object.keys(DEFAULT_DESIGN).filter((key) => previous[key] !== candidate[key]);
}

export function getDesignWarnings(design) {
  const warnings = [];
  if (design.topMaterial === 'travertine') warnings.push('石材台面可能增加材料、搬运和支撑成本，需在深化阶段确认。');
  if (design.detail === 'fluted') warnings.push('竖纹饰面和圆角收口需要额外工艺，当前仅表达外观。');
  if (design.legStyle === 'floating') warnings.push('悬浮外观的固定方式与墙体承载条件尚未验证。');
  if (design.width >= 2.1) warnings.push('较长柜体需要在深化阶段检查支撑、运输与搬入条件。');
  return warnings;
}

import React from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_DESIGN } from '../shared/design.js';
import { interpretDemo } from '../server/demo.js';
import { api } from '../src/api.js';
import App from '../src/App.jsx';

vi.mock('../src/api.js', () => ({ api: vi.fn() }));
vi.mock('../src/Scene.jsx', () => ({ default: React.forwardRef(({ design }, ref) => {
  React.useImperativeHandle(ref, () => ({ screenshot: async () => {}, exportGLB: async () => {}, resetCamera: () => {} }));
  return <output data-testid="rendered-design">{JSON.stringify(design)}</output>;
}) }));

const currentDesign = () => JSON.parse(screen.getByTestId('rendered-design').textContent);
let versions;
beforeEach(() => {
  localStorage.clear(); versions = []; api.mockReset();
  api.mockImplementation(async (path, options) => {
    if (path === '/health') return { mode: 'demo', provider: '本地规则演示', model: null };
    if (path === '/versions' && !options) return { versions: structuredClone(versions) };
    const body = JSON.parse(options?.body || '{}');
    if (path === '/design') {
      // Enforce the HTTP history contract: UI metadata must never leak into it.
      expect(body.history.every(item => Object.keys(item).sort().join(',') === 'content,role')).toBe(true);
      return interpretDemo(body.message, body.design, body.locked);
    }
    if (path === '/versions' && options.method === 'POST') {
      const version = { id: 'ui-version', createdAt: new Date().toISOString(), ...body };
      versions.unshift(version); return { version };
    }
    throw new Error(`Unexpected API path: ${path}`);
  });
});

test('consecutive language edits remain valid and preserve unrelated parts', async () => {
  const user = userEvent.setup(); render(<App />);
  await screen.findByText('本地演示');
  await user.click(screen.getByRole('button', { name: '整体换成温润的胡桃木' }));
  await waitFor(() => expect(currentDesign().topMaterial).toBe('walnut'));
  await user.click(screen.getByRole('button', { name: '柜门简洁一点，去掉竖纹' }));
  await waitFor(() => expect(currentDesign().detail).toBe('plain'));
  expect(currentDesign().bodyMaterial).toBe('walnut');
  expect(currentDesign().width).toBe(DEFAULT_DESIGN.width);
  expect(api.mock.calls.filter(([path]) => path === '/design')).toHaveLength(2);
});

test('shape locks survive language edits and undo/redo restores full snapshots', async () => {
  const user = userEvent.setup(); render(<App />); await screen.findByText('本地演示');
  await user.click(screen.getByRole('button', { name: '整体造型' }));
  await user.type(screen.getByRole('textbox', { name: '描述你想修改的家具外观' }), '改成三扇门，整体换成胡桃木');
  await user.click(screen.getByRole('button', { name: '发送修改要求' }));
  await waitFor(() => expect(currentDesign().bodyMaterial).toBe('walnut'));
  expect(currentDesign().doors).toBe(4);
  await user.click(screen.getByRole('button', { name: '撤销', exact: true }));
  expect(currentDesign()).toEqual(DEFAULT_DESIGN);
  await user.click(screen.getByRole('button', { name: '重做', exact: true }));
  expect(currentDesign().bodyMaterial).toBe('walnut');
  expect(currentDesign().doors).toBe(4);
});

test('saved versions restore previous appearance and browser draft survives remount', async () => {
  const user = userEvent.setup(); const rendered = render(<App />); await screen.findByText('本地演示');
  await user.click(screen.getByRole('button', { name: '保存版本', exact: true }));
  await user.clear(screen.getByRole('textbox', { name: '版本名称' }));
  await user.type(screen.getByRole('textbox', { name: '版本名称' }), 'UI 验证方案');
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '保存版本', exact: true }));
  await screen.findByText('UI 验证方案');
  await user.click(screen.getByRole('button', { name: '材质：鼠尾草绿' }));
  expect(currentDesign().doorMaterial).toBe('sage');
  await user.click(screen.getByRole('button', { name: '恢复', exact: true }));
  expect(currentDesign()).toEqual(DEFAULT_DESIGN);
  await user.click(screen.getByRole('button', { name: '材质：胡桃木' }));
  rendered.unmount(); render(<App />);
  expect(currentDesign().doorMaterial).toBe('walnut');
});

test('failed language requests keep the current design and allow retry', async () => {
  const user = userEvent.setup(); render(<App />); await screen.findByText('本地演示');
  api.mockImplementationOnce(async () => { throw new Error('AI 服务不可用'); });
  await user.type(screen.getByRole('textbox', { name: '描述你想修改的家具外观' }), '整体改成胡桃木');
  await user.click(screen.getByRole('button', { name: '发送修改要求' }));
  await screen.findByText('这次修改没有完成：AI 服务不可用');
  expect(currentDesign()).toEqual(DEFAULT_DESIGN);
  expect(screen.getByRole('textbox', { name: '描述你想修改的家具外观' }).value).toBe('整体改成胡桃木');
  await user.click(screen.getByRole('button', { name: '发送修改要求' }));
  await waitFor(() => expect(currentDesign().doorMaterial).toBe('walnut'));
});

import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeftRight, ArrowUp, Box, Check, CheckCheck, ChevronRight, CircleHelp, Copy, Download, Expand, History, Layers3, LoaderCircle, LockKeyhole, MoreHorizontal, Plus, Redo2, RotateCcw, Save, ScanLine, SlidersHorizontal, Sparkles, Undo2, UnlockKeyhole, X } from 'lucide-react';
import Scene from './Scene.jsx';
import { DEFAULT_DESIGN, MATERIALS, PRESETS, DesignSchema, applyLocks, changedFields, getDesignWarnings } from '../shared/design.js';
import { api } from './api.js';
import { downloadJson } from './download.js';

const STORAGE_KEY = 'form-workspace-v1';
const welcome = { role: 'assistant', content: '你好，我是你的家具设计搭档。\n从左侧选择一个灵感方向，或告诉我你想要怎样的边柜，我们一起把它变成眼前的样子。' };
const promptSuggestions = ['整体换成温润的胡桃木', '柜门简洁一点，去掉竖纹', '把底部改成悬浮效果'];
const lockLabels = { shape: '整体造型', material: '材质配色', detail: '门面细节' };

function readDraft() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (stored && DesignSchema.safeParse(stored.design).success) return { design: stored.design, locked: (stored.locked || []).filter(x => x in lockLabels), messages: (stored.messages || []).filter(x => ['user', 'assistant'].includes(x.role) && typeof x.content === 'string').slice(-30) };
  } catch { /* An invalid draft must not prevent starting the app. */ }
  return { design: { ...DEFAULT_DESIGN }, locked: [], messages: [welcome] };
}

function MiniCabinet({ design, large = false }) {
  return <div className={`mini-scene ${large ? 'large' : ''}`} aria-hidden="true">
    <div className="mini-cabinet" style={{ '--body': MATERIALS[design.bodyMaterial].color, '--door': MATERIALS[design.doorMaterial].color, '--top': MATERIALS[design.topMaterial].color, '--radius': `${Math.round(design.cornerRadius * 150)}px` }}>
      <div className="mini-top" />
      <div className={`mini-front ${design.detail}`}>
        {Array.from({ length: design.doors }, (_, i) => <span key={i}>{design.handleStyle !== 'none' && <i />}</span>)}
      </div>
      <div className="mini-side" />
      {design.legStyle !== 'floating' && <div className={`mini-legs ${design.legStyle}`}><i /><i /></div>}
    </div>
  </div>;
}

function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef();
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.showModal();
    return () => { previous?.focus?.(); };
  }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={19} /></button></div>
    {children}
  </dialog>;
}

export default function App() {
  const [initial] = useState(readDraft);
  const [history, setHistory] = useState([initial.design]);
  const [cursor, setCursor] = useState(0);
  const design = history[cursor];
  const [locked, setLocked] = useState(initial.locked);
  const [messages, setMessages] = useState(initial.messages.length ? initial.messages : [welcome]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [health, setHealth] = useState(null);
  const [versions, setVersions] = useState([]);
  const [view, setView] = useState('perspective');
  const [materialTarget, setMaterialTarget] = useState('all');
  const [notice, setNotice] = useState(null);
  const [modal, setModal] = useState(null);
  const [saveName, setSaveName] = useState('');
  const [exporting, setExporting] = useState(false);
  const sceneRef = useRef(); const chatEnd = useRef(); const viewport = useRef(); const fileInput = useRef(); const requestLock = useRef(false);
  const warnings = getDesignWarnings(design);

  useEffect(() => {
    let active = true;
    Promise.allSettled([api('/health'), api('/versions')]).then(([status, saved]) => {
      if (!active) return;
      setHealth(status.status === 'fulfilled' ? status.value : { mode: 'offline' });
      if (saved.status === 'fulfilled') setVersions(saved.value.versions || []);
      else setNotice({ text: '版本服务暂时不可用，当前设计仍会保存在本浏览器。', type: 'error' });
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ design, locked, messages: messages.slice(-30) })); }
    catch { setNotice({ text: '浏览器存储不可用，请导出设计文件保留当前方案。', type: 'error' }); }
  }, [design, locked, messages]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages, busy]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), 5500); return () => clearTimeout(timer); }, [notice]);

  function notify(text, type = 'success') { setNotice({ text, type }); }
  function commit(candidate, respectLocks = true) {
    const next = respectLocks ? applyLocks(design, candidate, locked) : candidate;
    const parsed = DesignSchema.safeParse(next);
    if (!parsed.success) { notify('这份设计数据不符合当前支持的外观格式。', 'error'); return false; }
    if (!changedFields(design, next).length) return false;
    const nextHistory = [...history.slice(0, cursor + 1), next].slice(-60);
    setHistory(nextHistory); setCursor(nextHistory.length - 1);
    return true;
  }
  function edit(patch) {
    if (busy) return;
    if (!commit({ ...design, ...patch })) notify('当前属性已锁定，或已是所选样式。');
  }
  function preset(p) {
    if (busy) return;
    if (commit(p.design)) notify(`已应用「${p.name}」${locked.length ? '，锁定部分保持不变' : ''}`);
    else notify('已保留当前方案；可解锁属性后再切换风格。');
  }
  async function send(text = input) {
    const message = text.trim();
    if (!message || requestLock.current) return;
    requestLock.current = true; setBusy(true); setInput('');
    const previousMessages = messages;
    setMessages([...messages, { role: 'user', content: message }]);
    try {
      const result = await api('/design', { method: 'POST', body: JSON.stringify({ message, design, locked, history: previousMessages.slice(-10).map(({ role, content }) => ({ role, content })) }) });
      const valid = DesignSchema.safeParse(result.design);
      if (!valid.success) throw new Error('模型返回的设计无法使用，已保留当前方案。');
      commit(valid.data);
      setMessages(current => [...current, { role: 'assistant', content: result.reply, changes: result.changes || [] }]);
      setHealth(current => ({ ...current, mode: result.mode }));
    } catch (error) {
      setMessages(current => [...current, { role: 'assistant', content: `这次修改没有完成：${error.message}`, error: true }]);
      setInput(message);
    } finally { setBusy(false); requestLock.current = false; }
  }
  async function saveVersion() {
    if (saving) return;
    setSaving(true);
    try {
      const result = await api('/versions', { method: 'POST', body: JSON.stringify({ name: saveName.trim() || design.name, design }) });
      setVersions(current => [result.version, ...current]); setModal(null); notify('方案已保存，可随时恢复或比较。');
    } catch (error) { notify(error.message, 'error'); }
    finally { setSaving(false); }
  }
  async function removeVersion(version) {
    try {
      await api(`/versions/${version.id}`, { method: 'DELETE' });
      setVersions(current => current.filter(x => x.id !== version.id)); setModal(null); notify('已删除这个保存版本，当前设计不受影响。');
    } catch (error) { notify(error.message, 'error'); }
  }
  async function exportFile(kind) {
    if (exporting) return;
    setExporting(true);
    try {
      if (kind === 'png') await sceneRef.current.screenshot();
      if (kind === 'glb') await sceneRef.current.exportGLB();
      if (kind === 'json') downloadJson({ schemaVersion: 1, stage: 'appearance', furnitureType: 'sideboard', units: 'm', engineeringVerified: false, exportedAt: new Date().toISOString(), design, locked }, `FORM-${design.name}.json`);
      notify('文件已导出。');
    } catch (error) { notify(`导出失败：${error.message}`, 'error'); }
    finally { setExporting(false); }
  }
  async function importFile(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error('设计文件不能超过 1 MB。');
      const data = JSON.parse(await file.text());
      if (data.schemaVersion !== 1 || data.furnitureType !== 'sideboard') throw new Error('仅支持此工作台导出的第一版边柜设计文件。');
      const next = DesignSchema.parse(data.design);
      const importedLocks = Array.isArray(data.locked) ? data.locked.filter(x => x in lockLabels) : [];
      commit(next, false); setLocked(importedLocks); notify('已恢复设计文件。');
    } catch { notify('无法读取设计文件，请选择本工作台导出的有效 JSON 文件。', 'error'); }
  }
  const modeLabel = !health ? '连接中' : health.mode === 'demo' ? '本地演示' : health.mode === 'offline' ? '服务未连接' : 'AI 已连接';
  const currentMaterial = materialTarget === 'all' ? design.doorMaterial : design[materialTarget];

  return <div className="app-shell">
    <header className="header">
      <a href="/" className="brand" aria-label="FORM 家具共创首页"><span className="brand-mark"><i /><i /><i /></span><strong>FORM<span>®</span></strong><span className="brand-caption">家具共创工作台</span></a>
      <nav className="stages" aria-label="设计阶段">
        <button className="stage active" onClick={() => setModal({ type: 'stages' })}><span>01</span> 外观共创</button><ChevronRight size={13} />
        <button className="stage" onClick={() => setModal({ type: 'stages' })}><span>02</span> 设计深化</button><ChevronRight size={13} />
        <button className="stage" onClick={() => setModal({ type: 'stages' })}><span>03</span> 生产工程</button>
      </nav>
      <button className="help-button" onClick={() => setModal({ type: 'help' })}><CircleHelp size={17} /><span>使用指南</span></button>
    </header>

    <main>
      <section className="page-heading">
        <div><div className="eyebrow"><span /> YOUR IDEA, TAKING SHAPE</div><h1>让想象，有形可见<span>。</span></h1><p>从一个念头开始，和 AI 一起设计属于你的家具。</p></div>
        <div className="heading-actions"><span className="draft-status"><span /> 本机草稿自动保存</span><button className="button secondary" disabled={busy} onClick={() => setModal({ type: 'export' })}><ArrowDownToLine size={16} />导出方案</button><button className="button primary" disabled={busy} onClick={() => { setSaveName(design.name); setModal({ type: 'save' }); }}><Plus size={17} />保存版本</button></div>
      </section>

      <div className="workspace">
        <aside className="inspiration-panel panel">
          <div className="panel-heading"><span><Layers3 size={16} />灵感起点</span><span className="tiny-label">01 / 边柜</span></div>
          <p className="panel-intro">选一个方向，再让它更像你。</p>
          <div className="preset-list">{PRESETS.map((p, index) => <button key={p.id} disabled={busy} className={`preset-card ${design.style === p.id ? 'selected' : ''}`} onClick={() => preset(p)}>
            <div className={`preset-visual preset-${p.id}`}><span className="preset-number">0{index + 1}</span><MiniCabinet design={p.design} />{design.style === p.id && <span className="preset-check"><Check size={12} /></span>}</div>
            <div className="preset-caption"><strong>{p.name}</strong><span>{p.description}</span></div>
          </button>)}</div>
          <div className="inspiration-note"><span className="small-star">✳</span><p>好设计，从感觉开始。<br /><span>细节可以在对话中慢慢打磨。</span></p></div>
          <button className="text-button import-button" disabled={busy} onClick={() => fileInput.current.click()}><Plus size={14} />导入已有设计</button><input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={importFile} />
        </aside>

        <section className="design-panel">
          <div className="viewport" ref={viewport}>
            <div className="viewport-top"><span className="live-badge"><span />实时三维预览</span><div className="viewport-actions"><button className="glass-button" title="恢复默认视角" aria-label="恢复默认视角" onClick={() => { setView('perspective'); sceneRef.current?.resetCamera(); }}><RotateCcw size={16} /></button><button className="glass-button" title="全屏预览" aria-label="全屏预览" onClick={() => { const action = document.fullscreenElement ? document.exitFullscreen() : viewport.current.requestFullscreen?.(); action?.catch(() => notify('此浏览器暂不支持全屏预览。', 'error')); }}><Expand size={16} /></button></div></div>
            <Scene ref={sceneRef} design={design} view={view} />
            <div className="viewport-title"><span>FORM COLLECTION / 001</span><h2>{design.name}</h2><p>外观概念 · 尺寸与结构尚未深化</p></div>
            <div className="viewport-bottom"><span className="orbit-hint"><ScanLine size={14} />拖动旋转 · 滚轮缩放</span><div className="view-switch" aria-label="模型视角">{[['perspective', '自由'], ['front', '正面'], ['side', '侧面'], ['back', '背面']].map(([id, label]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>{label}</button>)}</div><button className="glass-button" title="下载当前画面" aria-label="下载当前画面" disabled={exporting} onClick={() => exportFile('png')}><Download size={16} /></button></div>
          </div>
          <div className="edit-bar"><span><Box size={15} />边柜 <i /> 外观探索</span><div><button disabled={busy || cursor === 0} onClick={() => setCursor(cursor - 1)} title="撤销" aria-label="撤销"><Undo2 size={16} /></button><button disabled={busy || cursor === history.length - 1} onClick={() => setCursor(cursor + 1)} title="重做" aria-label="重做"><Redo2 size={16} /></button><span className="edit-count">{cursor + 1} / {history.length}</span></div></div>
          <div className="customization panel">
            <div className="customization-heading"><h3><SlidersHorizontal size={15} />轻轻一改，换种感觉</h3><span>即时预览</span></div>
            <div className="material-row"><div className="control-label"><label htmlFor="materialTarget">材质</label><select id="materialTarget" value={materialTarget} onChange={e => setMaterialTarget(e.target.value)}><option value="all">柜体 + 门板</option><option value="bodyMaterial">仅柜体</option><option value="doorMaterial">仅门板</option><option value="topMaterial">仅台面</option></select></div><div className="swatches">{Object.entries(MATERIALS).filter(([id]) => id !== 'travertine' || materialTarget === 'topMaterial').map(([id, material]) => <button key={id} className={`swatch ${currentMaterial === id ? 'selected' : ''}`} title={material.label} aria-label={`材质：${material.label}`} aria-pressed={currentMaterial === id} disabled={busy || locked.includes('material')} onClick={() => edit(materialTarget === 'all' ? { bodyMaterial: id, doorMaterial: id } : { [materialTarget]: id })}><span className={`swatch-color ${material.kind}`} style={{ backgroundColor: material.color }}>{currentMaterial === id && <Check size={15} color={['walnut', 'charcoal'].includes(id) ? '#fff' : '#3c4539'} />}</span><span>{material.label}</span></button>)}</div></div>
            <div className="shape-row"><span className="control-label">门面</span><div className="segmented">{[['fluted', '细腻竖纹'], ['plain', '简洁平面']].map(([id, label]) => <button disabled={busy || locked.includes('detail')} key={id} className={design.detail === id ? 'active' : ''} onClick={() => edit({ detail: id })}>{label}</button>)}</div><span className="shape-divider" /><span className="control-label">底部</span><div className="segmented">{[['round', '圆腿'], ['tapered', '锥腿'], ['plinth', '落地'], ['floating', '悬浮']].map(([id, label]) => <button disabled={busy || locked.includes('shape')} key={id} className={design.legStyle === id ? 'active' : ''} onClick={() => edit({ legStyle: id })}>{label}</button>)}</div></div>
          </div>
        </section>

        <aside className="chat-panel panel">
          <div className="chat-heading"><div className="assistant-icon"><Sparkles size={19} /></div><div><h2>你的设计搭档</h2><span className={`mode-label ${health?.mode === 'offline' ? 'offline' : ''}`}><i />{modeLabel}</span></div><button className="icon-button" aria-label="了解语言模式" onClick={() => setModal({ type: 'help' })}><MoreHorizontal size={20} /></button></div>
          <div className="chat-messages" aria-live="polite"><div className="chat-date">从这里，开始你的定制</div>{messages.map((message, index) => <div className={`chat-message ${message.role} ${message.error ? 'error' : ''}`} key={index}>{message.role === 'assistant' && <span className="message-avatar"><Sparkles size={13} /></span>}<div><p>{message.content}</p>{message.changes?.length > 0 && <span className="message-changes"><CheckCheck size={13} />已更新 {message.changes.length} 项外观</span>}</div></div>)}{busy && <div className="chat-message assistant"><span className="message-avatar"><Sparkles size={13} /></span><div className="thinking"><span /><span /><span /><small>正在构思这次修改</small></div></div>}<div ref={chatEnd} /></div>
          <div className="chat-controls">
            <div className="suggestions"><span>试着这样说</span>{promptSuggestions.map(text => <button key={text} disabled={busy} onClick={() => send(text)}>{text}<ArrowUp size={12} /></button>)}</div>
            <div className="lock-section"><div><LockKeyhole size={12} /><span>保留你喜欢的部分</span></div><div className="lock-options">{Object.entries(lockLabels).map(([id, label]) => <button key={id} disabled={busy} aria-pressed={locked.includes(id)} className={locked.includes(id) ? 'locked' : ''} onClick={() => setLocked(current => current.includes(id) ? current.filter(x => x !== id) : [...current, id])}>{locked.includes(id) ? <LockKeyhole size={11} /> : <UnlockKeyhole size={11} />}{label}</button>)}</div></div>
            <form className={`composer ${busy ? 'busy' : ''}`} onSubmit={e => { e.preventDefault(); send(); }}><textarea aria-label="描述你想修改的家具外观" maxLength={2000} value={input} onChange={e => setInput(e.target.value)} placeholder={'描述你想要的样子，比如：\n圆润一点，换成浅橡木…'} disabled={busy} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} /><div><span>Enter 发送 · Shift + Enter 换行</span><button type="submit" aria-label="发送修改要求" disabled={busy || !input.trim()}>{busy ? <LoaderCircle size={17} className="spin" /> : <ArrowUp size={18} />}</button></div></form>
            <p className="mode-footnote">{health?.mode === 'demo' ? '当前为规则演示，支持边柜的有限外观修改。' : health?.mode === 'offline' ? '启动本地 API 服务后，即可使用语言修改。' : '设计想法实时呈现，工程细节将在深化阶段确认。'}</p>
          </div>
        </aside>
      </div>

      <section className="versions-section"><div className="section-heading"><div><History size={17} /><h2>留住每一个好想法</h2><span>{versions.length} 个已保存版本</span></div><button className="text-button" disabled={busy} onClick={() => { setSaveName(`${design.name} · ${versions.length + 1}`); setModal({ type: 'save' }); }}><Plus size={14} />保存当前方案</button></div>
        {versions.length ? <div className="version-list">{versions.map((version, index) => <div className="version-card" key={version.id}><MiniCabinet design={version.design} /><div className="version-info"><span>VERSION {String(versions.length - index).padStart(2, '0')}</span><strong>{version.name}</strong><time>{new Date(version.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time><div><button disabled={busy} onClick={() => { commit(version.design, false); notify('已恢复保存版本，仍可撤销此次操作。'); }}>恢复</button><button onClick={() => setModal({ type: 'compare', version })}><ArrowLeftRight size={12} />比较</button><button aria-label={`删除版本 ${version.name}`} onClick={() => setModal({ type: 'delete', version })}><X size={12} /></button></div></div></div>)}</div> : <div className="empty-versions"><div className="empty-icon"><Copy size={22} /></div><div><strong>喜欢现在的方向？先保存下来。</strong><p>保留不同尝试，随时回来比较，不必担心错过灵感。</p></div><button className="button secondary" disabled={busy} onClick={() => { setSaveName(design.name); setModal({ type: 'save' }); }}><Plus size={15} />保存第一个版本</button></div>}
      </section>

      <footer><span><span className="footer-mark">✳</span> 为每一种生活，设计一种可能。</span><button className="text-button" onClick={() => setModal({ type: 'cost' })}>外观阶段 · 制作提示 {warnings.length > 0 && <span className="count-badge">{warnings.length}</span>}<ChevronRight size={13} /></button></footer>
    </main>

    {notice && <div role="status" className={`toast ${notice.type}`}>{notice.type === 'error' ? <CircleHelp size={17} /> : <Check size={17} />}{notice.text}<button aria-label="关闭提示" onClick={() => setNotice(null)}><X size={14} /></button></div>}
    {modal?.type === 'save' && <Modal title="保存这个设计方向" onClose={() => setModal(null)}><p className="modal-copy">给这次尝试起个名字，之后可以随时恢复或与新方案比较。</p><form onSubmit={e => { e.preventDefault(); saveVersion(); }}><label className="field-label" htmlFor="version-name">版本名称</label><input autoFocus id="version-name" className="text-input" maxLength={60} value={saveName} onChange={e => setSaveName(e.target.value)} required /><div className="modal-preview"><MiniCabinet design={design} /><span>{design.name}<small>{MATERIALS[design.doorMaterial].label} · {design.detail === 'fluted' ? '竖纹门面' : '平面门面'}</small></span></div><button className="button primary full" disabled={saving}>{saving ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}{saving ? '正在保存' : '保存版本'}</button></form></Modal>}
    {modal?.type === 'export' && <Modal title="带走你的设计" onClose={() => setModal(null)}><p className="modal-copy">保存画面、查看三维模型，或保留可继续编辑的设计文件。</p><div className="export-options">{[['png', '当前视角图片', 'PNG · 与三维预览保持一致'], ['glb', '三维外观模型', 'GLB · 可在兼容的三维软件中打开'], ['json', '可编辑设计文件', 'JSON · 可导入本工作台继续修改']].map(([id, title, subtitle]) => <button key={id} disabled={exporting} onClick={() => exportFile(id)}><span className="file-type">{id.toUpperCase()}</span><span><strong>{title}</strong><small>{subtitle}</small></span>{exporting ? <LoaderCircle size={17} className="spin" /> : <ArrowDownToLine size={17} />}</button>)}</div><p className="muted-note">导出的是外观概念，不能直接作为生产图纸。</p></Modal>}
    {modal?.type === 'compare' && <Modal title="看看两种可能" wide onClose={() => setModal(null)}><div className="comparison"><div><h3>{modal.version.name}<span>已保存版本</span></h3><Scene design={modal.version.design} /></div><div><h3>{design.name}<span>当前设计</span></h3><Scene design={design} /></div></div><p className="muted-note">拖动模型可分别查看细节。</p></Modal>}
    {modal?.type === 'delete' && <Modal title="删除保存版本" onClose={() => setModal(null)}><p className="modal-copy">删除「{modal.version.name}」后无法从版本列表恢复。当前正在编辑的设计会保留。</p><div className="modal-actions"><button className="button secondary" onClick={() => setModal(null)}>保留版本</button><button className="button danger" onClick={() => removeVersion(modal.version)}>删除版本</button></div></Modal>}
    {modal?.type === 'cost' && <Modal title="制作前，留意这些细节" onClose={() => setModal(null)}><p className="modal-copy">此阶段只探索外观，以下提示帮助你了解可能影响制作的选择，不代表报价或结构结论。</p><div className="note-list">{(warnings.length ? warnings : ['当前没有额外外观提示，具体材料、结构和成本仍需在后续阶段确认。']).map((text, i) => <p key={text}><span>0{i + 1}</span>{text}</p>)}</div></Modal>}
    {modal?.type === 'stages' && <Modal title="从想法，到真实的家具" onClose={() => setModal(null)}><div className="stage-explanation"><div className="current"><span>01</span><section><h3>外观共创 <em>当前阶段</em></h3><p>探索整体造型、材质和比例，保存你喜欢的设计方向。</p></section></div><div><span>02</span><section><h3>设计深化 <em>后续建设</em></h3><p>确认精确尺寸、功能、材料，形成详细模型与外观尺寸图。</p></section></div><div><span>03</span><section><h3>生产工程 <em>后续建设</em></h3><p>结合工厂经验完成结构、装配、工艺与可靠性验证，审核后发布生产图纸。</p></section></div></div></Modal>}
    {modal?.type === 'help' && <Modal title="把你的想法，说出来" onClose={() => setModal(null)}><div className="help-content"><p>这版工作台专注边柜外观。先选择一个灵感，再通过语言或材质按钮修改，喜欢的部分可以锁定保留。</p><h3>现在可以尝试</h3><ul><li>“柜体换成胡桃木，台面改成洞石”</li><li>“改成三扇门，圆润一点”</li><li>“去掉竖纹，把底部改成悬浮”</li></ul><p>保存版本用于比较不同方向；导出 JSON 后可以再次导入。PNG 与 GLB 用于分享画面和三维外观。</p><div className="help-mode"><strong>当前模式：{modeLabel}</strong><p>{health?.mode === 'demo' ? '尚未接入语言模型。当前使用本地规则解析，无法理解任意复杂描述；不支持的要求会明确反馈。真实 AI 接入方式见项目 README。' : health?.mode === 'offline' ? 'API 服务暂未连接，请按 README 启动完整项目。' : '语言请求由服务端模型处理，修改范围仍受当前边柜造型能力限制。'}</p></div></div></Modal>}
  </div>;
}

import { useEffect, useRef, useState } from 'react';
import { Check, Plus, Trash2, X } from 'lucide-react';
import { parseScript, scriptToText, type ScriptContent } from './script';

type Props = { script: ScriptContent; title: string; onClose: () => void; onSave: (script: ScriptContent, title: string) => void };

export default function ScriptEditor({ script, title, onClose, onSave }: Props) {
  const [mode, setMode] = useState<'default' | 'manual'>(Array.isArray(script) ? 'manual' : 'default');
  const [draft, setDraft] = useState(() => scriptToText(script));
  const [draftTitle, setDraftTitle] = useState(title);
  const [blocks, setBlocks] = useState(() => (Array.isArray(script) && script.length ? script : ['']).map((text, id) => ({ id, text })));
  const nextId = useRef(blocks.length);
  const [focusId, setFocusId] = useState<number | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const content: ScriptContent = mode === 'manual' ? blocks.map(block => block.text) : draft;
  const paragraphs = parseScript(content);
  const count = scriptToText(content).length;

  useEffect(() => {
    if (focusId === null || mode !== 'manual') return;
    list.current?.querySelector<HTMLTextAreaElement>(`[data-block="${focusId}"] textarea`)?.focus();
  }, [focusId, mode]);

  function addAfter(index: number) {
    if (blocks.length >= 2000) return;
    const id = nextId.current++;
    setBlocks(previous => [...previous.slice(0, index + 1), { id, text: '' }, ...previous.slice(index + 1)]);
    setFocusId(id); setError('');
  }
  function submit() {
    if (!paragraphs.length) { setError('请至少填写一个段落。'); return; }
    if (count > 200000 || paragraphs.length > 2000) { setError('讲稿最多 20 万字、2000 段，请精简后保存。'); return; }
    onSave(mode === 'manual' ? paragraphs.map(paragraph => paragraph.text) : draft, draftTitle.trim() || '未命名讲稿');
  }

  return <div className="modal-backdrop" onClick={onClose}>
    <section className="modal editor" role="dialog" aria-modal="true" aria-label="编辑讲稿" onClick={event => event.stopPropagation()}>
      <div className="modal-head"><div><h2>准备你的讲稿</h2><p>{mode === 'manual' ? '每个输入框为一段，按你的讲述节奏粘贴。' : '用空行分隔段落，直播时可随时跳转。'}</p></div><button className="icon-button" aria-label="关闭编辑" onClick={onClose}><X size={20}/></button></div>
      <div className="editor-modes" role="group" aria-label="分段方式">
        <button aria-pressed={mode === 'default'} onClick={() => { setMode('default'); setError(''); }}>默认分段</button>
        <button aria-pressed={mode === 'manual'} onClick={() => { setMode('manual'); setError(''); }}>手动分段</button>
      </div>
      <label className="field-label">讲稿标题<input value={draftTitle} maxLength={80} onChange={event => setDraftTitle(event.target.value)}/></label>
      {mode === 'default' ? <textarea aria-label="讲稿正文" value={draft} onChange={event => { setDraft(event.target.value); setError(''); }} spellCheck={false}/> : <>
        <p className="manual-editor-hint">框内换行不会拆段，空白框不会保存。用右侧按钮新增或删除段落。</p>
        <div className="manual-paragraph-list" ref={list}>
          {blocks.map((block, index) => <div className="manual-paragraph" data-block={block.id} key={block.id}>
            <label><span>第 {index + 1} 段</span><textarea aria-label={`第 ${index + 1} 段正文`} placeholder="在这里粘贴这一段讲稿…" value={block.text} onChange={event => { const text = event.target.value; setBlocks(previous => previous.map(item => item.id === block.id ? { ...item, text } : item)); setError(''); }} spellCheck={false}/></label>
            <div className="paragraph-edit-actions">
              <button aria-label={`在第 ${index + 1} 段后新增段落`} title="在此段后新增" disabled={blocks.length >= 2000} onClick={() => addAfter(index)}><Plus size={17}/></button>
              <button aria-label={`删除第 ${index + 1} 段`} title={blocks.length === 1 ? '至少保留一个输入框' : '删除此段'} disabled={blocks.length === 1} onClick={() => { setBlocks(previous => previous.filter(item => item.id !== block.id)); setError(''); }}><Trash2 size={16}/></button>
            </div>
          </div>)}
        </div>
      </>}
      {error && <p className="editor-error" role="alert">{error}</p>}
      <div className="modal-footer"><span>{paragraphs.length} 段 · {count.toLocaleString()} 字</span><div><button className="quiet-button" onClick={onClose}>取消</button><button className="primary-button" onClick={submit}>保存并使用<Check size={16}/></button></div></div>
    </section>
  </div>;
}

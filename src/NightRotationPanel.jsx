import React, { useMemo, useState } from 'react';
import { ChevronUp, ChevronDown, X, UserPlus, AlertTriangle, RefreshCcw, Moon } from 'lucide-react';

// =====================================================================================
// 大夜（P）輪序面板
// - 以「週」為單位：每週 週六 → 下週四（共 6 天，週五不排大夜）
// - 計入的班別代碼：P、P#、P(國)（SP、HP 不計入）
// - 顯示範圍：今天往前 1 個月 ～ 往後 12 個月
// - 「預排」欄是這裡自己儲存的計畫（不連動班表）；「班表實際」欄即時讀取班表（含換班結果）
// - 預排順序（右側名單）為手動維護，不連動班表
// - 手動指定某一週只改那一週，其他週不會被動到；「跳過」才會讓後面「未指定」的週順延
// - 所有編輯只改畫面上的草稿，需由上層「暫存／發布」才會寫入雲端
// =====================================================================================

const pad = (n) => String(n).padStart(2, '0');
const fmtD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
const weekStartSat = (d) => addDays(d, -((d.getDay() + 1) % 7));
const isPCode = (c) => String(c || '').trim().replace('(國)', '').replace('（國）', '').replace('#', '') === 'P';
const WD = ['日', '一', '二', '三', '四', '五', '六'];

// 依「預排順序」重排：fromKey 之後（含）、未手動指定、未跳過的週，依序輪流指派；
// 之前的週只用來推算目前輪到誰。keys 之中 >= currentKey 且尚未存在的週會一併補齊。
export const rebuildSlots = (p, fromKey, currentKey, keys) => {
  const q = p.queue || [];
  if (!q.length) return p;
  const slots = { ...(p.slots || {}) };
  let ptr = 0;
  const all = [...new Set([...Object.keys(slots), ...keys.filter(k => k >= currentKey)])].sort();
  for (const k of all) {
    const s = slots[k];
    if (s && s.skip) continue;
    if (s && s.manual) continue;
    if (s && k < fromKey) {
      const i = q.indexOf(s.empId);
      if (i >= 0) ptr = (i + 1) % q.length;
      continue;
    }
    slots[k] = { ...(s || {}), empId: q[ptr % q.length], skip: false, manual: false };
    ptr = (ptr + 1) % q.length;
  }
  return { ...p, slots };
};

const NightRotationPanel = ({ p, setP, canEdit, isAdmin, schedule, activeEmployees, nameOf }) => {
  const [open, setOpen] = useState(true);
  const [addId, setAddId] = useState('');

  const today = useMemo(() => new Date(), []);
  const todayKey = fmtD(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  // 今天若是週五（不在任何一週內），「本週」視為下一個週六開始的那一週
  const currentKey = useMemo(() => {
    const ws = weekStartSat(today);
    return fmtD(today.getDay() === 5 ? addDays(ws, 7) : ws);
  }, [today]);

  const keys = useMemo(() => {
    const start = weekStartSat(new Date(today.getFullYear(), today.getMonth() - 1, today.getDate()));
    const end = new Date(today.getFullYear(), today.getMonth() + 12, today.getDate());
    const arr = [];
    for (let d = start; d <= end; d = addDays(d, 7)) arr.push(fmtD(d));
    return arr;
  }, [today]);

  const queue = p?.queue || [];
  const slots = p?.slots || {};

  // 班表姓名 → 員編
  const nameToId = useMemo(() => {
    const m = {};
    (activeEmployees || []).forEach(e => { if (!e.isSeparator && e.name) m[e.name] = String(e.id); });
    return m;
  }, [activeEmployees]);

  // ---- 從班表讀出每週實際的大夜 ----
  const actualByKey = useMemo(() => {
    const res = {};
    keys.forEach(k => {
      const start = parseD(k);
      const counts = {};
      let known = 0;
      for (let i = 0; i < 6; i++) {
        const d = addDays(start, i);
        const ms = schedule?.[`${d.getFullYear()}-${pad(d.getMonth() + 1)}`];
        if (!ms) continue;
        known++;
        const day = d.getDate();
        Object.keys(ms).forEach(name => {
          if (!nameToId[name]) return;
          if (isPCode(ms[name]?.[day])) counts[name] = (counts[name] || 0) + 1;
        });
      }
      const names = Object.keys(counts);
      if (known === 0) res[k] = { kind: 'nodata' };
      else if (names.length === 0) res[k] = { kind: 'empty', known };
      else if (names.length === 1 && counts[names[0]] === known) res[k] = { kind: 'whole', name: names[0], partial: known < 6 };
      else res[k] = { kind: 'split', counts, known };
    });
    return res;
  }, [keys, schedule, nameToId]);

  // ---- 預排順序統計 ----
  const stats = useMemo(() => {
    const m = {};
    queue.forEach(id => { m[id] = { count: 0, last: '', next: '' }; });
    Object.keys(slots).sort().forEach(k => {
      const s = slots[k];
      if (!s || s.skip || !m[s.empId]) return;
      if (k < currentKey) m[s.empId].last = k;
      else {
        if (keys.includes(k)) m[s.empId].count++;
        if (!m[s.empId].next) m[s.empId].next = k;
      }
    });
    return m;
  }, [queue, slots, currentKey, keys]);

  const fmtShort = (k) => { if (!k) return '—'; const d = parseD(k); return `${d.getMonth() + 1}/${d.getDate()}`; };

  // ---- 編輯操作（只改草稿）----
  const apply = (next) => setP(next);
  const base = () => ({ queue: [...queue], slots: { ...slots } });

  const moveQueue = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= queue.length) return;
    const b = base();
    [b.queue[idx], b.queue[j]] = [b.queue[j], b.queue[idx]];
    apply(b);
  };
  const removeFromQueue = (id) => {
    if (!window.confirm(`將「${nameOf(id)}」移出大夜預排順序？（已排好的週次不會改動，需要時再按「依順序重排」）`)) return;
    const b = base();
    b.queue = b.queue.filter(x => x !== id);
    apply(b);
  };
  const addToQueue = () => {
    if (!addId || queue.includes(addId)) return;
    const b = base();
    b.queue.push(addId);
    apply(b);
    setAddId('');
  };
  const fillFuture = () => apply(rebuildSlots(base(), '9999-99-99', currentKey, keys));
  const reflowAll = () => {
    if (!window.confirm('依目前預排順序，重排「本週起、未手動指定、未跳過」的所有週？\n（手動指定的週不會被動到）')) return;
    apply(rebuildSlots(base(), currentKey, currentKey, keys));
  };
  const setManual = (k, empId) => {
    const b = base();
    if (!empId) return;
    if (empId === '__clear__') { delete b.slots[k]; apply(b); return; }
    b.slots[k] = { ...(b.slots[k] || {}), empId, skip: false, manual: true };
    apply(b);
  };
  const clearManual = (k) => {
    const b = base();
    if (b.slots[k]) b.slots[k] = { ...b.slots[k], manual: false };
    apply(b);
  };
  const toggleSkip = (k) => {
    const b = base();
    const cur = b.slots[k];
    if (cur && cur.skip) {
      b.slots[k] = { empId: '', skip: false, manual: false };
    } else {
      const skipped = Object.keys(b.slots).filter(x => b.slots[x]?.skip && Math.abs(parseD(x) - parseD(k)) < 366 * 86400000);
      if (skipped.length >= 2 && !window.confirm('一年內已經有 2 週標記為「跳過」（通常只有農曆過年會跳過，最多 2 週）。\n確定要再多跳過一週嗎？')) return;
      b.slots[k] = { empId: '', skip: true, manual: false };
    }
    apply(rebuildSlots(b, k, currentKey, keys));
  };

  const addable = useMemo(() => (activeEmployees || [])
    .filter(e => !e.isSeparator && e.id && String(e.role) === '1' && !String(e.name || '').includes('�') && !queue.includes(String(e.id)))
    .sort((a, b) => String(a.id).localeCompare(String(b.id))), [activeEmployees, queue]);
  const pickable = useMemo(() => {
    const ids = [...queue];
    (activeEmployees || []).forEach(e => { if (!e.isSeparator && e.id && String(e.role) === '1' && !String(e.name || '').includes('�') && !ids.includes(String(e.id))) ids.push(String(e.id)); });
    return ids;
  }, [queue, activeEmployees]);

  const editable = canEdit && isAdmin;
  const hasSlots = Object.keys(slots).length > 0;

  return (
    <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
      <button onClick={() => setOpen(v => !v)} className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 bg-indigo-50">
        <span className="font-black text-indigo-700 text-sm flex items-center gap-2"><Moon size={16} /> 大夜（P）輪序
          <span className="text-[11px] font-bold text-gray-400">每週六 ～ 下週四（6 天，週五不排）｜計入 P、P#、P(國)</span>
        </span>
        <span className="text-gray-400 text-xs font-black">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="p-3 border-t grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* 左：每週排序 */}
          <div className="lg:col-span-2 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="text-[11px] font-bold text-gray-500">「預排」＝輪序計畫；「班表實際」＝即時讀取班表（含換班）。過去 1 個月～未來 12 個月。</div>
              {editable && (
                <div className="flex gap-2">
                  <button onClick={fillFuture} className="text-[11px] font-black text-white bg-indigo-500 hover:bg-indigo-600 px-2.5 py-1 rounded-lg">補齊未排的週</button>
                  <button onClick={reflowAll} className="text-[11px] font-black text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg flex items-center gap-1"><RefreshCcw size={11} /> 依順序重排</button>
                </div>
              )}
            </div>
            <div className="border rounded-xl overflow-auto" style={{ maxHeight: '480px' }}>
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500 sticky top-0 z-10">
                  <tr>
                    <th className="p-2 text-left whitespace-nowrap">週期（六～四）</th>
                    <th className="p-2 text-left whitespace-nowrap">預排</th>
                    <th className="p-2 text-left whitespace-nowrap">班表實際</th>
                    {editable && <th className="p-2 text-left whitespace-nowrap">操作</th>}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {keys.map(k => {
                    const start = parseD(k);
                    const end = addDays(start, 5);
                    const s = slots[k];
                    const past = k < currentKey;
                    const isCur = k === currentKey;
                    const act = actualByKey[k] || { kind: 'nodata' };
                    const planName = s && !s.skip && s.empId ? nameOf(s.empId) : '';
                    let warn = '';
                    let actualCell = <span className="text-gray-300">—</span>;
                    if (act.kind === 'whole') {
                      const diff = planName && act.name !== planName;
                      if (s && s.skip) warn = '此週設為跳過，但班表有排大夜';
                      else if (diff) warn = '與預排不同';
                      actualCell = <span className={`font-black ${diff || (s && s.skip) ? 'text-red-600' : 'text-gray-800'}`}>{act.name}{act.partial ? <span className="text-[10px] text-gray-400 font-bold ml-1">（部分月份尚未載入）</span> : null}</span>;
                    } else if (act.kind === 'split') {
                      warn = '非整週：大夜只能整週換班';
                      actualCell = <span className="font-black text-red-600">{Object.entries(act.counts).map(([n, c]) => `${n}(${c}天)`).join('、')}</span>;
                    } else if (act.kind === 'empty') {
                      if (!(s && s.skip) && !past) warn = '班表尚未排大夜';
                      actualCell = <span className="text-gray-300">{s && s.skip ? '（跳過）' : '未排'}</span>;
                    }
                    return (
                      <tr key={k} className={`align-top ${isCur ? 'bg-yellow-50' : past ? 'bg-gray-50 text-gray-400' : ''} ${warn ? 'ring-1 ring-inset ring-red-200' : ''}`}>
                        <td className="p-2 whitespace-nowrap font-mono">
                          <span className="text-[10px] text-gray-400 mr-1">{start.getFullYear()}</span>
                          {start.getMonth() + 1}/{start.getDate()}({WD[start.getDay()]})～{end.getMonth() + 1}/{end.getDate()}({WD[end.getDay()]})
                          {isCur && <span className="ml-1 text-[9px] bg-amber-500 text-white px-1 py-0.5 rounded-full font-black">本週</span>}
                        </td>
                        <td className="p-2 whitespace-nowrap">
                          {s && s.skip ? <span className="text-[11px] font-black text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded">跳過（過年班）</span>
                            : planName ? <span className="font-black text-gray-800">{planName}{s.manual && <span className="ml-1 text-[9px] bg-indigo-100 text-indigo-600 px-1 py-0.5 rounded-full font-black">指定</span>}</span>
                              : <span className="text-gray-300">未排</span>}
                        </td>
                        <td className="p-2">
                          {actualCell}
                          {warn && <div className="text-[10px] font-black text-red-600 flex items-center gap-0.5 mt-0.5"><AlertTriangle size={10} />{warn}</div>}
                        </td>
                        {editable && (
                          <td className="p-2 whitespace-nowrap">
                            {!past && (
                              <div className="flex items-center gap-1">
                                <select value="" onChange={e => setManual(k, e.target.value)} className="border rounded-lg px-1 py-0.5 text-[11px] bg-white max-w-24">
                                  <option value="">指定人員…</option>
                                  {pickable.map(id => <option key={id} value={id}>{nameOf(id)}</option>)}
                                  {s && <option value="__clear__">（清除此週）</option>}
                                </select>
                                {s && s.manual && <button onClick={() => clearManual(k)} className="text-[10px] font-black text-gray-400 hover:text-indigo-600">取消指定</button>}
                                <button onClick={() => toggleSkip(k)} className={`text-[10px] font-black px-1.5 py-0.5 rounded ${s && s.skip ? 'bg-rose-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-rose-50 hover:text-rose-600'}`}>{s && s.skip ? '取消跳過' : '跳過'}</button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!hasSlots && <div className="mt-2 text-[11px] text-gray-400 font-bold">{editable ? '尚未產生預排：先在右側建立「預排順序」，再按「補齊未排的週」。' : '尚未建立大夜預排。'}</div>}
          </div>

          {/* 右：預排順序 */}
          <div className="min-w-0">
            <div className="text-[12px] font-black text-gray-700 mb-2">預排順序（手動維護，不連動班表）</div>
            <div className="border rounded-xl divide-y overflow-y-auto" style={{ maxHeight: '420px' }}>
              {queue.length === 0 && <div className="p-4 text-center text-gray-300 italic text-xs font-bold">尚未建立預排順序</div>}
              {queue.map((id, idx) => {
                const st = stats[id] || { count: 0, last: '', next: '' };
                return (
                  <div key={id} className="px-2 py-1.5 flex items-center gap-1.5">
                    <span className="w-5 h-5 flex-none rounded-full text-[10px] font-black flex items-center justify-center bg-gray-100 text-gray-500">{idx + 1}</span>
                    <div className="flex-grow min-w-0">
                      <div className="text-[13px] font-bold text-gray-800 leading-tight">{nameOf(id)}</div>
                      <div className="text-[10px] text-gray-400 font-bold">上次 {fmtShort(st.last)}｜下次 {fmtShort(st.next)}</div>
                    </div>
                    <div className="flex-none text-center leading-tight">
                      <div className="text-sm font-black text-indigo-600">{st.count}</div>
                      <div className="text-[9px] text-gray-400 font-bold">預計次數</div>
                    </div>
                    {editable && (
                      <div className="flex flex-none items-center">
                        <button title="上移" onClick={() => moveQueue(idx, -1)} className="p-0.5 text-gray-400 hover:text-blue-600"><ChevronUp size={14} /></button>
                        <button title="下移" onClick={() => moveQueue(idx, 1)} className="p-0.5 text-gray-400 hover:text-blue-600"><ChevronDown size={14} /></button>
                        <button title="移出順序" onClick={() => removeFromQueue(id)} className="p-0.5 text-gray-400 hover:text-red-600"><X size={14} /></button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {editable && (
              <div className="mt-2 flex items-center gap-1">
                <select value={addId} onChange={e => setAddId(e.target.value)} className="flex-grow border rounded-lg px-2 py-1 text-xs bg-white min-w-0">
                  <option value="">加入預排順序（僅斗六一般藥師）…</option>
                  {addable.map(e => <option key={e.id} value={String(e.id)}>{e.name}（{e.id}）</option>)}
                </select>
                <button onClick={addToQueue} disabled={!addId} className="flex-none text-[11px] font-black text-white bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 px-2 py-1.5 rounded-lg flex items-center gap-1"><UserPlus size={12} /> 加入</button>
              </div>
            )}
            <div className="mt-2 text-[10px] text-gray-400 font-bold leading-relaxed">
              ※ 手動指定某週只改該週，其他週不動。<br />
              ※ 「跳過」的週不排大夜、也不計入輪序，後面「未指定」的週會順延（最多 2 週）。<br />
              ※ 大夜只能整週換班，班表若出現非整週會以紅字提示。
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NightRotationPanel;

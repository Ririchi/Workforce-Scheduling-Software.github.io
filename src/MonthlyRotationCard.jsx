import React, { useMemo, useState } from 'react';
import { ChevronUp, ChevronDown, X, UserPlus, Check, Trash2, Pencil, Star } from 'lucide-react';

// =====================================================================================
// 月輪值項目卡片（公共環境維護：冰箱、電扇…）
// - 每個月排一位藥師；每月公布一次；不連動班表，單純記錄
// - 顯示過去 1 個月 ～ 未來 3 個月；輪序表每人旁邊顯示「預計輪到 YYYY-MM」
// - 預排（淺灰字）由輪序表自動推算；點 ✓ 後變「已公告」（走上層的暫存／發布）
// - 輪序表裡「不在斗六名冊」的人（離職、帳號被移除）會被自動略過，後面全部往前挪；
//   已公告的月份保留為紀錄
// - 每個項目的輪序人員、順序各自獨立
//
// item 資料格式：
//   { id, name, queue: [empId...], start: { key:'YYYY-MM', empId, owed } | null,
//     confirmed: { 'YYYY-MM': { empId } } }
// =====================================================================================

const ymNow = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`; };
const ymAdd = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const MonthlyRotationCard = ({ item, onChange, onDelete, onRename, canEdit, activeEmployees, nameOf }) => {
  const [addId, setAddId] = useState('');
  const curYm = useMemo(() => ymNow(), []);
  const winKeys = useMemo(() => [-1, 0, 1, 2, 3].map(n => ymAdd(curYm, n)), [curYm]);
  const queue = item.queue || [];

  const activeIds = useMemo(() => new Set((activeEmployees || []).filter(e => !e.isSeparator).map(e => String(e.id))), [activeEmployees]);
  const longEnd = useMemo(() => ymAdd(curYm, Math.max(36, queue.length * 2 + 6)), [curYm, queue.length]);

  const materialize = (it) => ({ id: it.id, name: it.name, queue: [...(it.queue || [])], start: it.start || null, confirmed: { ...(it.confirmed || {}) } });

  // out: { 'YYYY-MM': { kind:'confirmed'|'plan', empId } }
  const derive = (it, endYm) => {
    const qAll = it.queue || [];
    const q = qAll.filter(id => activeIds.has(id)); // 不在名冊的人自動略過
    const confirmed = it.confirmed || {};
    const out = {};
    Object.keys(confirmed).forEach(k => { if (confirmed[k]?.empId) out[k] = { kind: 'confirmed', empId: confirmed[k].empId }; });
    let anchor = null;
    const eff = it.start || (q.length ? { key: curYm, empId: q[0], owed: {} } : null);
    if (eff && q.length) {
      let startPerson = q[0];
      const sIdx = qAll.indexOf(eff.empId);
      if (sIdx >= 0) {
        for (let s = 0; s < qAll.length; s++) {
          const c = qAll[(sIdx + s) % qAll.length];
          if (activeIds.has(c)) { startPerson = c; break; }
        }
      }
      let idx = q.indexOf(startPerson);
      const owed = { ...(eff.owed || {}) };
      const take = () => {
        for (let g = 0; g < q.length * 60; g++) {
          const c = q[idx % q.length];
          idx++;
          if (owed[c] > 0) { owed[c]--; continue; }
          return c;
        }
        return null;
      };
      for (let ym = eff.key; ym <= endYm; ym = ymAdd(ym, 1)) {
        const c = confirmed[ym]?.empId;
        if (c) {
          if (q.includes(c)) { const e = take(); if (e !== c) owed[c] = (owed[c] || 0) + 1; }
          continue;
        }
        if (!anchor && ym >= curYm) anchor = { key: ym, empId: q[idx % q.length], owed: { ...owed } };
        const who = take();
        if (who) out[ym] = { kind: 'plan', empId: who };
      }
    }
    return { out, anchor };
  };

  const derived = useMemo(() => derive(item, longEnd), [item, longEnd, activeIds, curYm]); // eslint-disable-line react-hooks/exhaustive-deps

  // 修改輪序表時，把「目前輪到誰」固定下來
  const reanchor = (it, newQueue) => {
    const m = materialize(it);
    const a = derive(m, ymAdd(curYm, 3)).anchor;
    if (!newQueue.length) return { ...m, queue: [], start: null };
    let empId = newQueue[0];
    let key = a ? a.key : curYm;
    const owed = {};
    if (a) {
      const old = m.queue;
      const i0 = Math.max(0, old.indexOf(a.empId));
      for (let s = 0; s < old.length; s++) {
        const c = old[(i0 + s) % old.length];
        if (newQueue.includes(c)) { empId = c; break; }
      }
      Object.keys(a.owed || {}).forEach(id => { if (newQueue.includes(id) && a.owed[id] > 0) owed[id] = a.owed[id]; });
    }
    return { ...m, queue: newQueue, start: { key, empId, owed } };
  };

  const moveQueue = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= queue.length) return;
    const nq = [...queue];
    [nq[idx], nq[j]] = [nq[j], nq[idx]];
    onChange(reanchor(item, nq));
  };
  const removeFromQueue = (id) => {
    if (!window.confirm(`將「${nameOf(id)}」移出「${item.name}」輪序表？（已公告的月份不會改動，後面的預排會自動往前挪）`)) return;
    onChange(reanchor(item, queue.filter(x => x !== id)));
  };
  const addOne = () => {
    if (!addId || queue.includes(addId)) return;
    onChange(reanchor(item, [...queue, addId]));
    setAddId('');
  };
  const addAll = () => {
    const ids = addable.map(e => String(e.id));
    if (!ids.length) return;
    if (!window.confirm(`將 ${ids.length} 位一般藥師依員編順序全部加入「${item.name}」輪序表？`)) return;
    onChange(reanchor(item, [...queue, ...ids]));
  };
  const setNext = (id) => {
    const m = materialize(item);
    const a = derive(m, ymAdd(curYm, 3)).anchor;
    onChange({ ...m, start: { key: a ? a.key : curYm, empId: id, owed: {} } });
  };
  const confirmMonth = (k, empId) => {
    const m = materialize(item);
    m.confirmed[k] = { empId };
    onChange(m);
  };
  const cancelMonth = (k) => {
    const m = materialize(item);
    delete m.confirmed[k];
    if (m.start && k < m.start.key) m.start = { ...m.start, key: k };
    onChange(m);
  };

  // 區間內次數、預計輪到
  const stats = useMemo(() => {
    const s = {};
    queue.forEach(id => { s[id] = { done: 0, plan: 0, next: '' }; });
    Object.keys(derived.out).sort().forEach(k => {
      const o = derived.out[k];
      if (!s[o.empId]) return;
      if (k >= curYm && !s[o.empId].next) s[o.empId].next = k;
      if (!winKeys.includes(k)) return;
      if (k < curYm && o.kind !== 'confirmed') return;
      s[o.empId][o.kind === 'confirmed' ? 'done' : 'plan']++;
    });
    return s;
  }, [queue, derived, winKeys, curYm]);

  const addable = useMemo(() => (activeEmployees || [])
    .filter(e => !e.isSeparator && e.id && String(e.role) === '1' && !String(e.name || '').includes('�') && !queue.includes(String(e.id)))
    .sort((a, b) => String(a.id).localeCompare(String(b.id))), [activeEmployees, queue]);

  return (
    <div className="bg-white rounded-xl shadow-sm border overflow-hidden flex flex-col">
      <div className="px-3 py-2 bg-emerald-50 border-b flex items-center justify-between">
        <div className="font-black text-gray-800 text-sm">{item.name} <span className="text-[10px] font-bold text-gray-400 ml-1">每月 1 位｜{queue.length} 人</span></div>
        {canEdit && (
          <div className="flex gap-0.5">
            <button title="重新命名" onClick={() => onRename(item.id)} className="p-1 rounded-lg text-gray-400 hover:bg-white hover:text-blue-600"><Pencil size={13} /></button>
            <button title="刪除此項目" onClick={() => onDelete(item.id)} className="p-1 rounded-lg text-gray-400 hover:bg-white hover:text-red-600"><Trash2 size={13} /></button>
          </div>
        )}
      </div>

      {/* 月份（過去 1 個月～未來 3 個月）*/}
      <div className="divide-y">
        {winKeys.map(k => {
          const o = derived.out[k];
          const past = k < curYm;
          return (
            <div key={k} className={`px-2 py-1 flex items-center gap-2 text-xs ${k === curYm ? 'bg-yellow-50' : past ? 'bg-gray-50' : ''}`}>
              <span className={`font-mono w-16 flex-none ${past ? 'text-gray-400' : 'text-gray-600 font-bold'}`}>{k}</span>
              <span className="flex-grow min-w-0 truncate">
                {o && o.kind === 'confirmed' ? <span className="font-black text-gray-900">{nameOf(o.empId)}<span className="ml-1 text-[9px] bg-indigo-100 text-indigo-600 px-1 py-0.5 rounded-full font-black">已公告</span></span>
                  : o && o.kind === 'plan' && !past ? <span className="font-bold text-gray-400">{nameOf(o.empId)}</span>
                    : <span className="text-gray-200">—</span>}
              </span>
              {canEdit && !past && o && (
                o.kind === 'plan'
                  ? <button title="確定（公告）此人" onClick={() => confirmMonth(k, o.empId)} className="flex-none p-0.5 rounded text-gray-300 hover:text-emerald-600 hover:bg-emerald-50"><Check size={15} /></button>
                  : <button title="取消公告" onClick={() => cancelMonth(k)} className="flex-none text-[10px] font-black text-gray-400 hover:text-red-600">取消</button>
              )}
            </div>
          );
        })}
      </div>

      {/* 輪序表 */}
      <div className="border-t bg-gray-50 px-2 py-1 text-[11px] font-black text-gray-500">輪序表（不連動班表）</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-gray-200 overflow-y-auto" style={{ maxHeight: '240px' }}>
        {queue.length === 0 && <div className="bg-white p-3 text-center text-gray-300 italic text-xs font-bold sm:col-span-2">尚未建立輪序表</div>}
        {queue.map((id, idx) => {
          const st = stats[id] || { done: 0, plan: 0, next: '' };
          const gone = !activeIds.has(id);
          return (
            <div key={id} className="bg-white px-1.5 py-1 flex items-center gap-1 min-w-0">
              <span className="w-4 h-4 flex-none rounded-full text-[9px] font-black flex items-center justify-center bg-gray-100 text-gray-500">{idx + 1}</span>
              <div className="flex-grow min-w-0 leading-tight">
                <div className="text-[12px] font-bold text-gray-800 truncate">{nameOf(id)}{gone && <span className="ml-1 text-[9px] bg-rose-100 text-rose-600 px-1 py-0.5 rounded-full font-black">不在名冊</span>}</div>
                <div className="text-[10px] text-gray-400 font-bold truncate">{gone ? '已自動略過' : `預計輪到 ${st.next || '—'}`}｜公{st.done}・預{st.plan}</div>
              </div>
              {canEdit && (
                <div className="flex flex-none items-center">
                  <button title="設為下一位" onClick={() => setNext(id)} className="p-0.5 text-gray-300 hover:text-amber-500"><Star size={12} /></button>
                  <button title="上移" onClick={() => moveQueue(idx, -1)} className="p-0.5 text-gray-400 hover:text-blue-600"><ChevronUp size={13} /></button>
                  <button title="下移" onClick={() => moveQueue(idx, 1)} className="p-0.5 text-gray-400 hover:text-blue-600"><ChevronDown size={13} /></button>
                  <button title="移出輪序表" onClick={() => removeFromQueue(id)} className="p-0.5 text-gray-400 hover:text-red-600"><X size={13} /></button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {canEdit && (
        <div className="p-2 flex items-center gap-1 border-t">
          <select value={addId} onChange={e => setAddId(e.target.value)} className="flex-grow border rounded-lg px-1.5 py-1 text-[11px] bg-white min-w-0">
            <option value="">加入人員（放最後）…</option>
            {addable.map(e => <option key={e.id} value={String(e.id)}>{e.name}（{e.id}）</option>)}
          </select>
          <button onClick={addOne} disabled={!addId} className="flex-none text-[11px] font-black text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 px-2 py-1 rounded-lg flex items-center gap-1"><UserPlus size={12} /> 加入</button>
          <button onClick={addAll} disabled={addable.length === 0} className="flex-none text-[11px] font-black text-emerald-600 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40 px-2 py-1 rounded-lg">全部加入</button>
        </div>
      )}
    </div>
  );
};

export default MonthlyRotationCard;

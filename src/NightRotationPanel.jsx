import React, { useMemo, useState } from 'react';
import { ChevronUp, ChevronDown, X, UserPlus, Moon, Pencil, Check } from 'lucide-react';

// =====================================================================================
// 大夜（P）輪序面板
// - 以「週」為單位：每週 週六 → 下週四（共 6 天，週五不排大夜）
// - 計入的班別代碼：P、P#、P(國)（SP、HP 不計入）
// - 顯示範圍：今天往前 1 個月 ～ 往後 8 個月
// - 預排由「輪序表」自動算出（淺灰字），不另外儲存；輪序表、跳過週一改，預排就自動重排
// - 只有點選「確定」或「指定人員」的週才算數（黑字，顯示「已公告」），確定的週不會被自動重排動到
// - 確定的人 ≠ 該週預排者時：原預排者該次輪空，確定者「最近一次預排」被拿掉，後面的人各往前一位
//   （輪序 A、B、C、D，指定 C 補第 1 週 → C(確定)、B、D、A、B、C、D）
// - 班表實際：即時讀取班表（含換班），單純列出該週大夜藥師與天數
// - 所有編輯只改畫面上的草稿，需由上層「暫存／發布」才會寫入雲端
//
// p 的資料格式：
//   { queue: [empId...],                      // 輪序表（順序）
//     start: { key, empId, owed } | null,     // 自動預排的起點（由系統維護）
//     confirmed: { 'YYYY-MM-DD': { empId } },  // 已確定的週（key＝該週週六）
//     skips: { 'YYYY-MM-DD': true } }         // 跳過的週
// =====================================================================================

const pad = (n) => String(n).padStart(2, '0');
const fmtD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
const weekStartSat = (d) => addDays(d, -((d.getDay() + 1) % 7));
const isPCode = (c) => String(c || '').trim().replace('(國)', '').replace('（國）', '').replace('#', '') === 'P';
const WD = ['日', '一', '二', '三', '四', '五', '六'];

const NightRotationPanel = ({ open, onToggle, p, setP, canEdit, isAdmin, schedule, activeEmployees, nameOf }) => {
  const [addId, setAddId] = useState('');
  const [editKey, setEditKey] = useState('');

  const today = useMemo(() => new Date(), []);
  // 今天若是週五（不在任何一週內），「本週」視為下一個週六開始的那一週
  const currentKey = useMemo(() => {
    const ws = weekStartSat(today);
    return fmtD(today.getDay() === 5 ? addDays(ws, 7) : ws);
  }, [today]);
  const endDate = useMemo(() => new Date(today.getFullYear(), today.getMonth() + 8, today.getDate()), [today]);

  // 顯示區間：今天往前 1 個月 ～ 往後 8 個月
  const keys = useMemo(() => {
    const start = weekStartSat(new Date(today.getFullYear(), today.getMonth() - 1, today.getDate()));
    const arr = [];
    for (let d = start; d <= endDate; d = addDays(d, 7)) arr.push(fmtD(d));
    return arr;
  }, [today, endDate]);

  const queue = p?.queue || [];

  // ---------- 預排推算 ----------
  const materialize = (pp) => {
    const q = pp?.queue || [];
    const base = { queue: [...q], start: pp?.start || null, confirmed: { ...(pp?.confirmed || {}) }, skips: { ...(pp?.skips || {}) } };
    if (!base.start && q.length) base.start = { key: currentKey, empId: q[0], owed: {} };
    return base;
  };

  // 回傳 { out: { 週key: {kind:'confirmed'|'plan'|'skip', empId} }, anchor }
  const derive = (pp) => {
    const q = pp?.queue || [];
    const confirmed = pp?.confirmed || {};
    const skips = pp?.skips || {};
    const eff = pp?.start || (q.length ? { key: currentKey, empId: q[0], owed: {} } : null);
    const out = {};
    Object.keys(skips).forEach(k => { if (skips[k]) out[k] = { kind: 'skip' }; });
    Object.keys(confirmed).forEach(k => { if (confirmed[k]?.empId && !out[k]) out[k] = { kind: 'confirmed', empId: confirmed[k].empId }; });
    let anchor = null;
    if (eff && q.length) {
      // 每個「非跳過」的週，依序用掉輪序中的一個位置：
      //  - 未確定的週：就是預排（淺灰）
      //  - 已確定的週：若確定的人 ≠ 該位置的人，原預排者該次輪空，且確定的人「最近一次預排」會被拿掉
      const owed = { ...(eff.owed || {}) };
      let idx = Math.max(0, q.indexOf(eff.empId));
      const take = () => {
        for (let g = 0; g < q.length * 60; g++) {
          const c = q[idx % q.length];
          idx++;
          if (owed[c] > 0) { owed[c]--; continue; }
          return c;
        }
        return null;
      };
      for (let d = parseD(eff.key); d <= endDate; d = addDays(d, 7)) {
        const w = fmtD(d);
        if (skips[w]) continue;
        const c = confirmed[w]?.empId;
        if (c) {
          if (q.includes(c)) { // 不在輪序表內的人（外援）代班：不動輪序
            const e = take();
            if (e !== c) owed[c] = (owed[c] || 0) + 1;
          }
          continue;
        }
        if (!anchor && w >= currentKey) anchor = { key: w, empId: q[idx % q.length], owed: { ...owed } };
        const who = take();
        if (who) out[w] = { kind: 'plan', empId: who };
      }
    }
    return { out, anchor };
  };

  const derived = useMemo(() => derive(p), [p, currentKey, endDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // 修改輪序表時，把「目前輪到誰」固定下來（避免過去的預排被重算而改變），已確定的週一併視為已結算
  const reanchor = (pp, newQueue) => {
    const m = materialize(pp);
    const a = derive(m).anchor;
    const old = m.queue;
    const conf = m.confirmed;
    if (!newQueue.length) return { queue: [], start: null, confirmed: conf, skips: m.skips };
    let empId = newQueue[0];
    let key = a ? a.key : currentKey;
    const owed = {};
    if (a) {
      const i0 = Math.max(0, old.indexOf(a.empId));
      for (let s = 0; s < old.length; s++) {
        const c = old[(i0 + s) % old.length];
        if (newQueue.includes(c)) { empId = c; break; }
      }
      Object.keys(a.owed || {}).forEach(id => { if (newQueue.includes(id) && a.owed[id] > 0) owed[id] = a.owed[id]; });
    }
    return { queue: newQueue, start: { key, empId, owed }, confirmed: conf, skips: m.skips };
  };

  // ---------- 從班表讀出每週實際的大夜 ----------
  const nameToId = useMemo(() => {
    const m = {};
    (activeEmployees || []).forEach(e => { if (!e.isSeparator && e.name) m[e.name] = String(e.id); });
    return m;
  }, [activeEmployees]);

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
      res[k] = { known, counts };
    });
    return res;
  }, [keys, schedule, nameToId]);

  // ---------- 輪序表統計（顯示區間內）----------
  // 只計「輪序表」的已公告＋預排（過去週只計已公告），不看實際班表，用來看大夜班次是否平均
  const stats = useMemo(() => {
    const m = {};
    queue.forEach(id => { m[id] = { done: 0, plan: 0, last: '', next: '' }; });
    keys.forEach(k => {
      const o = derived.out[k];
      if (!o || !o.empId || !m[o.empId]) return;
      if (k < currentKey && o.kind !== 'confirmed') return;
      m[o.empId][o.kind === 'confirmed' ? 'done' : 'plan']++;
      if (k < currentKey) m[o.empId].last = k;
      else if (!m[o.empId].next) m[o.empId].next = k;
    });
    return m;
  }, [queue, keys, currentKey, derived]);

  const fmtShort = (k) => { if (!k) return '—'; const d = parseD(k); return `${d.getMonth() + 1}/${d.getDate()}`; };

  // ---------- 編輯操作（只改草稿）----------
  const moveQueue = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= queue.length) return;
    const nq = [...queue];
    [nq[idx], nq[j]] = [nq[j], nq[idx]];
    setP(reanchor(p, nq));
  };
  const removeFromQueue = (id) => {
    if (!window.confirm(`將「${nameOf(id)}」移出輪序表？（已公告的週不會改動，後面的預排會自動重排）`)) return;
    setP(reanchor(p, queue.filter(x => x !== id)));
  };
  const addToQueue = () => {
    if (!addId || queue.includes(addId)) return;
    setP(reanchor(p, [...queue, addId])); // 預設放最後，再用上下移調整
    setAddId('');
  };
  const setNext = (id) => {
    const m = materialize(p);
    const a = derive(m).anchor;
    setP({ queue: m.queue, start: { key: a ? a.key : currentKey, empId: id, owed: {} }, confirmed: m.confirmed, skips: m.skips });
  };

  const setConfirm = (k, id) => {
    const m = materialize(p);
    if (id === '__cancel__') {
      delete m.confirmed[k];
      if (m.start && k < m.start.key) m.start = { ...m.start, key: k };
    } else {
      m.confirmed[k] = { empId: id };
    }
    setP(m);
    setEditKey('');
  };
  const toggleSkip = (k) => {
    const m = materialize(p);
    if (m.skips[k]) {
      delete m.skips[k];
      if (m.start && k < m.start.key) m.start = { ...m.start, key: k };
    } else {
      const near = Object.keys(m.skips).filter(x => m.skips[x] && Math.abs(parseD(x) - parseD(k)) < 366 * 86400000);
      if (near.length >= 2 && !window.confirm('一年內已經有 2 週標記為「跳過」（通常只有農曆過年會跳過，最多 2 週）。\n確定要再多跳過一週嗎？')) return;
      delete m.confirmed[k];
      m.skips[k] = true;
    }
    setP(m);
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

  const renderActual = (k) => {
    const a = actualByKey[k];
    const names = Object.keys(a?.counts || {});
    if (!a || a.known === 0) return <span className="text-gray-300">—</span>;
    if (names.length === 0) return <span className="text-gray-300">—</span>;
    if (names.length === 1 && a.counts[names[0]] === a.known) return <span className="font-black text-gray-800">{names[0]}{a.known < 6 && <span className="text-[10px] text-gray-400 font-bold ml-1">（{a.known} 天有資料）</span>}</span>;
    return <span className="font-black text-gray-800">{names.map(n => `${n}(${a.counts[n]}天)`).join('、')}</span>;
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
      <button onClick={onToggle} className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 bg-indigo-50">
        <span className="font-black text-indigo-700 text-sm flex items-center gap-2"><Moon size={16} /> 大夜（P）輪序
          <span className="text-[11px] font-bold text-gray-400">每週六 ～ 下週四（6 天，週五不排）｜計入 P、P#、P(國)</span>
        </span>
        <span className="text-gray-400 text-xs font-black">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="p-3 border-t grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* 左：每週排序 */}
          <div className="lg:col-span-2 min-w-0">
            <div className="border rounded-xl overflow-auto" style={{ maxHeight: '480px' }}>
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500 sticky top-0 z-10">
                  <tr>
                    <th className="p-2 text-left whitespace-nowrap">週期（六～四）</th>
                    <th className="p-2 text-left whitespace-nowrap">預排</th>
                    <th className="p-2 text-left whitespace-nowrap">實際班表</th>
                    {editable && <th className="p-2 text-left whitespace-nowrap">跳過</th>}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {keys.map(k => {
                    const start = parseD(k);
                    const end = addDays(start, 5);
                    const past = k < currentKey;
                    const isCur = k === currentKey;
                    const o = derived.out[k];
                    let planCell = <span className="text-gray-200">—</span>;
                    if (o && o.kind === 'skip') {
                      planCell = <span className="text-[11px] font-black text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded">跳過（過年班）</span>;
                    } else if (o && o.kind === 'confirmed') {
                      planCell = <span className="font-black text-gray-900">{nameOf(o.empId)}<span className="ml-1 text-[9px] bg-indigo-100 text-indigo-600 px-1 py-0.5 rounded-full font-black">已公告</span></span>;
                    } else if (o && o.kind === 'plan' && !past) {
                      planCell = <span className="font-bold text-gray-400">{nameOf(o.empId)}</span>;
                    }
                    const canAct = editable && !past && !(o && o.kind === 'skip');
                    return (
                      <tr key={k} className={`align-top ${isCur ? 'bg-yellow-50' : past ? 'bg-gray-50 text-gray-400' : ''}`}>
                        <td className="p-2 whitespace-nowrap font-mono">
                          <span className="text-[10px] text-gray-400 mr-1">{start.getFullYear()}</span>
                          {start.getMonth() + 1}/{start.getDate()}({WD[start.getDay()]})～{end.getMonth() + 1}/{end.getDate()}({WD[end.getDay()]})
                          {isCur && <span className="ml-1 text-[9px] bg-amber-500 text-white px-1 py-0.5 rounded-full font-black">本週</span>}
                        </td>
                        <td className="p-2 whitespace-nowrap">
                          {editKey === k ? (
                            <select autoFocus value={o?.empId || ''} onChange={e => e.target.value && setConfirm(k, e.target.value)} onBlur={() => setEditKey('')} className="border rounded-lg px-1 py-0.5 text-[11px] bg-white">
                              <option value="" disabled>選擇人員…</option>
                              {pickable.map(id => <option key={id} value={id}>{nameOf(id)}</option>)}
                              {o && o.kind === 'confirmed' && <option value="__cancel__">（取消確定）</option>}
                            </select>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              {planCell}
                              {canAct && o && o.empId && (
                                <>
                                  {o.kind === 'plan' && <button title="確定此人" onClick={() => setConfirm(k, o.empId)} className="p-0.5 rounded text-gray-300 hover:text-emerald-600 hover:bg-emerald-50"><Check size={14} /></button>}
                                  <button title="指定其他人員／重新指定" onClick={() => setEditKey(k)} className="p-0.5 rounded text-gray-300 hover:text-blue-600 hover:bg-blue-50"><Pencil size={12} /></button>
                                </>
                              )}
                            </span>
                          )}
                        </td>
                        <td className="p-2">{renderActual(k)}</td>
                        {editable && (
                          <td className="p-2 whitespace-nowrap">
                            {!past && <button onClick={() => toggleSkip(k)} className={`text-[10px] font-black px-1.5 py-0.5 rounded ${o && o.kind === 'skip' ? 'bg-rose-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-rose-50 hover:text-rose-600'}`}>{o && o.kind === 'skip' ? '取消跳過' : '跳過'}</button>}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {queue.length === 0 && <div className="mt-2 text-[11px] text-gray-400 font-bold">{editable ? '尚未建立輪序表：請先在右側加入人員，預排就會自動帶入。' : '尚未建立大夜輪序表。'}</div>}
          </div>

          {/* 右：輪序表 */}
          <div className="min-w-0">
            <div className="text-[12px] font-black text-gray-700 mb-2">輪序表（手動維護，不連動班表）</div>
            <div className="border rounded-xl divide-y overflow-y-auto" style={{ maxHeight: '420px' }}>
              {queue.length === 0 && <div className="p-4 text-center text-gray-300 italic text-xs font-bold">尚未建立輪序表</div>}
              {queue.map((id, idx) => {
                const st = stats[id] || { done: 0, plan: 0, last: '', next: '' };
                return (
                  <div key={id} className="px-2 py-1.5 flex items-center gap-1.5">
                    <span className="w-5 h-5 flex-none rounded-full text-[10px] font-black flex items-center justify-center bg-gray-100 text-gray-500">{idx + 1}</span>
                    <div className="flex-grow min-w-0">
                      <div className="text-[13px] font-bold text-gray-800 leading-tight">{nameOf(id)}</div>
                      <div className="text-[10px] text-gray-400 font-bold">上次 {fmtShort(st.last)}｜下次 {fmtShort(st.next)}</div>
                    </div>
                    <div className="flex-none text-center leading-tight" title="顯示區間內的大夜班次數（已公告＋預排）">
                      <div className="text-sm font-black text-indigo-600">{st.done + st.plan}</div>
                      <div className="text-[9px] text-gray-400 font-bold whitespace-nowrap">公告{st.done}・預排{st.plan}</div>
                    </div>
                    {editable && (
                      <div className="flex flex-none items-center">
                        <button title="設為下一位（自動預排從此人開始）" onClick={() => setNext(id)} className="px-1 text-[10px] font-black text-gray-300 hover:text-amber-600">下一位</button>
                        <button title="上移" onClick={() => moveQueue(idx, -1)} className="p-0.5 text-gray-400 hover:text-blue-600"><ChevronUp size={14} /></button>
                        <button title="下移" onClick={() => moveQueue(idx, 1)} className="p-0.5 text-gray-400 hover:text-blue-600"><ChevronDown size={14} /></button>
                        <button title="移出輪序表" onClick={() => removeFromQueue(id)} className="p-0.5 text-gray-400 hover:text-red-600"><X size={14} /></button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {editable && (
              <div className="mt-2 flex items-center gap-1">
                <select value={addId} onChange={e => setAddId(e.target.value)} className="flex-grow border rounded-lg px-2 py-1 text-xs bg-white min-w-0">
                  <option value="">加入輪序表（僅斗六一般藥師，放最後）…</option>
                  {addable.map(e => <option key={e.id} value={String(e.id)}>{e.name}（{e.id}）</option>)}
                </select>
                <button onClick={addToQueue} disabled={!addId} className="flex-none text-[11px] font-black text-white bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 px-2 py-1.5 rounded-lg flex items-center gap-1"><UserPlus size={12} /> 加入</button>
              </div>
            )}
            <div className="mt-2 text-[10px] text-gray-400 font-bold leading-relaxed">
              ※ 次數＝顯示區間內輪序表的「已公告＋預排」週數（不含實際班表）。<br />
              ※ 指定某人到某週時，原預排者該次輪空，指定者最近一次預排被拿掉，後面的人各往前一位。<br />
              ※ 「跳過」的週不排大夜、也不計入輪序（最多 2 週）。
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NightRotationPanel;

import React, { useState, useEffect, useMemo } from 'react';
import { onSnapshot, runTransaction, doc, query, orderBy, limit } from 'firebase/firestore';
import { Plus, Trash2, Pencil, X, History, Search, Download, CheckCircle2, UserPlus, FileText, RefreshCcw } from 'lucide-react';

// =====================================================================================
// 班別輪序頁面
// - 登入後所有人可查看；只有管理員（role === '0'）可編輯
// - 資料存放：roster/rotation（班別、輪序人員、上次輪序年月、順序說明）
//            roster/rotation/rotationLog（異動紀錄，每筆一份文件）
// - 所有寫入都用 Transaction（讀雲端最新資料 → 修改 → 寫回），並同時寫入異動紀錄，
//   不會因為多人同時操作或畫面資料較舊而互相覆蓋。
// - 「下一位」規則：上次輪序年月最舊者優先（從未輪過者最優先），同月份依員工編號排序。
// =====================================================================================

const deepClone = (v) => JSON.parse(JSON.stringify(v));
const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const fmtTime = (iso) => {
  try { return new Date(iso).toLocaleString('zh-TW', { hour12: false }); } catch (e) { return iso || ''; }
};
const fmtYm = (ym) => ym || '尚無紀錄';

// 排序：年月舊 → 新（空白＝從未輪過，排最前面）；同月份依員工編號
const compareMembers = (a, b) => {
  const ay = a.lastYm || '';
  const by = b.lastYm || '';
  if (ay !== by) return ay < by ? -1 : 1;
  return String(a.empId).localeCompare(String(b.empId));
};

const RotationView = ({ rotationDocRef, rotationLogColRef, currentUser, isAdmin, employees, activeEmployees, currentMonth }) => {
  const [shifts, setShifts] = useState([]);
  const [notes, setNotes] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [notesDirty, setNotesDirty] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState(null); // { type, shiftId, empId }
  const [form, setForm] = useState({ name: '', empId: '', ym: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [logs, setLogs] = useState([]);
  const [logShift, setLogShift] = useState('');

  // ---- 即時監聽輪序資料 ----
  useEffect(() => {
    const unsub = onSnapshot(
      rotationDocRef,
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        setShifts(Array.isArray(data.shifts) ? data.shifts : []);
        setNotes(data.notes || '');
        setLoaded(true);
      },
      (err) => { console.error('讀取輪序資料失敗:', err); setLoaded(true); }
    );
    return () => unsub();
  }, [rotationDocRef]);

  // 說明文字：沒有未儲存的編輯時，跟著雲端同步
  useEffect(() => {
    if (!notesDirty) setNotesDraft(notes);
  }, [notes, notesDirty]);

  // ---- 異動紀錄（展開時才監聽）----
  useEffect(() => {
    if (!showLog) return;
    const q = query(rotationLogColRef, orderBy('at', 'desc'), limit(300));
    const unsub = onSnapshot(q, (snap) => setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() }))), (err) => console.error('讀取異動紀錄失敗:', err));
    return () => unsub();
  }, [showLog, rotationLogColRef]);

  const empById = useMemo(() => {
    const m = {};
    (employees || []).forEach(e => { if (!e.isSeparator) m[String(e.id)] = e; });
    return m;
  }, [employees]);
  const activeIds = useMemo(() => new Set((activeEmployees || []).filter(e => !e.isSeparator).map(e => String(e.id))), [activeEmployees]);
  const nameOf = (m) => empById[String(m.empId)]?.name || m.name || m.empId;

  // ---- 共用寫入：Transaction + 異動紀錄 ----
  const commit = async (mutator, logEntry) => {
    if (!isAdmin) { alert('只有管理員可以編輯班別輪序。'); return false; }
    setBusy(true);
    try {
      await runTransaction(rotationDocRef.firestore, async (tx) => {
        const snap = await tx.get(rotationDocRef);
        const data = snap.exists() ? snap.data() : {};
        const next = mutator({ shifts: deepClone(data.shifts || []), notes: data.notes || '' });
        const now = new Date().toISOString();
        tx.set(rotationDocRef, { shifts: next.shifts, notes: next.notes, updatedAt: now });
        tx.set(doc(rotationLogColRef), { ...logEntry, at: now, by: currentUser?.name || '', byId: currentUser?.id || '' });
      });
      return true;
    } catch (err) {
      console.error('輪序資料寫入失敗:', err);
      alert(err?.message && !String(err.message).startsWith('Firebase') ? err.message : '儲存失敗，可能是網路問題，請重新操作一次。');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const findShift = (list, shiftId) => {
    const s = list.find(x => x.id === shiftId);
    if (!s) throw new Error('找不到此班別（可能已被其他人刪除），請重新整理後再試。');
    return s;
  };

  // ---- 各項操作 ----
  const addShift = (name) => commit(({ shifts: list, notes: n }) => {
    if (list.some(s => s.name === name)) throw new Error(`已經有「${name}」這個班別了。`);
    list.push({ id: newId(), name, members: [] });
    return { shifts: list, notes: n };
  }, { action: '新增班別', shiftName: name });

  const renameShift = (shiftId, name, reason) => {
    let oldName = '';
    return commit(({ shifts: list, notes: n }) => {
      const s = findShift(list, shiftId);
      if (list.some(x => x.id !== shiftId && x.name === name)) throw new Error(`已經有「${name}」這個班別了。`);
      oldName = s.name;
      s.name = name;
      return { shifts: list, notes: n };
    }, { action: '修改班別名稱', shiftName: name, detail: `${shifts.find(s => s.id === shiftId)?.name || ''} → ${name}`, reason: reason || '' });
  };

  const deleteShift = (shiftId, reason) => {
    const shiftName = shifts.find(s => s.id === shiftId)?.name || '';
    return commit(({ shifts: list, notes: n }) => {
      findShift(list, shiftId);
      return { shifts: list.filter(s => s.id !== shiftId), notes: n };
    }, { action: '刪除班別', shiftName, reason });
  };

  const addMember = (shiftId, empId, ym, reason) => {
    const shift = shifts.find(s => s.id === shiftId);
    const emp = empById[String(empId)];
    return commit(({ shifts: list, notes: n }) => {
      const s = findShift(list, shiftId);
      if (s.members.some(m => String(m.empId) === String(empId))) throw new Error('此人員已在這個班別的輪序名單中。');
      s.members.push({ empId: String(empId), name: emp?.name || '', lastYm: ym || '' });
      return { shifts: list, notes: n };
    }, { action: '新增人員', shiftName: shift?.name || '', empId: String(empId), empName: emp?.name || '', to: ym || '', reason });
  };

  const removeMember = (shiftId, empId, reason) => {
    const shift = shifts.find(s => s.id === shiftId);
    const member = shift?.members.find(m => String(m.empId) === String(empId));
    return commit(({ shifts: list, notes: n }) => {
      const s = findShift(list, shiftId);
      s.members = s.members.filter(m => String(m.empId) !== String(empId));
      return { shifts: list, notes: n };
    }, { action: '移除人員', shiftName: shift?.name || '', empId: String(empId), empName: member ? nameOf(member) : '', from: member?.lastYm || '', reason });
  };

  const setMemberYm = (shiftId, empId, ym, reason, action = '修改年月') => {
    const shift = shifts.find(s => s.id === shiftId);
    const member = shift?.members.find(m => String(m.empId) === String(empId));
    return commit(({ shifts: list, notes: n }) => {
      const s = findShift(list, shiftId);
      const m = s.members.find(x => String(x.empId) === String(empId));
      if (!m) throw new Error('找不到此人員（可能已被其他人移除），請重新整理後再試。');
      m.lastYm = ym || '';
      return { shifts: list, notes: n };
    }, { action, shiftName: shift?.name || '', empId: String(empId), empName: member ? nameOf(member) : '', from: member?.lastYm || '', to: ym || '', reason: reason || '' });
  };

  const markDone = (shiftId, member) => {
    const shiftName = shifts.find(s => s.id === shiftId)?.name || '';
    if (!window.confirm(`將「${nameOf(member)}」在「${shiftName}」的上次輪序年月設為 ${currentMonth}？`)) return;
    setMemberYm(shiftId, member.empId, currentMonth, '', '本月已輪');
  };

  const saveNotes = async () => {
    const ok = await commit(({ shifts: list }) => ({ shifts: list, notes: notesDraft }), { action: '更新順序說明', detail: `${notesDraft.length} 字` });
    if (ok) setNotesDirty(false);
  };

  const downloadBackup = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), shifts, notes }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `班別輪序備份_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---- 對話框 ----
  const openDialog = (type, shiftId = '', empId = '') => {
    const shift = shifts.find(s => s.id === shiftId);
    const member = shift?.members.find(m => String(m.empId) === String(empId));
    setForm({ name: type === 'renameShift' ? (shift?.name || '') : '', empId: '', ym: type === 'editYm' ? (member?.lastYm || '') : '', reason: '' });
    setDialog({ type, shiftId, empId });
  };
  const closeDialog = () => setDialog(null);

  const dialogShift = dialog ? shifts.find(s => s.id === dialog.shiftId) : null;
  const dialogMember = dialogShift?.members.find(m => String(m.empId) === String(dialog?.empId));

  const submitDialog = async () => {
    const reason = form.reason.trim();
    const name = form.name.trim();
    let ok = false;
    switch (dialog.type) {
      case 'addShift':
        if (!name) return alert('請輸入班別名稱。');
        ok = await addShift(name); break;
      case 'renameShift':
        if (!name) return alert('請輸入班別名稱。');
        ok = await renameShift(dialog.shiftId, name, reason); break;
      case 'deleteShift':
        if (!reason) return alert('刪除班別請填寫原因。');
        ok = await deleteShift(dialog.shiftId, reason); break;
      case 'addMember':
        if (!form.empId) return alert('請選擇要新增的人員。');
        if (!reason) return alert('新增人員請填寫原因。');
        ok = await addMember(dialog.shiftId, form.empId, form.ym, reason); break;
      case 'removeMember':
        if (!reason) return alert('移除人員請填寫原因。');
        ok = await removeMember(dialog.shiftId, dialog.empId, reason); break;
      case 'editYm':
        ok = await setMemberYm(dialog.shiftId, dialog.empId, form.ym, reason); break;
      default: break;
    }
    if (ok) closeDialog();
  };

  const addableEmployees = useMemo(() => {
    if (!dialog || dialog.type !== 'addMember' || !dialogShift) return [];
    const taken = new Set(dialogShift.members.map(m => String(m.empId)));
    return (activeEmployees || [])
      .filter(e => !e.isSeparator && e.id && !taken.has(String(e.id)))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }, [dialog, dialogShift, activeEmployees]);

  // ---- 搜尋篩選 ----
  const keyword = search.trim().toLowerCase();
  const visibleShifts = useMemo(() => {
    if (!keyword) return shifts;
    return shifts.filter(s =>
      s.name.toLowerCase().includes(keyword) ||
      s.members.some(m => nameOf(m).toLowerCase().includes(keyword) || String(m.empId).toLowerCase().includes(keyword))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shifts, keyword, empById]);

  const visibleLogs = useMemo(() => logShift ? logs.filter(l => l.shiftName === logShift) : logs, [logs, logShift]);

  const dialogTitle = {
    addShift: '新增班別', renameShift: '修改班別名稱', deleteShift: '刪除班別',
    addMember: '新增輪序人員', removeMember: '移除輪序人員', editYm: '修改上次輪序年月'
  }[dialog?.type] || '';

  return (
    <div className="flex-grow overflow-auto bg-gray-50 p-4 font-sans">
      <div className="max-w-7xl mx-auto space-y-4">

        {/* 標題列 */}
        <div className="bg-white rounded-2xl shadow-sm border p-4 flex flex-wrap items-center gap-3 justify-between">
          <div>
            <h2 className="text-lg font-black text-gray-800 flex items-center gap-2"><RefreshCcw size={20} className="text-amber-500" /> 班別輪序</h2>
            <p className="text-[11px] text-gray-400 font-bold mt-1">
              依「上次輪序年月」最舊者優先；從未輪過者排最前面，同月份依員工編號排序。{isAdmin ? '' : '（僅管理員可編輯）'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋班別或人員" className="pl-8 pr-3 py-1.5 border rounded-xl text-xs outline-none focus:border-blue-400 w-44" />
            </div>
            {isAdmin && (
              <>
                <button onClick={() => openDialog('addShift')} className="bg-amber-500 text-white px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1 hover:bg-amber-600 shadow-sm"><Plus size={14} /> 新增班別</button>
                <button onClick={downloadBackup} className="bg-gray-700 text-white px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1 hover:bg-gray-800 shadow-sm"><Download size={14} /> 下載備份</button>
              </>
            )}
            <button onClick={() => setShowLog(v => !v)} className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1 border shadow-sm ${showLog ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-indigo-600 border-indigo-200 hover:bg-indigo-50'}`}><History size={14} /> 異動紀錄</button>
          </div>
        </div>

        {/* 新人輪序順序說明 */}
        <div className="bg-white rounded-2xl shadow-sm border p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-black text-gray-700 flex items-center gap-1"><FileText size={16} className="text-teal-500" /> 新人輪序順序說明</h3>
            {isAdmin && notesDirty && (
              <div className="flex gap-2">
                <button onClick={() => { setNotesDraft(notes); setNotesDirty(false); }} className="text-xs font-bold text-gray-500 px-3 py-1 rounded-lg bg-gray-100 hover:bg-gray-200">還原</button>
                <button disabled={busy} onClick={saveNotes} className="text-xs font-black text-white px-3 py-1 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-50">儲存說明</button>
              </div>
            )}
          </div>
          {isAdmin ? (
            <textarea
              value={notesDraft}
              onChange={e => { setNotesDraft(e.target.value); setNotesDirty(true); }}
              rows={6}
              placeholder={'例如：\n新人平日：紅→磨→發2→...\n新人假日：HL→HD→SD→...\n第2個月要有普通假日班'}
              className="w-full border rounded-xl p-3 text-sm outline-none focus:border-teal-400 leading-relaxed"
            />
          ) : (
            <div className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed bg-gray-50 rounded-xl p-3 min-h-12">
              {notes || <span className="text-gray-300 italic">尚無說明</span>}
            </div>
          )}
        </div>

        {/* 班別卡片 */}
        {!loaded ? (
          <div className="text-center text-gray-400 font-bold py-10">讀取中...</div>
        ) : visibleShifts.length === 0 ? (
          <div className="text-center text-gray-300 italic font-bold py-10">{shifts.length === 0 ? (isAdmin ? '尚未建立任何班別，請按「新增班別」開始建立。' : '尚未建立任何班別。') : '沒有符合搜尋條件的班別。'}</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {visibleShifts.map(shift => {
              const sorted = [...shift.members].sort(compareMembers);
              return (
                <div key={shift.id} className="bg-white rounded-2xl shadow-sm border overflow-hidden flex flex-col">
                  <div className="px-4 py-2.5 bg-amber-50 border-b flex items-center justify-between">
                    <div className="font-black text-gray-800">{shift.name} <span className="text-[11px] font-bold text-gray-400 ml-1">{shift.members.length} 人</span></div>
                    {isAdmin && (
                      <div className="flex gap-1">
                        <button title="修改班別名稱" onClick={() => openDialog('renameShift', shift.id)} className="p-1.5 rounded-lg text-gray-400 hover:bg-white hover:text-blue-600"><Pencil size={14} /></button>
                        <button title="刪除班別" onClick={() => openDialog('deleteShift', shift.id)} className="p-1.5 rounded-lg text-gray-400 hover:bg-white hover:text-red-600"><Trash2 size={14} /></button>
                      </div>
                    )}
                  </div>
                  <div className="flex-grow divide-y">
                    {sorted.length === 0 && <div className="p-4 text-center text-gray-300 italic text-xs font-bold">尚無輪序人員</div>}
                    {sorted.map((m, idx) => {
                      const isNext = idx === 0;
                      const inActive = activeIds.has(String(m.empId));
                      const hit = keyword && (nameOf(m).toLowerCase().includes(keyword) || String(m.empId).toLowerCase().includes(keyword));
                      return (
                        <div key={m.empId} className={`px-3 py-2 flex items-center gap-2 ${isNext ? 'bg-yellow-50' : ''} ${hit ? 'ring-2 ring-inset ring-blue-300' : ''}`}>
                          <span className={`w-6 h-6 flex-none rounded-full text-[11px] font-black flex items-center justify-center ${isNext ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-500'}`}>{idx + 1}</span>
                          <div className="flex-grow min-w-0">
                            <div className="text-sm font-bold text-gray-800 flex items-center gap-1 flex-wrap">
                              {nameOf(m)}
                              {isNext && <span className="text-[10px] bg-amber-500 text-white px-1.5 py-0.5 rounded-full font-black">下一位</span>}
                              {!inActive && <span className="text-[10px] bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded-full font-black">不在斗六名冊</span>}
                            </div>
                            <div className="text-[10px] text-gray-400 font-mono">{m.empId}</div>
                          </div>
                          <div className={`text-xs font-mono font-bold flex-none ${m.lastYm ? 'text-gray-600' : 'text-gray-300'}`}>{fmtYm(m.lastYm)}</div>
                          {isAdmin && (
                            <div className="flex flex-none items-center gap-0.5">
                              <button disabled={busy} title={`本月已輪（設為 ${currentMonth}）`} onClick={() => markDone(shift.id, m)} className="p-1.5 rounded-lg text-gray-400 hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-40"><CheckCircle2 size={15} /></button>
                              <button title="修改上次輪序年月" onClick={() => openDialog('editYm', shift.id, m.empId)} className="p-1.5 rounded-lg text-gray-400 hover:bg-blue-50 hover:text-blue-600"><Pencil size={14} /></button>
                              <button title="移除人員" onClick={() => openDialog('removeMember', shift.id, m.empId)} className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600"><X size={15} /></button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {isAdmin && (
                    <button onClick={() => openDialog('addMember', shift.id)} className="m-3 mt-2 py-1.5 rounded-xl border border-dashed border-gray-300 text-xs font-black text-gray-400 hover:border-amber-400 hover:text-amber-600 flex items-center justify-center gap-1"><UserPlus size={14} /> 新增人員</button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* 異動紀錄 */}
        {showLog && (
          <div className="bg-white rounded-2xl shadow-sm border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h3 className="text-sm font-black text-gray-700 flex items-center gap-1"><History size={16} className="text-indigo-500" /> 異動紀錄（最近 300 筆）</h3>
              <select value={logShift} onChange={e => setLogShift(e.target.value)} className="border rounded-lg px-2 py-1 text-xs font-bold bg-white">
                <option value="">全部班別</option>
                {[...new Set(logs.map(l => l.shiftName).filter(Boolean))].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="p-2 text-left whitespace-nowrap">時間</th>
                    <th className="p-2 text-left whitespace-nowrap">操作者</th>
                    <th className="p-2 text-left whitespace-nowrap">動作</th>
                    <th className="p-2 text-left whitespace-nowrap">班別</th>
                    <th className="p-2 text-left whitespace-nowrap">人員</th>
                    <th className="p-2 text-left whitespace-nowrap">變更內容</th>
                    <th className="p-2 text-left">原因</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {visibleLogs.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-gray-300 italic font-bold">尚無紀錄</td></tr>}
                  {visibleLogs.map(l => (
                    <tr key={l.id} className="align-top">
                      <td className="p-2 whitespace-nowrap text-gray-500 font-mono">{fmtTime(l.at)}</td>
                      <td className="p-2 whitespace-nowrap font-bold text-gray-700">{l.by}</td>
                      <td className="p-2 whitespace-nowrap font-black text-indigo-600">{l.action}</td>
                      <td className="p-2 whitespace-nowrap font-bold">{l.shiftName || '-'}</td>
                      <td className="p-2 whitespace-nowrap">{l.empName ? `${l.empName}（${l.empId}）` : '-'}</td>
                      <td className="p-2 whitespace-nowrap font-mono text-gray-600">
                        {l.detail ? l.detail : (l.from !== undefined || l.to !== undefined) ? `${fmtYm(l.from)} → ${fmtYm(l.to)}` : '-'}
                      </td>
                      <td className="p-2 text-gray-600">{l.reason || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 對話框 */}
      {dialog && (
        <div className="fixed inset-0 bg-black/40 z-[100] flex items-center justify-center p-4" onClick={closeDialog}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-black text-gray-800">{dialogTitle}{dialogShift ? `｜${dialogShift.name}` : ''}</h3>
              <button onClick={closeDialog} className="p-1 text-gray-400 hover:text-gray-700"><X size={18} /></button>
            </div>

            {(dialog.type === 'addShift' || dialog.type === 'renameShift') && (
              <input autoFocus value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="班別名稱（例如 A1、夜診）" className="w-full border rounded-xl p-2.5 text-sm outline-none focus:border-amber-400" />
            )}

            {dialog.type === 'addMember' && (
              <>
                <select value={form.empId} onChange={e => setForm({ ...form, empId: e.target.value })} className="w-full border rounded-xl p-2.5 text-sm bg-white font-bold">
                  <option value="">請選擇人員（僅斗六院區）</option>
                  {addableEmployees.map(e => <option key={e.id} value={e.id}>{e.id}　{e.name}</option>)}
                </select>
                <label className="block text-[11px] font-bold text-gray-500">上次輪序年月（可留空＝從未輪過）
                  <input type="month" value={form.ym} onChange={e => setForm({ ...form, ym: e.target.value })} className="mt-1 w-full border rounded-xl p-2.5 text-sm outline-none focus:border-amber-400" />
                </label>
              </>
            )}

            {dialog.type === 'editYm' && (
              <>
                <div className="text-sm font-bold text-gray-700">{dialogMember ? `${nameOf(dialogMember)}（${dialogMember.empId}）` : ''}　目前：{fmtYm(dialogMember?.lastYm)}</div>
                <label className="block text-[11px] font-bold text-gray-500">新的上次輪序年月（清空＝從未輪過）
                  <input type="month" value={form.ym} onChange={e => setForm({ ...form, ym: e.target.value })} className="mt-1 w-full border rounded-xl p-2.5 text-sm outline-none focus:border-amber-400" />
                </label>
              </>
            )}

            {dialog.type === 'removeMember' && (
              <div className="text-sm font-bold text-gray-700">確定要將「{dialogMember ? nameOf(dialogMember) : ''}」從「{dialogShift?.name}」的輪序名單移除嗎？</div>
            )}
            {dialog.type === 'deleteShift' && (
              <div className="text-sm font-bold text-red-600">確定要刪除班別「{dialogShift?.name}」及其 {dialogShift?.members.length || 0} 位輪序人員紀錄嗎？（刪除前建議先下載備份）</div>
            )}

            {dialog.type !== 'addShift' && (
              <textarea
                value={form.reason}
                onChange={e => setForm({ ...form, reason: e.target.value })}
                rows={2}
                placeholder={['addMember', 'removeMember', 'deleteShift'].includes(dialog.type) ? '原因（必填）' : '原因（選填）'}
                className="w-full border rounded-xl p-2.5 text-sm outline-none focus:border-amber-400"
              />
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={closeDialog} className="px-4 py-2 rounded-xl text-sm font-bold text-gray-500 bg-gray-100 hover:bg-gray-200">取消</button>
              <button disabled={busy} onClick={submitDialog} className={`px-4 py-2 rounded-xl text-sm font-black text-white disabled:opacity-50 ${['removeMember', 'deleteShift'].includes(dialog.type) ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>確認</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RotationView;

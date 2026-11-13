import React, { useState, useEffect, useMemo } from 'react';
import { onSnapshot, runTransaction, doc, query, orderBy, limit, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { Plus, Trash2, Pencil, X, History, Search, Download, CheckCircle2, UserPlus, FileText, RefreshCcw, Save, RotateCcw } from 'lucide-react';
import NightRotationPanel from './NightRotationPanel.jsx';

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

const NO_GROUP = '__none__';
const UNGROUPED_TITLE = '未分類';

const EMPTY_P = { queue: [], slots: {} };
// 「打勾」一律代表排「今天所在月份的下一個月」
const nextMonthOfToday = () => {
  const t = new Date();
  const d = new Date(t.getFullYear(), t.getMonth() + 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const RotationView = ({ rotationDocRef, rotationLogColRef, rotationDraftRef, currentUser, isAdmin, employees, activeEmployees, currentMonth, shiftTimeTable, schedule, setRotationDirty }) => {
  const [shifts, setShifts] = useState([]);
  const [notes, setNotes] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [notesDirty, setNotesDirty] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState(null); // { type, shiftId, empId }
  const [form, setForm] = useState({ name: '', group: '', picked: [], q: '', ym: '', reason: '' });
  const [expanded, setExpanded] = useState(new Set()); // 展開中的分類
  const [busy, setBusy] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [logs, setLogs] = useState([]);
  const [logShift, setLogShift] = useState('');
  // ---- 暫存區（只有管理員有）：打勾標記 + 大夜預排 ----
  const [committedP, setCommittedP] = useState(EMPTY_P);
  const [work, setWork] = useState({ marks: {}, p: null }); // marks: { 'shiftId|empId': 'YYYY-MM' }；p: 大夜草稿（null＝沒改過）
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [dirty, setDirty] = useState(false); // 有尚未暫存／發布的變更
  const stageYm = useMemo(() => nextMonthOfToday(), []);

  // ---- 即時監聽輪序資料 ----
  useEffect(() => {
    const unsub = onSnapshot(
      rotationDocRef,
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        setShifts(Array.isArray(data.shifts) ? data.shifts : []);
        setNotes(data.notes || '');
        setCommittedP(data.p && data.p.queue ? { queue: data.p.queue || [], slots: data.p.slots || {} } : EMPTY_P);
        setLoaded(true);
      },
      (err) => { console.error('讀取輪序資料失敗:', err); setLoaded(true); }
    );
    return () => unsub();
  }, [rotationDocRef]);

  // ---- 載入暫存區（僅管理員）----
  useEffect(() => {
    if (!isAdmin || !rotationDraftRef) { setDraftLoaded(true); return; }
    let alive = true;
    getDoc(rotationDraftRef).then(snap => {
      if (!alive) return;
      if (snap.exists()) {
        const d = snap.data();
        setWork({ marks: d.marks || {}, p: d.p || null });
        setHasDraft(true);
      }
      setDraftLoaded(true);
    }).catch(err => { console.error('讀取暫存區失敗:', err); if (alive) setDraftLoaded(true); });
    return () => { alive = false; };
  }, [isAdmin, rotationDraftRef]);

  // 未暫存／發布的變更：通知上層（離開頁面時提示），並在關閉分頁時提示
  useEffect(() => {
    if (setRotationDirty) setRotationDirty(dirty);
    if (!dirty) return;
    const h = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty, setRotationDirty]);
  useEffect(() => () => { if (setRotationDirty) setRotationDirty(false); }, [setRotationDirty]);

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

  // ---- 班別分類：沿用「各班別上班時段」的分類；可手動指定，沒指定就依班別名稱自動對應 ----
  const sectionTitles = useMemo(() => (shiftTimeTable || []).map(sec => sec.title).filter(Boolean), [shiftTimeTable]);
  const autoGroupOf = (name) => {
    for (const sec of (shiftTimeTable || [])) {
      if ((sec.rows || []).some(r => String(r.name || '').split('/').map(x => x.trim()).includes(name))) return sec.title;
    }
    return '';
  };
  const groupOf = (shift) => {
    if (shift.group === NO_GROUP) return UNGROUPED_TITLE;
    return shift.group || autoGroupOf(shift.name) || UNGROUPED_TITLE;
  };

  // ---- 共用寫入：Transaction + 異動紀錄 ----
  const commit = async (mutator, logEntry, opts = {}) => {
    if (!isAdmin) { alert('只有管理員可以編輯班別輪序。'); return false; }
    setBusy(true);
    try {
      await runTransaction(rotationDocRef.firestore, async (tx) => {
        const snap = await tx.get(rotationDocRef);
        const data = snap.exists() ? snap.data() : {};
        const next = mutator({ shifts: deepClone(data.shifts || []), notes: data.notes || '', p: data.p ? deepClone(data.p) : null });
        const now = new Date().toISOString();
        const nextP = next.p !== undefined ? next.p : (data.p || null);
        tx.set(rotationDocRef, { shifts: next.shifts, notes: next.notes, ...(nextP ? { p: nextP } : {}), updatedAt: now });
        if (opts.clearDraft && rotationDraftRef) tx.delete(rotationDraftRef);
        (Array.isArray(logEntry) ? logEntry : [logEntry]).forEach(entry => {
          tx.set(doc(rotationLogColRef), { ...entry, at: now, by: currentUser?.name || '', byId: currentUser?.id || '' });
        });
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
  const addShift = (name, group) => commit(({ shifts: list, notes: n }) => {
    if (list.some(s => s.name === name)) throw new Error(`已經有「${name}」這個班別了。`);
    list.push({ id: newId(), name, group: group || '', members: [] });
    return { shifts: list, notes: n };
  }, { action: '新增班別', shiftName: name });

  const editShift = (shiftId, name, group, reason) => {
    const old = shifts.find(s => s.id === shiftId);
    const changes = [];
    if (old && old.name !== name) changes.push(`名稱 ${old.name} → ${name}`);
    if (old && (old.group || '') !== (group || '')) changes.push('分類已調整');
    return commit(({ shifts: list, notes: n }) => {
      const s = findShift(list, shiftId);
      if (list.some(x => x.id !== shiftId && x.name === name)) throw new Error(`已經有「${name}」這個班別了。`);
      s.name = name;
      s.group = group || '';
      return { shifts: list, notes: n };
    }, { action: '修改班別', shiftName: name, detail: changes.join('、') || '無變更', reason: reason || '' });
  };

  const deleteShift = (shiftId, reason) => {
    const shiftName = shifts.find(s => s.id === shiftId)?.name || '';
    return commit(({ shifts: list, notes: n }) => {
      findShift(list, shiftId);
      return { shifts: list.filter(s => s.id !== shiftId), notes: n };
    }, { action: '刪除班別', shiftName, reason });
  };

  const addMembers = (shiftId, empIds, ym, reason) => {
    const shift = shifts.find(s => s.id === shiftId);
    return commit(({ shifts: list, notes: n }) => {
      const s = findShift(list, shiftId);
      empIds.forEach(empId => {
        if (s.members.some(m => String(m.empId) === String(empId))) throw new Error(`「${empById[String(empId)]?.name || empId}」已在這個班別的輪序名單中，請重新整理後再試。`);
        s.members.push({ empId: String(empId), name: empById[String(empId)]?.name || '', lastYm: ym || '' });
      });
      return { shifts: list, notes: n };
    }, empIds.map(empId => ({ action: '新增人員', shiftName: shift?.name || '', empId: String(empId), empName: empById[String(empId)]?.name || '', to: ym || '', reason })));
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

  // ---- 暫存區操作 ----
  const markKey = (shiftId, empId) => `${shiftId}|${empId}`;
  const toggleMark = (shiftId, empId) => {
    if (!draftLoaded) return;
    setWork(w => {
      const marks = { ...w.marks };
      const k = markKey(shiftId, empId);
      if (marks[k]) delete marks[k]; else marks[k] = stageYm;
      return { ...w, marks };
    });
    setDirty(true);
  };
  const effectiveP = work.p || committedP;
  const setDraftP = (next) => { setWork(w => ({ ...w, p: next })); setDirty(true); };
  const markCount = Object.keys(work.marks).length;
  const hasStaged = markCount > 0 || !!work.p;

  const slotsDiffCount = (a, b) => {
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    let n = 0;
    keys.forEach(k => { if (JSON.stringify(a?.[k] || null) !== JSON.stringify(b?.[k] || null)) n++; });
    return n;
  };

  const saveDraft = async () => {
    setBusy(true);
    try {
      if (!hasStaged) {
        await deleteDoc(rotationDraftRef);
        setHasDraft(false);
      } else {
        await setDoc(rotationDraftRef, { marks: work.marks, p: work.p || null, by: currentUser?.name || '', byId: currentUser?.id || '', updatedAt: new Date().toISOString() });
        setHasDraft(true);
      }
      setDirty(false);
    } catch (err) {
      console.error('暫存失敗:', err);
      alert('暫存失敗，可能是網路問題，請重新操作一次。');
    } finally { setBusy(false); }
  };

  const discardDraft = async () => {
    if (!window.confirm('捨棄所有尚未發布的暫存內容（打勾標記與大夜預排修改）？')) return;
    setBusy(true);
    try {
      if (hasDraft) await deleteDoc(rotationDraftRef);
      setWork({ marks: {}, p: null });
      setHasDraft(false);
      setDirty(false);
    } catch (err) {
      console.error('捨棄暫存失敗:', err);
      alert('捨棄失敗，請重新操作一次。');
    } finally { setBusy(false); }
  };

  const publishDraft = async () => {
    if (!hasStaged) { alert('目前沒有可發布的變更。'); return; }
    const parts = [];
    if (markCount) parts.push(`${markCount} 筆打勾標記（設為已排 ${stageYm}）`);
    if (work.p) parts.push('大夜預排順序／週次');
    if (!window.confirm(`確定發布（公布）以下內容？\n・${parts.join('\n・')}`)) return;
    const marks = Object.entries(work.marks);
    const logs = [];
    marks.forEach(([key, ym]) => {
      const [sid, eid] = key.split('|');
      const sh = shifts.find(x => x.id === sid);
      const m = sh?.members.find(x => String(x.empId) === eid);
      if (sh && m) logs.push({ action: '已排', shiftName: sh.name, empId: eid, empName: nameOf(m), from: m.lastYm || '', to: ym, reason: '暫存標記發布' });
    });
    if (work.p) {
      const q0 = committedP.queue.length, q1 = work.p.queue.length;
      logs.push({ action: '大夜預排更新', shiftName: '大夜(P)', detail: `預排順序 ${q0}→${q1} 人；週次異動 ${slotsDiffCount(committedP.slots, work.p.slots)} 週` });
    }
    const ok = await commit(({ shifts: list, notes: n, p: cp }) => {
      marks.forEach(([key, ym]) => {
        const [sid, eid] = key.split('|');
        const sh = list.find(x => x.id === sid);
        const m = sh?.members.find(x => String(x.empId) === eid);
        if (m) m.lastYm = ym; // 班別或人員若已被移除就略過
      });
      return { shifts: list, notes: n, p: work.p || cp };
    }, logs, { clearDraft: true });
    if (ok) { setWork({ marks: {}, p: null }); setHasDraft(false); setDirty(false); }
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
    setForm({ name: type === 'editShift' ? (shift?.name || '') : '', group: type === 'editShift' ? (shift?.group || '') : '', picked: [], q: '', ym: type === 'editYm' ? (member?.lastYm || '') : '', reason: '' });
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
        ok = await addShift(name, form.group); break;
      case 'editShift':
        if (!name) return alert('請輸入班別名稱。');
        ok = await editShift(dialog.shiftId, name, form.group, reason); break;
      case 'deleteShift':
        if (!reason) return alert('刪除班別請填寫原因。');
        ok = await deleteShift(dialog.shiftId, reason); break;
      case 'addMember':
        if (form.picked.length === 0) return alert('請勾選要新增的人員。');
        if (!reason) return alert('新增人員請填寫原因。');
        ok = await addMembers(dialog.shiftId, form.picked, form.ym, reason); break;
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
    const q = (form.q || '').trim().toLowerCase();
    // 只列「一般藥師(1)」且斗六院區（activeEmployees 已排除虎尾）；姓名含亂碼（資料編碼錯誤）者不列入
    return (activeEmployees || [])
      .filter(e => !e.isSeparator && e.id && String(e.role) === '1' && !String(e.name || '').includes('\uFFFD') && !taken.has(String(e.id)))
      .filter(e => !q || String(e.name).toLowerCase().includes(q) || String(e.id).toLowerCase().includes(q))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }, [dialog, dialogShift, activeEmployees, form.q]);

  const togglePick = (id) => setForm(f => ({ ...f, picked: f.picked.includes(id) ? f.picked.filter(x => x !== id) : [...f.picked, id] }));

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

  // 依分類整理（順序：各班別上班時段的分類順序 → 其他分類 → 未分類）
  const groupedShifts = useMemo(() => {
    const map = new Map();
    sectionTitles.forEach(t => map.set(t, []));
    visibleShifts.forEach(sh => {
      const g = groupOf(sh);
      if (!map.has(g)) map.set(g, []);
      map.get(g).push(sh);
    });
    const ungrouped = map.get(UNGROUPED_TITLE);
    map.delete(UNGROUPED_TITLE);
    const arr = [...map.entries()].filter(([, list]) => list.length > 0);
    if (ungrouped && ungrouped.length > 0) arr.push([UNGROUPED_TITLE, ungrouped]);
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleShifts, sectionTitles, shiftTimeTable]);

  const toggleGroup = (title) => setExpanded(prev => { const n = new Set(prev); if (n.has(title)) n.delete(title); else n.add(title); return n; });
  const allTitles = groupedShifts.map(([t]) => t);
  const isGroupOpen = (title) => !!keyword || expanded.has(title); // 搜尋時自動展開

  const visibleLogs = useMemo(() => logShift ? logs.filter(l => l.shiftName === logShift) : logs, [logs, logShift]);

  const dialogTitle = {
    addShift: '新增班別', editShift: '編輯班別', deleteShift: '刪除班別',
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

        {/* 輪序說明 */}
        <div className="bg-white rounded-2xl shadow-sm border p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-black text-gray-700 flex items-center gap-1"><FileText size={16} className="text-teal-500" /> 輪序說明</h3>
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

        {/* 暫存區操作列（僅管理員） */}
        {isAdmin && (dirty || hasDraft || hasStaged) && (
          <div className={`rounded-2xl border p-3 flex flex-wrap items-center gap-3 justify-between sticky top-0 z-20 shadow-sm ${dirty ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200'}`}>
            <div className="text-xs font-black text-gray-700">
              {dirty ? <span className="text-red-600">有尚未暫存／發布的變更</span> : <span className="text-blue-600">已暫存（僅管理員看得到，尚未發布）</span>}
              <span className="ml-2 text-gray-500 font-bold">打勾標記 {markCount} 筆{work.p ? '｜大夜預排已修改' : ''}（發布後記為 {stageYm} 已排）</span>
            </div>
            <div className="flex gap-2">
              <button disabled={busy} onClick={discardDraft} className="text-xs font-black text-gray-500 px-3 py-1.5 rounded-lg bg-white border hover:bg-gray-100 flex items-center gap-1 disabled:opacity-50"><RotateCcw size={13} /> 捨棄</button>
              <button disabled={busy || !dirty} onClick={saveDraft} className="text-xs font-black text-white px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-800 flex items-center gap-1 disabled:opacity-40"><Save size={13} /> 暫存</button>
              <button disabled={busy || !hasStaged} onClick={publishDraft} className="text-xs font-black text-white px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 flex items-center gap-1 disabled:opacity-40"><CheckCircle2 size={13} /> 儲存（公布）</button>
            </div>
          </div>
        )}

        {/* 大夜（P）輪序 */}
        {loaded && (
          <NightRotationPanel
            p={effectiveP}
            setP={setDraftP}
            canEdit={draftLoaded}
            isAdmin={isAdmin}
            schedule={schedule}
            activeEmployees={activeEmployees}
            nameOf={(id) => empById[String(id)]?.name || String(id)}
          />
        )}

        {/* 班別卡片（依「各班別上班時段」分類，可收合） */}
        {!loaded ? (
          <div className="text-center text-gray-400 font-bold py-10">讀取中...</div>
        ) : visibleShifts.length === 0 ? (
          <div className="text-center text-gray-300 italic font-bold py-10">{shifts.length === 0 ? (isAdmin ? '尚未建立任何班別，請按「新增班別」開始建立。' : '尚未建立任何班別。') : '沒有符合搜尋條件的班別。'}</div>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-end gap-2">
              <button onClick={() => setExpanded(new Set(allTitles))} className="text-[11px] font-black text-gray-500 hover:text-blue-600">全部展開</button>
              <span className="text-gray-300">|</span>
              <button onClick={() => setExpanded(new Set())} className="text-[11px] font-black text-gray-500 hover:text-blue-600">全部收合</button>
            </div>
            {groupedShifts.map(([title, list]) => {
              const open = isGroupOpen(title);
              return (
                <div key={title} className="bg-white rounded-2xl shadow-sm border overflow-hidden">
                  <button onClick={() => toggleGroup(title)} className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50">
                    <span className="font-black text-teal-700 text-sm">{title} <span className="text-[11px] font-bold text-gray-400 ml-1">（{list.length} 個班別）</span></span>
                    <span className="text-gray-400 text-xs font-black">{open ? '▲' : '▼'}</span>
                  </button>
                  {open && (
                    <div className="p-3 border-t bg-gray-50 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                      {list.map(shift => {
                        const sorted = [...shift.members].sort(compareMembers);
                        return (
                          <div key={shift.id} className="bg-white rounded-xl shadow-sm border overflow-hidden flex flex-col">
                            <div className="px-3 py-2 bg-amber-50 border-b flex items-center justify-between">
                              <div className="font-black text-gray-800 text-sm">{shift.name} <span className="text-[10px] font-bold text-gray-400 ml-1">{shift.members.length} 人</span></div>
                              {isAdmin && (
                                <div className="flex gap-0.5">
                                  <button title="編輯班別（名稱、分類）" onClick={() => openDialog('editShift', shift.id)} className="p-1 rounded-lg text-gray-400 hover:bg-white hover:text-blue-600"><Pencil size={13} /></button>
                                  <button title="刪除班別" onClick={() => openDialog('deleteShift', shift.id)} className="p-1 rounded-lg text-gray-400 hover:bg-white hover:text-red-600"><Trash2 size={13} /></button>
                                </div>
                              )}
                            </div>
                            {/* 固定顯示前 4 位待輪值人員，其餘在框內滑動查看 */}
                            <div className="divide-y overflow-y-auto" style={{ maxHeight: '208px' }}>
                              {sorted.length === 0 && <div className="p-4 text-center text-gray-300 italic text-xs font-bold">尚無輪序人員</div>}
                              {sorted.map((m, idx) => {
                                const isNext = idx === 0;
                                const inActive = activeIds.has(String(m.empId));
                                const staged = work.marks[markKey(shift.id, m.empId)] || '';
                                const hit = keyword && (nameOf(m).toLowerCase().includes(keyword) || String(m.empId).toLowerCase().includes(keyword));
                                return (
                                  <div key={m.empId} style={{ minHeight: '52px' }} className={`px-2 py-1.5 flex items-center gap-1.5 ${isNext ? 'bg-yellow-50' : ''} ${hit ? 'ring-2 ring-inset ring-blue-300' : ''}`}>
                                    <span className={`w-5 h-5 flex-none rounded-full text-[10px] font-black flex items-center justify-center ${isNext ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-500'}`}>{idx + 1}</span>
                                    <div className="flex-grow min-w-0">
                                      <div className="text-[13px] font-bold text-gray-800 flex items-center gap-1 flex-wrap leading-tight">
                                        {nameOf(m)}
                                        {isNext && <span className="text-[9px] bg-amber-500 text-white px-1 py-0.5 rounded-full font-black">下一位</span>}
                                        {!inActive && <span className="text-[9px] bg-rose-100 text-rose-600 px-1 py-0.5 rounded-full font-black">不在斗六名冊</span>}
                                      </div>
                                      <div className="text-[10px] text-gray-400 font-mono">{m.empId}</div>
                                    </div>
                                    {staged && <div className="text-[11px] font-black text-red-600 flex-none whitespace-nowrap" title={`${staged} 已排（尚未公布）`}>{Number(staged.slice(5))}月已排</div>}
                                    <div className={`text-[11px] font-mono font-bold flex-none ${m.lastYm ? 'text-gray-600' : 'text-gray-300'}`}>{fmtYm(m.lastYm)}</div>
                                    {isAdmin && (
                                      <div className="flex flex-none items-center">
                                        <button disabled={busy || !draftLoaded} title={staged ? `取消標記（${staged}）` : `標記為 ${stageYm} 已排（暫存，需按暫存或公布）`} onClick={() => toggleMark(shift.id, m.empId)} className={`p-1 rounded-lg disabled:opacity-40 ${staged ? 'bg-red-50 text-red-600' : 'text-gray-400 hover:bg-emerald-50 hover:text-emerald-600'}`}><CheckCircle2 size={14} /></button>
                                        <button title="修改上次輪序年月" onClick={() => openDialog('editYm', shift.id, m.empId)} className="p-1 rounded-lg text-gray-400 hover:bg-blue-50 hover:text-blue-600"><Pencil size={13} /></button>
                                        <button title="移除人員" onClick={() => openDialog('removeMember', shift.id, m.empId)} className="p-1 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600"><X size={14} /></button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                            {isAdmin && (
                              <button onClick={() => openDialog('addMember', shift.id)} className="m-2 py-1 rounded-lg border border-dashed border-gray-300 text-[11px] font-black text-gray-400 hover:border-amber-400 hover:text-amber-600 flex items-center justify-center gap-1"><UserPlus size={13} /> 新增人員</button>
                            )}
                          </div>
                        );
                      })}
                    </div>
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
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-black text-gray-800">{dialogTitle}{dialogShift ? `｜${dialogShift.name}` : ''}</h3>
              <button onClick={closeDialog} className="p-1 text-gray-400 hover:text-gray-700"><X size={18} /></button>
            </div>

            {(dialog.type === 'addShift' || dialog.type === 'editShift') && (
              <>
                <input autoFocus value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="班別名稱（例如 A1、夜診）" className="w-full border rounded-xl p-2.5 text-sm outline-none focus:border-amber-400" />
                <label className="block text-[11px] font-bold text-gray-500">分類（沿用「各班別上班時段」的分類）
                  <select value={form.group} onChange={e => setForm({ ...form, group: e.target.value })} className="mt-1 w-full border rounded-xl p-2.5 text-sm bg-white font-bold">
                    <option value="">自動判斷（依班別名稱對應上班時段）{form.name.trim() && autoGroupOf(form.name.trim()) ? `→ ${autoGroupOf(form.name.trim())}` : ''}</option>
                    {sectionTitles.map(t => <option key={t} value={t}>{t}</option>)}
                    <option value={NO_GROUP}>未分類</option>
                  </select>
                </label>
              </>
            )}

            {dialog.type === 'addMember' && (
              <>
                <div className="flex items-center gap-2">
                  <div className="relative flex-grow">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input value={form.q} onChange={e => setForm({ ...form, q: e.target.value })} placeholder="搜尋姓名或員編" className="w-full pl-8 pr-3 py-2 border rounded-xl text-sm outline-none focus:border-amber-400" />
                  </div>
                  <button type="button" onClick={() => setForm(f => ({ ...f, picked: [...new Set([...f.picked, ...addableEmployees.map(e => String(e.id))])] }))} className="text-[11px] font-black text-blue-600 whitespace-nowrap">全選</button>
                  <button type="button" onClick={() => setForm(f => ({ ...f, picked: [] }))} className="text-[11px] font-black text-gray-400 whitespace-nowrap">清除</button>
                </div>
                <div className="border rounded-xl divide-y overflow-y-auto" style={{ maxHeight: '240px' }}>
                  {addableEmployees.length === 0 && <div className="p-4 text-center text-gray-300 italic text-xs font-bold">沒有可新增的人員（僅列出斗六院區、一般藥師）</div>}
                  {addableEmployees.map(e => {
                    const id = String(e.id);
                    const checked = form.picked.includes(id);
                    return (
                      <label key={id} className={`flex items-center gap-2 px-3 py-2 cursor-pointer text-sm ${checked ? 'bg-amber-50' : 'hover:bg-gray-50'}`}>
                        <input type="checkbox" checked={checked} onChange={() => togglePick(id)} className="w-4 h-4 accent-amber-500" />
                        <span className="font-bold text-gray-800">{e.name}</span>
                        <span className="text-[11px] text-gray-400 font-mono">{id}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="text-[11px] font-bold text-gray-500">已勾選 {form.picked.length} 人（僅列出斗六院區、一般藥師）</div>
                <label className="block text-[11px] font-bold text-gray-500">上次輪序年月（套用到全部勾選人員，可留空＝從未輪過）
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

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, onSnapshot, collection, query, updateDoc, deleteDoc } from 'firebase/firestore';
import { 
  Home, UserCog, CalendarRange, ArrowLeftRight, Clock, LayoutGrid, Download, Upload, LogIn, LogOut,
  GripVertical, Plus, Trash2, Save, UserPlus, AlertCircle, Calendar as CalendarIcon, CheckCircle2,
  XCircle, Undo2, Redo2, Copy, FileText, SeparatorHorizontal, Info, ChevronLeft, ChevronRight, PaintBucket,
  Eye, EyeOff, ShieldCheck, ShieldAlert, BarChart3, History, Search, Check, X, ClipboardList, MessageSquare, User, Circle, Settings, Dice5, Lock, TrendingUp, aCalculator
} from 'lucide-react';

// --- 常數定義與初始資料 ---
// 版本記錄：V1.8 - 深度重構連續換班校驗：僅校驗 Target 並相容 P#/P 變化
const WEEKDAYS_MAP = ["日", "一", "二", "三", "四", "五", "六"];
const PALETTE = [
  { name: '無色', class: 'bg-white' },
  { name: '黃', class: 'bg-yellow-200' },
  { name: '藍', class: 'bg-blue-200' },
  { name: '綠', class: 'bg-green-200' },
  { name: '紫', class: 'bg-purple-200' },
  { name: '週六橘', class: 'bg-[#FFB366]' },
  { name: '週日粉', class: 'bg-[#FFB3D9]' }
];

const INITIAL_EMPLOYEES = [
  { id: "Y04409", name: "謝承穎", role: "0", labor: "N", password: "" },
  { id: "SEP1", isSeparator: true },
  { id: "Y06100", name: "陳麗珺", role: "0", labor: "N", password: "123" },
  { id: "Y00243", name: "黃永成", role: "1", labor: "N", password: "" },
  { id: "SEP2", isSeparator: true },
  { id: "Y00326", name: "沈倩如", role: "1", labor: "Y", password: "" },
  { id: "Y08215", name: "王玟璇", role: "1", labor: "Y", password: "" },
  { id: "SEP_NC", isSeparator: true },
  { id: "E1", name: "夜診18", role: "2", labor: "N", password: "", isNightClinic: true },
  { id: "E2", name: "夜診18.5", role: "2", labor: "N", password: "", isNightClinic: true },
  { id: "E3", name: "夜診支援", role: "2", labor: "N", password: "", isNightClinic: true }
];

const INITIAL_SHIFTS = [
  { id: "S1", name: "DI", code: "1", isRegular: "Y", regularDays: ["一", "二", "三", "四", "五"] },
  { id: "S2", name: "B8", code: "1", isRegular: "Y", regularDays: ["一", "二", "三", "四", "五"] },
  { id: "S3", name: "例", code: "-3", isRegular: "Y", regularDays: ["六", "日"] },
  { id: "S4", name: "國", code: "-2", isRegular: "Y", regularDays: ["國"] }
];

const INITIAL_PERSON_DAY_RULES = [
  { id: 1, pattern: '/5', value: '0', mode: 'suffix' },
  { id: 2, pattern: '/6', value: '0', mode: 'suffix' },
  { id: 3, pattern: '/7', value: '0', mode: 'suffix' },
  { id: 4, pattern: 'B4(國)', value: '0.5', mode: 'exact' },
  { id: 5, pattern: 'B4', value: '0.5', mode: 'exact' },
  { id: 6, pattern: 'B4#', value: '0.5', mode: 'exact' },
  { id: 7, pattern: 'SL', value: '0.5', mode: 'exact' },
  { id: 8, pattern: 'SL#', value: '0.5', mode: 'exact' },
  { id: 9, pattern: '/1', value: '0.5', mode: 'suffix' },
  { id: 10, pattern: '/2', value: '0.5', mode: 'suffix' },
  { id: 11, pattern: '/3', value: '0.5', mode: 'suffix' },
  { id: 12, pattern: '/4', value: '0.5', mode: 'suffix' }
];

// Firebase 配置
const firebaseConfig = {
  apiKey: "AIzaSyApEBgpAFaytqPBtPTEXE-fr8o4LdzKzPA",
  authDomain: "pharmacy-scheduling-e20ad.firebaseapp.com",
  projectId: "pharmacy-scheduling-e20ad",
  storageBucket: "pharmacy-scheduling-e20ad.firebasestorage.app",
  messagingSenderId: "779276168089",
  appId: "1:779276168089:web:c57dfd4db57beef3804108",
  measurementId: "G-BVDVEYZEDT"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'pharmacy-system-v1-8';

// --- 輔助函數 ---
const deepClone = (obj) => {
  if (!obj) return obj;
  return JSON.parse(JSON.stringify(obj));
};

const isCycleEnd = (dateStr) => {
  if (!dateStr) return false;
  const baseEnd = new Date('2025-12-20').getTime();
  const target = new Date(dateStr).getTime();
  const diffDays = Math.round((target - baseEnd) / (1000 * 60 * 60 * 24));
  return diffDays >= 0 && diffDays % 14 === 0;
};

const parseROCTitle = (title) => {
  if (!title) return null;
  const cleanTitle = title.replace(/["' \s　\n\r]/g, '');
  const match = cleanTitle.match(/(\d+)年(\d+)月/);
  if (match) {
    const year = parseInt(match[1]) + 1911;
    const month = match[2].padStart(2, '0');
    return `${year}-${month}`;
  }
  return null;
};

const toROCTitle = (currentMonth) => {
  if (!currentMonth) return "";
  const parts = currentMonth.split('-');
  if (parts.length < 2) return currentMonth;
  const year = parseInt(parts[0]) - 1911;
  const month = parseInt(parts[1]);
  return `${year}年${month}月`;
};

const getIsNightClinic = (emp) => {
  if (!emp) return false;
  return (
    emp.isNightClinic === true || 
    (emp.name && emp.name.includes("夜診")) || 
    (emp.id && (emp.id === "E1" || emp.id === "E2" || emp.id === "E3"))
  );
};

// --- 通用小組件 ---
const NavButton = ({ id, label, icon: Icon, colorClass, active, onClick, hasDot }) => (
  <button
    onClick={() => onClick(id)}
    className={`relative flex items-center px-3 py-1.5 text-xs font-bold transition-all shadow-sm ${
      active ? `${colorClass} text-black ring-1 ring-black scale-105` : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
    } rounded-md`}
  >
    <Icon className="w-3 h-3 mr-1" />
    {label}
    {hasDot && (
      <span className="absolute -top-1 -right-1 flex h-3 w-3">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-3 w-3 bg-red-600"></span>
      </span>
    )}
  </button>
);

const Modal = ({ isOpen, onClose, onConfirm, title, message, confirmText = "確定", cancelText = "取消", type = "danger", children }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[700] flex items-center justify-center bg-black bg-opacity-50 p-4 font-sans backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 animate-in zoom-in duration-200">
        <div className={`flex items-center mb-4 ${type === 'danger' ? 'text-red-600' : 'text-blue-600'}`}>
          <AlertCircle className="w-6 h-6 mr-2" />
          <h3 className="text-lg font-bold">{title}</h3>
        </div>
        {message && <div className="text-gray-600 mb-6 text-sm whitespace-pre-wrap leading-relaxed">{message}</div>}
        {children}
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-gray-400 hover:bg-gray-100 rounded-xl transition-all">取消</button>
          <button onClick={onConfirm} className={`px-4 py-2 text-sm font-bold text-white rounded-xl shadow-lg transition-all ${type === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
};

const SwapRequestModal = ({ isOpen, onClose, onConfirm, data, setIsModalOpen, handleSwapBack, schedule, currentMonth }) => {
  if (!isOpen || !data) return null;
  const isBundle = data.isBundle;

  return (
    <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black bg-opacity-60 p-4 font-sans backdrop-blur-md">
      <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full overflow-hidden animate-in slide-in-from-bottom duration-300">
        <div className="bg-gradient-to-r from-cyan-600 to-blue-700 p-6 text-white text-center">
          <ArrowLeftRight className="mx-auto mb-2" size={32}/>
          <h3 className="text-xl font-black">換班申請</h3>
          {isBundle && <span className="inline-block mt-1 bg-yellow-400 text-blue-900 text-[10px] px-2 py-0.5 rounded-full font-black animate-pulse">整段換班</span>}
          <p className="text-blue-100 text-xs mt-1">需經所有參與人員與組長核定</p>
        </div>

        <div className="p-6 space-y-4">
          <div className="text-center bg-gray-50 p-3 rounded-2xl border border-dashed font-bold text-blue-800">
            {isBundle ? `${data.startDate} ~ ${data.endDate}` : `${data.date} (${data.dayOfWeek})`}
          </div>

          {/* 需求 1：呈現更換班別內容 A -> B */}
          {isBundle && schedule && currentMonth ? (
            <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-1">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">每日換班對照明細 (顯示換班後的結果)</label>
              <div className="rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                <table className="w-full text-center text-xs bg-white">
                  <thead className="bg-gray-100 text-gray-600 border-b border-gray-200 sticky top-0 z-10">
                    <tr>
                      <th className="py-2 px-1 font-bold">日期</th>
                      {data.participants.map(p => (
                        <th key={p.id} className="py-2 px-1 font-bold">{p.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.daysToSwap.map((day) => (
                      <tr key={day} className="hover:bg-blue-50/50 transition-colors">
                        <td className="py-2 font-black text-gray-500 bg-gray-50/50 border-r border-gray-100 w-12">{day}日</td>
                        {data.participants.map((p, idx) => {
                          // 抓取當前這天的原始班別
                          const shift = schedule[currentMonth]?.[p.name]?.[day] || "-";
                          // 抓取換班後會獲得的新班別
                          const nextPerson = data.participants[(idx + 1) % data.participants.length];
                          const nextShift = schedule[currentMonth]?.[nextPerson.name]?.[day] || "-";

                          return (
                            <td key={p.id} className="py-1.5 px-1">
                              <div className="flex flex-col items-center justify-center">
                                {/* 原本的班別，打上刪除線表示即將換出 */}
                                <span className="text-gray-400 line-through text-[9px] mb-0.5">{shift}</span>
                                {/* 換進來的新班別，高亮顯示 */}
                                <span className={`px-2 py-0.5 rounded font-black text-[11px] ${nextShift === '-' ? 'bg-gray-100 text-gray-400' : 'bg-blue-100 text-blue-700 shadow-sm border border-blue-200'}`}>
                                  {nextShift}
                                </span>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">換班連鎖路徑</label>
              <div className="space-y-2">
                {data.participants.map((p, idx) => {
                  const nextPerson = data.participants[(idx + 1) % data.participants.length];
                  return (
                    <div key={idx} className="flex justify-between items-center bg-blue-50/50 p-3 rounded-2xl border border-blue-100/50">
                      <span className="font-black text-gray-700 text-sm">{p.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400 text-[11px] font-bold">({p.oldShift})</span>
                        <ArrowLeftRight size={10} className="text-blue-400" />
                        <span className="text-blue-700 font-black text-sm bg-white px-2 py-0.5 rounded-lg shadow-sm">
                          ({nextPerson.oldShift})
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="p-6 pt-0 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {/* 需求 2 的一部分：若是單日換班，提供多人換班按鈕 */}
            {!isBundle && (
              <button onClick={() => setIsModalOpen(false)} className="py-3 text-sm font-black text-blue-600 bg-blue-50 rounded-2xl hover:bg-blue-100 transition-all border border-blue-100">＋ 多人換班</button>
            )}
            <button onClick={onConfirm} className="py-3 text-sm font-black text-white bg-blue-600 rounded-2xl shadow-lg hover:bg-blue-700 transition-all">送出申請</button>
          </div>

          {/* 需求 2：回到上一步 (當選到 3 人以上時出現) */}
          {data.participants.length > 2 && (
            <button 
              onClick={handleSwapBack} 
              className="w-full py-2 text-xs font-black text-amber-600 bg-amber-50 rounded-xl hover:bg-amber-100 transition-all flex items-center justify-center gap-1 border border-amber-100"
            >
              <Undo2 size={14}/> 回到上一步 (移除最後選的人)
            </button>
          )}

          <button onClick={onClose} className="w-full py-3 text-sm font-bold text-gray-400 bg-gray-100 rounded-2xl hover:bg-gray-100 transition-colors">清空並關閉</button>
        </div>
      </div>
    </div>
  );
};

const Header = ({ currentMonth, setCurrentMonth, currentPage, handlePageChange, isLoggedIn, currentUser, handleLogout, exportScheduleCSV, swapRequests, isDirty, setEditSched }) => {
  const isAdmin = currentUser?.role === '0';
  const hasPending = useMemo(() => {
      if (!isLoggedIn || !currentUser) return false;
      
      return swapRequests.some(req => {
        const adminNotice = isAdmin && req.status === 'PendingAdmin';
        const participantNotice = 
          req.status === 'WaitingParticipants' &&
          req.participants?.some(p => p.id === currentUser.id) &&
          req.creatorId !== currentUser.id &&
          req.approvals?.find(a => a.id === currentUser.id)?.status === 'Pending';
        return adminNotice || participantNotice;
      });
    }, [swapRequests, isLoggedIn, currentUser, isAdmin]);

  // 💡 修正防線：控管全域月份切換，若在排班頁面編輯中，跳出警示
  const handleMonthInputChange = (e) => {
    const nextMonthVal = e.target.value;
    if (!nextMonthVal) return;

    if (currentPage === 'schedule' && isDirty) {
      const confirmLeave = window.confirm("⚠️ 偵測到目前月份的班表已有編輯內容、尚未發佈！\n\n點擊「確定」將會放棄目前的修改並切換月份，點擊「取消」則留在原月份。");
      if (!confirmLeave) return; // 使用者按取消，阻斷切換
    }

    // 💡 確定要切換月份：通知排班編輯器清空舊月份的鎖，並變更月份
    if (typeof setEditSched === 'function') {
      setEditSched({});
    }
    setCurrentMonth(nextMonthVal);
  };

  return (
    <header className="bg-white border-b-2 border-gray-800 p-2 sm:p-3 sticky top-0 z-[100] shadow-md">
      <div className="max-w-full flex flex-col lg:flex-row lg:items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xs font-black text-gray-800 border-r-2 border-gray-300 pr-4 leading-none cursor-pointer" onClick={() => handlePageChange('home')}>台大雲林藥劑部班表 <span className="text-[10px] text-gray-400 font-normal ml-1">V1.8</span></h1>
          <div className="flex items-center gap-2">
            <input 
              type="month" 
              value={currentMonth} 
              
              // 💡 修正點：利用妳原本就有的 currentPage 與 isDirty 進行防呆攔截
              onChange={(e) => {
                const nextMonthVal = e.target.value;
                if (!nextMonthVal) return;

                if (currentPage === 'schedule' && isDirty) {
                  const confirmLeave = window.confirm("⚠️ 偵測到目前月份的班表已有編輯內容、尚未發佈！\n\n點擊「確定」將會放棄目前的修改並切換月份，點擊「取消」則留在原月份。");
                  if (!confirmLeave) return; // 使用者按取消，直接阻斷月份切換
                }
                
                // 通過檢查，或是沒被更改過，直接切換月份
                setCurrentMonth(nextMonthVal);
              }} 
              className="border-2 border-gray-300 rounded px-1.5 py-0.5 text-xs font-bold focus:border-blue-500 outline-none" 
            />
            {isLoggedIn && (<span className="text-[11px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-100 flex items-center gap-1"><User size={12}/> 哈囉, {currentUser.name}</span>)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <NavButton id="home" label="首頁" icon={Home} colorClass="bg-yellow-400" active={currentPage==='home'} onClick={handlePageChange} />
          {isLoggedIn && isAdmin && (
            <>
              <NavButton id="account" label="帳號管理" icon={UserCog} colorClass="bg-pink-200" active={currentPage==='account'} onClick={handlePageChange} />
              <NavButton id="shifts" label="班別管理" icon={CalendarRange} colorClass="bg-blue-100" active={currentPage==='shifts'} onClick={handlePageChange} />
            </>
          )}
          <NavButton id="swap" label="換班" icon={ArrowLeftRight} colorClass="bg-cyan-200" active={currentPage==='swap'} onClick={handlePageChange} />
          <NavButton id="records" label="紀錄" icon={History} colorClass="bg-indigo-200" active={currentPage==='records'} onClick={handlePageChange} hasDot={hasPending} />
          <NavButton id="leave" label="預假" icon={Clock} colorClass="bg-orange-200" active={currentPage==='leave'} onClick={handlePageChange} />
          {isLoggedIn && isAdmin && (
            <>
              <NavButton id="schedule" label="排班" icon={LayoutGrid} colorClass="bg-purple-200" active={currentPage==='schedule'} onClick={handlePageChange} />
              <NavButton id="report" label="管理報表" icon={BarChart3} colorClass="bg-emerald-200" active={currentPage==='report'} onClick={handlePageChange} />
            </>
          )}
          <div className="ml-2 pl-2 border-l border-gray-300">
            {!isLoggedIn ? <button onClick={() => handlePageChange('login')} className="bg-blue-600 text-white px-3 py-1 text-xs rounded font-bold hover:bg-blue-700 shadow transition">登入</button> : <button onClick={handleLogout} className="bg-gray-800 text-white px-2 py-1 text-xs rounded hover:bg-black flex items-center gap-1 shadow transition"><LogOut size={12}/> 登出</button>}
          </div>
        </div>
      </div>
    </header>
  );
};

const ScheduleTableView = ({ currentMonth, employees, schedule, cellColors, daysInMonth, onCellClick, swapRequests = [], currentPage, currentUser, swapTarget, handleSwapBack, isCycleEnd: checkCycleEnd}) => {

  const isHome = currentPage === 'home';
  const isSwap = currentPage === 'swap';
  const headerTop = onCellClick ? 'top-[44px]' : 'top-0';
  const hasSupportData = useMemo(() => {
  const supportRow = schedule[currentMonth]?.["夜診支援"] || {};
    return Object.values(supportRow).some(v => v && v !== "-" && v !== "#" && v !== "例" && v !== "");
  }, [schedule, currentMonth]);
  
  return (
    <div className="flex-grow flex flex-col h-full bg-gray-50 font-sans overflow-hidden">
      {onCellClick && (
        <div className="flex-none bg-[#2A85A1] text-white py-2.5 px-4 text-center font-black text-sm shadow-md z-[110]">
          <Info size={16} className="inline mr-2 mb-0.5" />
          換班系統：點選欲換人員班別即可申請換班 </div>)}

      {/*這裡才是真正會捲動的容器 */}
      <div className="flex-grow overflow-auto relative">
        <table className="w-full text-[12px] text-center border-separate border-spacing-0 table-fixed min-w-[1600px] lg:min-w-[1800px]">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-[100] bg-gray-100 p-3 w-16 font-black text-[11px] shadow-[2px_2px_5px_rgba(0,0,0,0.1)] border-b-2 border-r-2 border-gray-300">姓名</th>
              {daysInMonth.map(d => {
                const cycleEnd = isCycleEnd(d.fullDate);
                let bgClass = "bg-gray-100";
                if (d.rawDay === 0 || d.holiday) bgClass = "bg-[#FFB3D9]";
                else if (d.rawDay === 6) bgClass = "bg-[#FFB366]";
                return (
                  <th key={d.day} 
                    className={`sticky top-0 z-[90] p-1 w-12 font-bold border-b-2 border-r border-gray-300 ${bgClass} ${cycleEnd ? 'border-r-4 border-r-gray-400' : ''}`} >
                    <div className="text-[10px] opacity-60">{d.dayOfWeek}</div>
                    <div className="text-base">{d.day}</div>
                    <div className="text-[9px] text-red-600 truncate h-4 leading-none font-normal">{String(d.holiday || "")}</div>
                  </th>);})}</tr>
          </thead>

          <tbody>
            {employees.map(emp => {
              if (emp.isSeparator) return <tr key={emp.id} className="bg-gray-200 h-[2px] border-y-0"><td colSpan={daysInMonth.length + 1}></td></tr>;
              const isNC = getIsNightClinic(emp);
              if (isSwap && (isNC || emp.role === '2' || emp.role === '3')) return null;
              if (currentPage !== 'schedule' && emp.name === "夜診支援" && !hasSupportData) return null;

              return (
                <tr key={emp.id} className="hover:bg-blue-50 transition-colors border-b group">
                  <td className="sticky left-0 z-20 bg-white border p-2 font-black group-hover:bg-blue-50 text-[12px] truncate shadow-[2px_0_5_rgba(0,0,0,0.05)]">{emp.name}</td>
                  {daysInMonth.map(d => {
                    const val = schedule[currentMonth]?.[emp.name]?.[d.day] || "-";
                    const customColor = cellColors[currentMonth]?.[emp.name]?.[d.day];
                    const cycleEnd = isCycleEnd(d.fullDate);
                    
                    const isPendingSwap = currentPage === 'swap' && swapRequests.some(r => 
                      (r.creatorId === currentUser?.id || r.targetId === currentUser?.id) &&
                      (r.creatorName === emp.name || r.targetName === emp.name) && 
                      (r.isBundle ? (d.day >= r.daysToSwap[0] && d.day <= r.daysToSwap[r.daysToSwap.length - 1]) : (r.date === d.fullDate)) &&
                      (r.status === 'PendingTarget' || r.status === 'PendingAdmin')
                    );

                    let bgClass = "bg-white";
                    if (isPendingSwap) bgClass = "bg-blue-100/60"; 
                    else if (customColor && customColor !== "bg-white") bgClass = customColor;
                    else if (d.rawDay === 0 || !!d.holiday) bgClass = "bg-[#FFB3D9]";
                    else if (d.rawDay === 6) bgClass = "bg-[#FFB366]";

                    const parts = val.split('/');
                    const displayPart = (parts[1] && !isNaN(parts[1])) ? (parts[0] || "-") : val;
                    const leaveMsg = (parts[1] && !isNaN(parts[1])) ? `假:${parts[1]}h` : null;

                    // 💡 步驟一：還原乾淨的外殼，邊框就不會再被吃掉了
                    return (
                      <td key={d.day} 
                        className={`border p-0 ${isNC ? 'h-[32px]' : 'h-10'} ${bgClass} ${
                          onCellClick && !isNC ? 'cursor-pointer hover:bg-blue-50 shadow-inner' : 'cursor-default'
                        } transition-all relative ${cycleEnd ? 'border-r-4 border-r-gray-400' : ''}`} 
                        onClick={() => onCellClick && !isNC && onCellClick(emp, d)}
                      >
                        <div className={`flex flex-col items-center justify-center h-full relative`}>
                          
                          {/* 💡 步驟二：從這裡開始貼上我們「額外疊上去」的高亮層 */}
                          {(() => {
                            if (currentPage !== 'swap') return null;

                            // A. 正在點選中的格子
                            let isSelecting = false;
                            if (swapTarget && swapTarget.participants?.some(p => p.id === emp.id)) {
                              if (swapTarget.isBundle && swapTarget.daysToSwap) {
                                const monthPrefix = swapTarget.date.substring(0, 7);
                                const bundleDates = swapTarget.daysToSwap.map(day => `${monthPrefix}-${String(day).padStart(2, '0')}`);
                                isSelecting = bundleDates.includes(d.fullDate);
                              } else {
                                isSelecting = swapTarget.date === d.fullDate;
                              }
                            }
                            
                            // B. 已送出申請的格子
                            const isMyApplyingDate = emp.applyingDates?.includes(d.fullDate) && (
                              swapRequests.some(req => {
                                const isValidStatus = req.status === 'WaitingParticipants' || req.status === 'PendingAdmin';
                                const isParticipant = req.participants?.some(p => p.id === currentUser.id);
                                if (!isValidStatus || !isParticipant) return false;

                                if (req.isBundle && req.daysToSwap) {
                                  const monthPrefix = (req.date || d.fullDate).substring(0, 7);
                                  const bundleDates = req.daysToSwap.map(day => `${monthPrefix}-${String(day).padStart(2, '0')}`);
                                  return bundleDates.includes(d.fullDate);
                                } else {
                                  return req.date === d.fullDate;
                                }
                              })
                            );

                            // 如果符合條件，就單獨在格子內部「疊上一層」絕對定位的外框，絕不影響 td 本身的邊框
                            if (isSelecting || isMyApplyingDate) {
                              return <div className="absolute inset-0 bg-blue-50/60 border-2 border-blue-400 pointer-events-none z-0" />;
                            }
                            return null;
                          })()}
                          {/* 💡 高亮層結束 */}

                          {/* 以下維持您原本格子的內文文字與小圓點（確保它們在 z-10 顯示在藍底上方） */}
                          {isPendingSwap && (
                            <div className="absolute -top-3 -right-0.5 w-2 h-2 bg-blue-600 rounded-full animate-pulse shadow-sm z-10" title="換班申請中"></div>
                          )}
                          <span className={`z-10 ${isSwap ? 'font-normal' : (isHome ? 'font-medium' : 'font-black')} ${isPendingSwap ? 'text-blue-900 scale-105 drop-shadow-sm' : (displayPart === "-" ? 'text-gray-300' : 'text-gray-800')} text-[13px] transition-all`}>
                            {displayPart}
                          </span>
                          {leaveMsg && <span className="text-[9px] text-red-600 font-black bg-red-50 rounded px-1.5 mt-1 leading-none shadow-sm z-10">{leaveMsg}</span>}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

 const PreLeaveView = ({ currentMonth, employees, daysInMonth, currentUser, schedule, setSchedule, preLeaveData, setPreLeaveData, saveData }) => {
  const [defaultHolidayLimit, setDefaultHolidayLimit] = useState(10);
  const [defaultWeekdayLimit, setDefaultWeekdayLimit] = useState(3);
  const [lotteryDay, setLotteryDay] = useState(15);
  const isAdmin = currentUser?.role === '0';
  const isMonthDrawn = (preLeaveData.drawnMonths || []).includes(currentMonth);

// ========================================================
  // 💡 完美修正：對齊「每月 X 號 00:00 抽出下個月預假結果」的月份邏輯
  // ========================================================
  useEffect(() => {
    // 沒登入或還沒載入好預假資料就先不執行
    if (!currentUser || !preLeaveData) return;

    const handleAutoLotteryCheck = async () => {
      try {
        const now = Date.now(); // 取得當前時間毫秒數
        
        // 1. 抽籤日綁定 preLeaveData.lotteryDay (例如：15)
        const targetDay = preLeaveData.lotteryDay || 15;
        
        // 2. 💡 關鍵修正：currentMonth 是同仁當前畫面切換到、準備要抽籤的「目標月份」（例如 "2026-06"）
        const [yearStr, monthStr] = currentMonth.split('-');
        const targetYear = parseInt(yearStr);
        const targetMonthNum = parseInt(monthStr); // 目標月份，例如 6

        // 3. 💡 往前推算「應該要執行抽籤的時間點」
        // JS Date 的月份是 0~11 (0代表1月)。目標月份減 1 是它的 JS 月份，再減 1 就是「前一個月」
        // 例如：目標 6 月 (JS 為 5)，計算出來的執行點就會精確落在 5 月的 targetDay 00:00:00
        const executionDate = new Date(targetYear, targetMonthNum - 2, targetDay, 0, 0, 0);
        const drawTimeTimestamp = executionDate.getTime();

        // 4. 核心判定：如果「該目標月份尚未抽籤(!isMonthDrawn)」且「目前時間已過設定的執行時間」
        if (!isMonthDrawn && now >= drawTimeTimestamp) {
          console.log(`⏰ 偵測到時間已過截止點 (${executionDate.toLocaleString()})，系統自動為 ${currentMonth} 月份執行預假抽籤...`);
          
          // 5. 完美呼叫組件內原本就有的 handleLottery 函數
          if (typeof handleLottery === 'function') {
            await handleLottery({ isAuto: true });
            console.log(`🎉 ${currentMonth} 月份自動抽籤執行並存檔成功！`);
          }
        }
      } catch (error) {
        console.error("自動抽籤月份邏輯計算或執行失敗：", error);
      }
    };

    handleAutoLotteryCheck();
  }, [currentMonth, preLeaveData, isMonthDrawn, currentUser]); // 精確監聽子組件內的狀態

  useEffect(() => {
    if (!schedule[currentMonth]) return;
    let changed = false;
    const next = deepClone(preLeaveData);
    if (!next.apps || !next.apps[currentMonth]) return;
    Object.keys(next.apps[currentMonth]).forEach(empName => {
      Object.keys(next.apps[currentMonth][empName]).forEach(day => {
        const sVal = schedule[currentMonth]?.[empName]?.[day];
        if (['休', '公假', '例'].includes(sVal) && next.apps[currentMonth][empName][day] === "預假") {
          next.apps[currentMonth][empName][day] = null;
          changed = true;
        }
      });
    });
    
    if (changed) {
      setPreLeaveData(next);
      saveData({ preLeaveData: next }); 
    }
  }, [currentMonth, schedule]);

  const handleToggle = (empName, day) => {
    if (isMonthDrawn) return;
    const sVal = schedule[currentMonth]?.[empName]?.[day];
    if (['休', '公假', '例'].includes(sVal)) return; 
    if (!isAdmin && empName !== currentUser?.name) return;
    const next = deepClone(preLeaveData);
    if (!next.apps) next.apps = {};
    if (!next.apps[currentMonth]) next.apps[currentMonth] = {};
    if (!next.apps[currentMonth][empName]) next.apps[currentMonth][empName] = {};
    next.apps[currentMonth][empName][day] = next.apps[currentMonth][empName][day] === "預假" ? null : "預假";
    setPreLeaveData(next);
    saveData({ preLeaveData: next }); 
  };

  const getLeaveList = (day) => {
    return employees
      .filter(e => !e.isSeparator && !getIsNightClinic(e) && e.role !== '2' && e.role !== '3' &&  preLeaveData.apps?.[currentMonth]?.[e.name]?.[day] === "預假") 
      .map(e => e.name);
  };

  const handleExportPreLeave = () => {
    let csv = "\ufeff項目/日期," + daysInMonth.map(d => `${d.day}(${d.dayOfWeek})`).join(",") + "\n";
    csv += "備註," + daysInMonth.map(d => `"${preLeaveData.remarks?.[currentMonth]?.[d.day] || ""}"`).join(",") + "\n";
    csv += "可休人數," + daysInMonth.map(d => preLeaveData.dailyLimits?.[currentMonth]?.[d.day] || (d.rawDay === 0 || d.rawDay === 6 || d.holiday ? defaultHolidayLimit : defaultWeekdayLimit)).join(",") + "\n";
    csv += "---藥師預假詳情---\n";
    employees.filter(e => !e.isSeparator).forEach(emp => {
      csv += `${emp.name},` + daysInMonth.map(d => {
        const sVal = schedule[currentMonth]?.[emp.name]?.[d.day];
        if (['休', '公假', '例', '休假'].includes(sVal)) return sVal;
        return preLeaveData.apps?.[currentMonth]?.[emp.name]?.[d.day] || "";
      }).join(",") + "\n";
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `預假橫式備份_${currentMonth}.csv`;
    link.click();
  };
  
  const handleAdminSettingChange = (type, value) => {
  if (!isAdmin) return;
  const next = deepClone(preLeaveData);
  if (type === 'holiday') next.weekendLimit = value;
  else if (type === 'weekday') next.weekdayLimit = value;
  else if (type === 'lotteryDay') next.lotteryDay = value; setPreLeaveData(next);saveData({ preLeaveData: next }); 
  };


  // 💡 修正後：安全防白屏、支援手動與自動抽籤的 handleLottery
  const handleLottery = async (e) => {
    if (isMonthDrawn) return;

    // 1️⃣ 檢查這個觸發是不是來自於自動抽籤
    const isAuto = e && e.isAuto;

    if (!isAuto) {
      // 如果不是自動觸發（代表是管理員手動按下「立即手動抽籤」按鈕），才跳出確認詢問視窗
      const confirmDraw = window.confirm("確定要立即手動抽籤嗎？抽籤後將會鎖定本月班表。");
      if (!confirmDraw) return;
    }
    
    const nextSched = deepClone(schedule);
    if (!nextSched[currentMonth]) nextSched[currentMonth] = {};

    daysInMonth.forEach(d => {
      const candidates = getLeaveList(d.day);
      const limit = parseInt(preLeaveData.dailyLimits?.[currentMonth]?.[d.day] || (d.rawDay === 0 || d.rawDay === 6 || d.holiday ? defaultHolidayLimit : defaultWeekdayLimit));
      const winners = [...candidates].sort(() => 0.5 - Math.random()).slice(0, limit);
      winners.forEach(name => {
        if (!nextSched[currentMonth][name]) nextSched[currentMonth][name] = {};
        nextSched[currentMonth][name][d.day] = "休"; 
      });
    });

    const nextPreLeave = {
      ...preLeaveData,
      drawnMonths: [...(preLeaveData.drawnMonths || []), currentMonth]
    };

    setSchedule(nextSched);
    setPreLeaveData(nextPreLeave);
    
    // 💡 加上 await 確保安全存檔完畢
    await saveData({ schedule: nextSched, preLeaveData: nextPreLeave });
    
    // 2️⃣ 🔥 關鍵修正點：只有在「手動按下按鈕(!isAuto)」時，才允許執行彈窗提示！
    if (!isAuto) {
      setTimeout(() => {
        alert(`${currentMonth} 手動抽籤完成！結果已同步至班表。`);
      }, 100);
    }
  };

  return (
    <div className="flex-grow flex flex-col bg-white overflow-hidden select-none font-sans">
      <div className="flex-grow overflow-auto relative">
        <table className="w-full text-center border-collapse table-fixed min-w-[1000px] text-[11px]">
          <thead className="sticky top-0 z-30 bg-white shadow-sm">
            <tr className="bg-gray-100 border-b">
              <th className="sticky left-0 z-40 bg-gray-100 border p-2 w-16 font-black">日期</th>
              {daysInMonth.map(d => {
                const cycleEnd = isCycleEnd(d.fullDate);
                return (
                  <th key={d.day} className={`border p-1 w-12 font-bold ${cycleEnd ? 'border-r-4 border-r-gray-400' : ''} ${d.rawDay === 0 || d.holiday ? 'bg-[#FFB3D9]' : d.rawDay === 6 ? 'bg-[#FFB366]' : ''}`}>
                    <div className="text-[10px] opacity-60">{d.dayOfWeek}</div><div className="text-sm">{d.day}</div>
                    <div className="text-[8px] text-red-600 truncate h-3 leading-none font-normal">{String(d.holiday || "")}</div>
                  </th>
                );
              })}
            </tr>
            <tr className="bg-[#F3E5F5] border-b">
             <td className="sticky left-0 top-[48px] z-40 bg-[#F3E5F5] border p-2 font-bold text-purple-600 text-[10px]">備註</td>
             {daysInMonth.map(d => (
               <td key={d.day} className={`border p-0.5 align-middle ${isCycleEnd(d.fullDate) ? 'border-r-4 border-r-gray-400' : ''}`}>
               <textarea 
                rows={1}
               value={preLeaveData.remarks?.[currentMonth]?.[d.day] || ""} 
               disabled={!isAdmin || isMonthDrawn}
                onChange={e => { 
                  const next = deepClone(preLeaveData); 
                  if(!next.remarks) next.remarks = {};
                  if(!next.remarks[currentMonth]) next.remarks[currentMonth] = {}; 
                  next.remarks[currentMonth][d.day] = e.target.value;   
                  setPreLeaveData(next);
                  saveData({ preLeaveData: next }); 
                }}
              className={`w-full bg-transparent text-[11px] font-bold text-purple-600 text-center outline-none resize-none overflow-hidden block ${(!isAdmin || isMonthDrawn) ? 'cursor-not-allowed opacity-70' : 'cursor-text'}`}
              style={{ fieldSizing: 'content', minHeight: '1.5em' }}
                  />
               </td>
              ))}
            </tr>
            <tr className="bg-[#E0F2F1] border-b">
              <td className="sticky left-0 z-40 bg-[#E0F2F1] border p-1 font-bold text-teal-700 text-[10px]">可休人數</td>
              {daysInMonth.map(d => (
                <td key={d.day} className={`border p-1 font-bold text-teal-800 ${isCycleEnd(d.fullDate) ? 'border-r-4 border-r-gray-400' : ''}`}>
                  <input 
                    type="text" 
                    value={preLeaveData.dailyLimits?.[currentMonth]?.[d.day] || (d.rawDay === 0 || d.rawDay === 6 || d.holiday ? preLeaveData.weekendLimit : preLeaveData.weekdayLimit)} 
                    onChange={e => { const next = deepClone(preLeaveData);  if(!next.dailyLimits) next.dailyLimits = {};if(!next.dailyLimits[currentMonth]) next.dailyLimits[currentMonth] = {};  next.dailyLimits[currentMonth][d.day] = e.target.value; setPreLeaveData(next);}}
                    className={`w-full bg-transparent text-center font-bold text-teal-800 outline-none ${(!isAdmin || isMonthDrawn) ? 'cursor-not-allowed' : ''}`}
                  />
                </td>
              ))}
            </tr>
            <tr className="bg-blue-50 border-b">
              <td className="sticky left-0 z-40 bg-blue-50 border p-1 font-bold text-blue-600 text-[10px]">已預人數</td>
              {daysInMonth.map(d => {
                const count = getLeaveList(d.day).length;
                return (
                  <td key={d.day} className={`border p-1 font-black text-center text-blue-800 ${isCycleEnd(d.fullDate) ? 'border-r-4 border-r-gray-400' : ''}`}>
                    {count || 0}
                  </td>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {employees.filter(e => !getIsNightClinic(e) && e.role !== '2' && e.role !== '3').map(emp => emp.isSeparator ? <tr key={emp.id} className="bg-gray-200 h-[1.5px]"><td colSpan={daysInMonth.length + 1}></td></tr> : (
              <tr key={emp.id} className="hover:bg-orange-50 border-b group">
                <td className="sticky left-0 z-20 bg-white border p-2 font-black shadow-sm text-center">{emp.name}</td>
                {daysInMonth.map(d => {
                  const sVal = schedule[currentMonth]?.[emp.name]?.[d.day];
                  const isApplied = preLeaveData.apps?.[currentMonth]?.[emp.name]?.[d.day] === "預假";
                  const isFixed = ['休', '公假', '例'].includes(sVal);
                  const isWinner = sVal === '休';
                  const cycleEnd = isCycleEnd(d.fullDate);
                  const canToggle = !isMonthDrawn && !isFixed && (isAdmin || emp.name === currentUser?.name);
                  let bgClass = "bg-white";
                  if (d.rawDay === 0 || d.holiday) bgClass = "bg-[#FFB3D9]";
                  else if (d.rawDay === 6) bgClass = "bg-[#FFB366]";
                  return (
                    <td 
                      key={d.day} 
                      onClick={() => handleToggle(emp.name, d.day)} 
                      className={`border py-4 px-1 min-h-16 transition-all ${bgClass} ${cycleEnd ? 'border-r-4 border-r-gray-400' : ''} ${isApplied || isWinner ? 'ring-2 ring-inset ring-orange-400 shadow-inner' : ''} ${canToggle ? 'cursor-pointer hover:opacity-80' : 'cursor-not-allowed'}`}
                    >
                      <div className="flex flex-col items-center justify-center min-h-[40px]">
                        {isFixed ? <span className="text-gray-500 font-bold opacity-60 text-xs">{sVal}</span> :
                         isWinner ? <span className="text-green-800 font-black text-[13px] bg-green-50 px-1 rounded">休</span> :
                         /* 💡 修正後：只有在『已完成抽籤(isMonthDrawn)』且『沒抽中』時才顯示『預假(未中)』；抽籤前一律顯示原本乾淨的『預假』 */
                         isApplied ? (
                           isMonthDrawn ? (
                             <span className="text-orange-600/70 font-bold text-[10px] bg-orange-50/60 px-1 rounded border border-dashed border-orange-200">預假(未中)</span>
                           ) : (
                             <span className="text-orange-700 font-black text-[11px]">預假</span>
                           )
                         ) : null}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-white border-t-2 shadow-[0_-2px_5px_rgba(0,0,0,0.05)]">
            <tr className="bg-white border-b">
              {/* 💡 修正後：完全拿掉僅供對照提示，100% 回歸妳原本最乾淨的「預假名單」標題 */}
              <td className="sticky left-0 z-40 bg-white border p-1 font-bold text-gray-400 text-[10px]">預假名單</td>
              {daysInMonth.map(d => {
                const list = getLeaveList(d.day);
                return (
                  <td key={d.day} className={`border p-1 align-top h-20 overflow-y-auto bg-blue-50/30 ${isCycleEnd(d.fullDate) ? 'border-r-4 border-r-gray-500' : ''}`}>
                    <div className="flex flex-col gap-0.5">
                      {list.map((name, i) => {
                        const isWinner = schedule[currentMonth]?.[name]?.[d.day] === "休";
                        return (
                          /* 💡 修正後：抽籤前，大家的名字都是原本美麗的藍字白底。抽籤後，沒中的人才會優雅地變成灰字刪除線，對照超直覺！ */
                          <div key={i} className={`text-[9px] font-black text-center leading-none truncate border rounded py-1 shadow-sm ${
                            isWinner 
                              ? 'bg-green-700 text-white border-green-800' 
                              : (isMonthDrawn ? 'bg-white text-gray-400 border-gray-200 line-through decoration-gray-300' : 'bg-white text-blue-500 border-blue-100')
                          }`}>
                            {name}
                          </div>
                        );
                      })}
                    </div>
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
      
      <div className="p-4 border-t bg-gray-50 flex flex-wrap items-center gap-6 shadow-inner relative">
        {isMonthDrawn && (
          <div className="absolute top-[-20px] left-1/2 transform -translate-x-1/2 bg-red-600 text-white px-6 py-1 rounded-t-xl font-black text-xs shadow-lg flex items-center gap-2">
            <Lock size={14}/> 本月已抽籤完畢，功能已鎖定
          </div>
        )}
        <div className="flex items-center gap-2"><Settings size={18} className="text-gray-600"/><span className="text-sm font-black text-gray-700">預假規範</span></div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-gray-200 shadow-sm">
            <span className="text-[11px] font-black text-gray-500">假日名額</span>
            <input 
              type="number" 
              value={preLeaveData.weekendLimit || 10} 
              onChange={e => handleAdminSettingChange('holiday', parseInt(e.target.value) || 0)}
              className="w-10 text-center border-b font-bold outline-none text-blue-600"
              disabled={!isAdmin || isMonthDrawn}
            />
          </div>

          <div className="flex items-center gap-2 bg-white px-3 pay-1.5 rounded-xl border border-gray-200 shadow-sm">
            <span className="text-[11px] font-black text-gray-500">平日名額</span>
            <input 
              type="number" 
              value={preLeaveData.weekdayLimit || 3} 
              onChange={e => handleAdminSettingChange('weekday', parseInt(e.target.value) || 0)}
              className="w-10 text-center border-b font-bold outline-none text-blue-600"
              disabled={!isAdmin || isMonthDrawn}
            />
          </div>

          <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-gray-200 shadow-sm">
            <span className="text-[11px] font-black text-gray-500">抽籤日</span>
            <input 
              type="number" 
              value={preLeaveData.lotteryDay || 15} 
              onChange={e => handleAdminSettingChange('lotteryDay', parseInt(e.target.value) || 1)}
              className="w-10 text-center border-b font-bold outline-none text-blue-600"
              disabled={!isAdmin || isMonthDrawn}
            />
          </div>

          <div className="text-[11px] font-bold text-gray-500 flex items-center gap-2 bg-white px-3 py-2 rounded-xl border border-dashed border-gray-300">
            <Clock size={14} className="text-indigo-200"/> {isMonthDrawn ? "本月已完成抽籤" : `自動抽籤：每月 ${lotteryDay} 號 0:00`}
          </div>

          {!isMonthDrawn && isAdmin && (
            <button onClick={handleLottery} className="flex items-center gap-2 px-6 py-2 bg-red-400 text-white rounded-xl text-xs font-black hover:bg-red-400 shadow-lg shadow-red-200 transition-all active:scale-95">
              <Dice5 size={16}/> 立即手動抽籤
            </button>
          )}

          <button onClick={handleExportPreLeave} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-xs font-bold hover:bg-green-600 shadow transition-all">
            <Download size={14}/> 抽籤結果 CSV 
          </button>
        </div>
      </div>
    </div>
  );
};

const RecordsView = ({ currentUser, swapRequests, onAction, onApprove, setRejectingReq, schedule, currentMonth }) => {
  const [dateRange, setDateRange] = useState({ 
    start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], 
    end: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] 
  });
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, req: null, action: '' });
  const isAdmin = currentUser?.role === '0';

// 💡 補在這邊：安全的時間格式化工具，防止出現 Invalid Date
// 💡 終極相容版：徹底掃描物件中所有可能的時間欄位
  const formatSafeDate = (req) => {
    if (!req) return "未知時間";
    
    // 1. 自動偵測物件中所有可能存放時間的變數名稱（相容各種大小寫與拼法）
    const ts = req.timestamp || 
               req.timeStamp || 
               req.time || 
               req.createdAt || 
               req.date; // 萬一時間被存在 date 欄位
               
    if (!ts) {
      // 2. 防呆：如果第一層沒找到，直接看看 req 物件有沒有內建 toDate 屬性 (Firebase 原生)
      if (typeof req.toDate === 'function') return req.toDate().toLocaleString();
      return "未知時間";
    }

    // 情況 A：如果是數字 (毫秒數，如 Date.now())
    if (typeof ts === 'number') return new Date(ts).toLocaleString();
    
    // 情況 B：如果是 Firebase Timestamp 物件 (含有 seconds 屬性)
    if (typeof ts === 'object' && ts.seconds) {
      return new Date(ts.seconds * 1000).toLocaleString();
    }

    // 情況 C：如果是 Firestore 原生帶有 toDate 函式的物件
    if (typeof ts === 'object' && typeof ts.toDate === 'function') {
      return ts.toDate().toLocaleString();
    }
    
    // 情況 D：如果是常規時間字串 (如 "2026-05-15T14:20:00")
    const parsed = new Date(ts);
    if (!isNaN(parsed.getTime())) return parsed.toLocaleString();
    
    // 情況 E：萬一原本存進去的就是已經格式化好的中文字串 (如 "2026/5/15 下午 9:56:23")
    if (typeof ts === 'string' && ts.trim() !== "") return ts;
    
    return "未知時間";
  };
    
  const pendingList = useMemo(() => {
      return swapRequests.filter(req => {
        // 判斷是否已結案 (過濾掉已核定、否決或撤回的)
        const isClosed = req.status === 'Approved' || req.status === 'Rejected' || req.status === 'Deleted';
        if (isClosed) return false;

        // 判斷我是否為參與者 (包含發起人、被申請人、及參與名單內所有人)
        const isParticipant = 
          req.creatorId === currentUser.id || 
          req.targetId === currentUser.id || 
          (req.participants && req.participants.some(p => p.id === currentUser.id));

        if (isAdmin) {
          // 主管看到的待處理：
          // A. 與自己有關的換班
          // B. 狀態為 'PendingAdmin' (代表同仁簽完了，輪到主管核定)
          return isParticipant || req.status === 'PendingAdmin';
        }

        // 一般同仁看到的待處理：只要跟我有關就顯示
        return isParticipant;
      }).sort((a, b) => a.timestamp - b.timestamp);
    }, [swapRequests, isAdmin, currentUser]);  
    
    const historyList = useMemo(() => {
        return swapRequests.filter(req => {
          // 判斷是否為結案狀態
          const isClosed = req.status === 'Approved' || req.status === 'Rejected' || req.status === 'Deleted';
          if (!isClosed) return false;

          // 判斷日期範圍
          const isInRange = req.date >= dateRange.start && req.date <= dateRange.end;
          if (!isInRange) return false;

          // 判斷權限：主管看全部，同仁只看與自己有關的
          const isParticipant = 
            req.creatorId === currentUser.id || 
            req.targetId === currentUser.id || 
            (req.participants && req.participants.some(p => p.id === currentUser.id));

          return isAdmin || isParticipant;
        }).sort((a, b) => b.timestamp - a.timestamp);
      }, [swapRequests, isAdmin, currentUser, dateRange]);

  const handleDownloadCSV = () => {
    const approved = swapRequests.filter(r => r.status === 'Approved');
    let csv = "\ufeff日期,申請人,申請人原班,對象,對象原班,送出時間,類型\n";
    approved.forEach(r => {
      csv += `${r.isBundle ? r.startDate + '~' + r.endDate : r.date},${r.creatorName},${r.creatorShift},${r.targetName},${r.targetShift},"${new Date(r.timestamp).toLocaleString()}",${r.isBundle ? '整段換班' : '單日換班'}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `核定換班紀錄_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const triggerAction = (req, action) => {
    if (action === 'Reject' || action === 'Delete') {
      setConfirmModal({ isOpen: true, req, action });
    } else {
      onAction(req, action);
    }
  };

  const StatusProgress = ({ req }) => {
    const isRejected = req.status === 'Rejected';
    
    // 💡 邏輯修正：定義各階段是否打勾
    const isStep2Completed = req.status === 'PendingAdmin' || req.status === 'Approved' || (isRejected && !req.adminNote);
    const isStep3Completed = req.status === 'Approved' || (isRejected && req.adminNote);

    const steps = [
      { id: '1', label: '申請人', active: true, color: 'bg-green-500' },
      { 
        id: '2', 
        label: '同仁核定', 
        // 💡 修正：只有當狀態不再是 WaitingParticipants，且不是初始狀態時才打勾
        active: isStep2Completed, 
        color: (isRejected && !req.adminNote) ? 'bg-red-500' : 'bg-green-500' 
      },
      { 
        id: '3', 
        label: '組長核定', 
        active: isStep3Completed, 
        color: (isRejected && req.adminNote) ? 'bg-red-500' : 'bg-green-500' 
      }
    ];

    return (
      <div className="flex items-center gap-1 mt-2">
        {steps.map((s, idx) => (
          <React.Fragment key={s.id}>
            <div className="flex flex-col items-center">
              <div className={`w-3.5 h-3.5 rounded-full ${s.active ? s.color : 'bg-gray-200'} border-2 border-white shadow-sm flex items-center justify-center`}>
                {s.active && <Check size={10} className="text-white"/>}
              </div>
              <span className={`text-[8px] mt-1 font-black ${s.active ? 'text-gray-600' : 'text-gray-300'}`}>{s.label}</span>
            </div>
            {idx < steps.length - 1 && (
              <div className={`h-[1px] w-6 mb-3 ${steps[idx+1].active ? steps[idx+1].color : 'bg-gray-100'}`}></div>
            )}
          </React.Fragment>
        ))}
      </div>
    );
  };

  return (
    <div className="flex-grow bg-gray-50 p-3 sm:p-4 font-sans overflow-auto">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-black text-gray-800 flex items-center gap-2"><ClipboardList className="text-indigo-600"/> 換班與審核紀錄</h2>
          {isAdmin && (
            <button onClick={handleDownloadCSV} className="bg-green-700 text-white px-3 py-1.5 rounded-xl text-xs font-bold shadow hover:bg-green-800 flex items-center gap-1 transition-all">
              <Download size={14}/> 匯出核定紀錄
            </button>
          )}
        </div>

        <section className="space-y-3">
          <h3 className="text-xs font-black text-indigo-400 border-l-4 border-indigo-400 pl-2 uppercase tracking-widest">待處理流程 ({pendingList.length})</h3>
          {pendingList.length === 0 ? <div className="bg-white p-10 rounded-2xl border border-dashed text-center text-gray-300 italic font-bold">目前無待核定資料</div> :
            pendingList.map(req => {
              // 核心修正：不要直接用全域的 currentMonth，要抓取該筆申請資料的月份
              // 假設 req.date 格式為 "2026-05-20"，切割出 "2026-05"
              const reqMonthKey = req.date ? req.date.substring(0, 7) : currentMonth;
              const checkDays = req.isBundle ? req.daysToSwap : [req.day];
              const isShiftMismatched = checkDays.some(d => {
                // 這裡改用 reqMonthKey 確保抓到正確月份的班表資料
                const rawCurTarget = schedule[reqMonthKey]?.[req.targetName]?.[d];
                const normalize = (v) => {
                  const s = (v === null || v === undefined) ? "-" : String(v).trim();
                  return (s === "" || s === "-") ? "-" : s;};
                const curTargetS = normalize(rawCurTarget);
                const storedTargetS = normalize(req.targetShift);
                const clean = (val) => val.replace(/#|\(國\)/g, '');
                return clean(curTargetS) !== clean(storedTargetS);
          });

              // 找到 pendingList.map(req => { ... return ( ... ) }) 裡面的 return 部分
              return (
                <div key={req.id} className="bg-white p-5 rounded-3xl shadow-sm border border-l-8 border-l-indigo-400 space-y-4">
                  {/* 標題與時間 */}
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-indigo-600 text-lg">{req.isBundle ? `${req.startDate}~${req.endDate}` : req.date}</span>
                      {req.isBundle && <span className="text-[10px] bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-lg font-black uppercase">整段</span>}
                    </div>
                  <span className="text-[10px] text-gray-400 font-bold bg-gray-50 px-2 py-1 rounded-lg">🕒 {formatSafeDate(req)}</span>
                  </div>

                  {/* 核心修正：多人連鎖明細區 (對應需求 4) */}
                  <div className="bg-indigo-50/50 p-4 rounded-2xl border border-indigo-100/50 space-y-3">
                    <div className="text-[11px] font-black text-indigo-800 flex items-center gap-1 opacity-70 uppercase tracking-widest">
                      <ArrowLeftRight size={12} /> 參與同仁與班別更動：
                    </div>
                    
                    <div className="grid grid-cols-1 gap-2">
                      {/* 如果有 participants 陣列就跑迴圈，沒有就顯示原本的 A ⇄ B (相容舊資料) */}
                      {req.participants ? (
                        req.participants.map((p, idx) => {
                          const nextP = req.participants[(idx + 1) % req.participants.length];
                          
                          // 💡 邏輯新增：判斷簽核狀態
                          // 發起人 (creatorId) 不需要簽核，其他人的狀態從 req.approvals 找
                          const isCreator = p.id === req.creatorId;
                          const approval = req.approvals?.find(a => a.id === p.id);
                          
                          return (
                            <div key={idx} className="flex items-center justify-between bg-white px-3 py-2.5 rounded-xl shadow-sm border border-indigo-100/30">
                              <div className="flex items-center gap-2">
                                <span className="w-5 h-5 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-[10px] font-black">{idx + 1}</span>
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-black text-sm text-gray-700">{p.name}</span>
                                    
                                    {/* 💡 狀態圖示：讓大家知道誰還沒簽 */}
                                    {isCreator ? (
                                      <span className="text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-md font-bold italic">發起</span>
                                    ) : (
                                      approval?.status === 'Approved' ? (
                                        <CheckCircle2 size={14} className="text-green-500" />
                                      ) : (
                                        <Clock size={14} className="text-amber-500 animate-pulse" />
                                      )
                                    )}
                                  </div>
                                </div>
                              </div>
                              
                              {/* 原有換班資訊留存 */}
                              <div className="flex items-center gap-2">
                                <span className="text-gray-400 text-xs font-bold">({p.oldShift})</span>
                                <span className="text-indigo-400 text-xs">→</span>
                                <span className="text-indigo-700 font-black text-xs bg-indigo-50 px-2 py-1 rounded-lg shadow-inner">
                                  ({nextP.oldShift})
                                </span>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        /* 原有舊資料相容邏輯留存 */
                        <div className="flex items-center justify-between bg-white px-3 py-2.5 rounded-xl shadow-sm">
                          <span className="font-black text-sm">{req.creatorName} ⇄ {req.targetName}</span>
                          <span className="text-xs text-indigo-600 font-bold">({req.creatorShift} ⇄ {req.targetShift})</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 進度條與按鈕 (這部分維持您原本的邏輯，但版面稍微優化) */}
                  <div className="flex flex-col sm:flex-row justify-between items-end sm:items-center gap-4 pt-2 border-t border-gray-50">
                    <StatusProgress req={req}/>
                    
                    {/* 💡 修改點：這是位於 RecordsView 內部的操作按鈕區塊 */}
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-dashed border-gray-100 w-full">
                    
                    {/* 情況 A：參與者操作 (同仁簽核) */}
                    {req.status === 'WaitingParticipants' && 
                    req.participants?.some(p => p.id === currentUser.id) && 
                    req.creatorId !== currentUser.id &&
                    req.approvals?.find(a => a.id === currentUser.id)?.status === 'Pending' && (
                      <div className="flex flex-row flex-wrap gap-2 w-full">
                        <button
                          onClick={() => onApprove(req.id)}
                          className="flex-1 min-w-[120px] py-2 px-3 bg-green-500 text-white rounded-xl font-black text-xs md:text-sm shadow-md hover:bg-green-600 transition-all flex items-center justify-center gap-1.5 whitespace-nowrap"
                        >
                          <CheckCircle2 size={14} /> 核定換班
                        </button>
                        
                        <button
                          onClick={() => triggerAction(req, 'Reject')} 
                          className="flex-1 min-w-[80px] py-2 px-3 bg-rose-50 text-rose-600 border border-rose-100 rounded-xl font-black text-xs md:text-sm hover:bg-rose-100 transition-all flex items-center justify-center gap-1.5 whitespace-nowrap"
                        >
                          <ShieldAlert size={14} /> 否決
                        </button>
                      </div>
                    )}

                    {/* 情況 B：發起人撤回 */}
                    {req.creatorId === currentUser.id && (req.status === 'WaitingParticipants' || req.status === 'PendingAdmin') && (
                      <button
                        onClick={() => triggerAction(req, 'Delete')}
                        className="w-full py-2 px-3 bg-gray-100 text-gray-500 rounded-xl font-black text-xs md:text-sm hover:bg-gray-200 transition-all flex items-center justify-center gap-1.5 whitespace-nowrap"
                      >
                        <Undo2 size={14} /> 撤回申請
                      </button>
                    )}

                    {/* 情況 C：管理員(組長)核定 */}
                    {isAdmin && req.status === 'PendingAdmin' && (
                      <div className="flex flex-row flex-wrap gap-2 w-full">
                        <button
                          onClick={() => onAction(req, 'Approve')} 
                          className="flex-1 min-w-[120px] py-2 px-3 bg-indigo-600 text-white rounded-xl font-black text-xs md:text-sm shadow-md hover:bg-indigo-700 transition-all flex items-center justify-center gap-1.5 whitespace-nowrap"
                        >
                          <ShieldCheck size={14} /> 組長核定
                        </button>
                        <button
                          onClick={() => setRejectingReq(req)}
                          className="flex-1 min-w-[80px] py-2 px-3 bg-rose-50 text-rose-600 border border-rose-100 rounded-xl font-black text-xs md:text-sm hover:bg-rose-100 transition-all flex items-center justify-center gap-1.5 whitespace-nowrap"
                        >
                          <ShieldAlert size={14} /> 否決
                        </button>
                      </div>
                    )}
                  </div>
                  </div>

                  {/* 班別失效警示 */}
                  {isShiftMismatched && (
                    <div className="mt-2 text-[10px] bg-red-50 text-red-600 p-3 rounded-2xl font-black border border-red-100 flex items-center gap-2 animate-pulse">
                      <AlertCircle size={16}/> 警告：系統偵測到原始班別已更動，請再次確認！
                    </div>
                  )}
                </div>
              );
            })}
        </section>

        <section className="space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="text-xs font-black text-gray-400 border-l-4 border-gray-300 pl-2 uppercase tracking-widest">歷史紀錄</h3>
            <div className="flex items-center gap-1 bg-white p-1 rounded-xl border text-[10px] font-bold">
              <input type="date" value={dateRange.start} onChange={e=>setDateRange({...dateRange, start:e.target.value})} className="border-0 outline-none p-1 text-gray-400 bg-transparent"/>
              <span className="text-gray-300 px-1">~</span>
              <input type="date" value={dateRange.end} onChange={e=>setDateRange({...dateRange, end:e.target.value})} className="border-0 outline-none p-1 text-gray-400 bg-transparent"/>
            </div>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-gray-50 border-b text-[10px] text-gray-400 font-black uppercase tracking-tighter">
                  <tr><th className="p-4">對象日期</th><th className="p-4">人員與對話</th><th className="p-4 text-center">狀態</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {historyList.map(req => (
                    <tr key={req.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="p-4">
                        <div className="font-black text-gray-700">{req.isBundle ? `${req.startDate}~${req.endDate}` : req.date}</div>
                        <div className="text-[9px] text-gray-400">申請: {formatSafeDate(req).includes(' ') ? formatSafeDate(req).split(' ')[0] : formatSafeDate(req)}</div>
                      </td>
                      <td className="p-4 font-bold text-gray-700">
                        {req.participants ? (
                          <div className="flex flex-col gap-0.5">
                            <div className="text-blue-700">
                              {/* 需求 4：顯示所有參與者的路徑 */}
                              {req.participants.map(p => p.name).join(' → ')}
                            </div>
                            <div className="text-[10px] text-gray-400 font-normal">
                              {/* 顯示詳細班別變動 */}
                              {req.participants.map((p, idx) => {
                                const nextP = req.participants[(idx + 1) % req.participants.length];
                                return `${p.name}(${p.oldShift}→${nextP.oldShift})`;
                              }).join(', ')}
                            </div>
                          </div>
                        ) : (
                          // 相容舊有的兩位人員換班資料
                          `${req.creatorName}(${req.creatorShift}) ⇄ ${req.targetName}(${req.targetShift})`
                        )}
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-black shadow-sm ${req.status==='Approved'?'bg-green-100 text-green-600':req.status==='Rejected'?'bg-red-50 text-red-600':'bg-gray-100 text-gray-400'}`}>
                            {req.status==='Approved'?'已完成':req.status==='Rejected'?'已否決':'已撤回'}
                          </span>
                          
                          {/* 💡 新增：若有否決原因，顯示極簡點擊展開查看 */}
                          {req.status === 'Rejected' && req.adminNote && (
                            <details className="text-[10px] text-left max-w-[150px] cursor-pointer mt-1">
                              <summary className="text-gray-400 font-bold hover:text-red-500 transition-colors select-none">查看原因</summary>
                              <div className="bg-red-50 text-red-700 p-2 rounded-lg mt-1 border border-red-100 font-medium break-words leading-tight">
                                {req.adminNote}
                              </div>
                            </details>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      <Modal 
        isOpen={confirmModal.isOpen} 
        onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })}
        onConfirm={() => { onAction(confirmModal.req, confirmModal.action); setConfirmModal({ isOpen: false, req: null, action: '' }); }}
        title={confirmModal.action === 'Reject' ? "確定否決換班？" : "確定撤回申請？"}
        message={confirmModal.action === 'Reject' ? "否決後該申請將失效，對象同仁需重新發起。" : "撤回後該紀錄將從待核定名單中移除。"}
      />
    </div>
  );
};

const AccountManagementView = ({ employees, setEmployees, setDeleteTarget }) => {
  const [formData, setFormData] = useState({ id: '', name: '', role: '1', labor: 'N', password: '' });
  const [editingId, setEditingId] = useState(null);
  const [draggedIdx, setDraggedIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const importRef = useRef(null);

  const getRoleLabel = (role) => {
    const map = { '0': '管理員', '1': '一般藥師', '2': '書記', '3': '藥庫藥師' };
    return map[role] || '一般藥師';
  };

  const onDrop = (targetIdx) => {
    if (draggedIdx === null) return;
    const next = [...employees];
    const item = next.splice(draggedIdx, 1)[0];
    next.splice(targetIdx, 0, item);
    setEmployees(next);
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  const handleExport = () => {
    let csv = "\ufeff員編,姓名,角色(0:管理1:藥師2:書記3:藥庫),適用勞基法(Y/N),密碼\n";
    employees.filter(e => !e.isSeparator).forEach(emp => {
      csv += `${emp.id},${emp.name},${emp.role},${emp.labor},${emp.password || ''}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `藥劑部人員名冊.csv`;
    link.click();
  };

const handleImport = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const rows = ev.target.result.split(/\r?\n/).map(r => r.trim()).filter(Boolean).slice(1);
    
    let addedCount = 0;
    let existingIds = new Set(employees.map(emp => emp.id)); // 先取得目前所有員編
    let nextEmployees = [...employees];

    rows.forEach(r => {
      const [id, name, role, labor, pwd] = r.split(',');
      if (id && name && !existingIds.has(id)) {
        const isNC = (id === "E1" || id === "E2" || id === "E3" || name.includes("夜診"));
        nextEmployees.push({ id, name, role: role || '1', labor: labor || 'N', password: pwd || "", isNightClinic: isNC });
        existingIds.add(id); // 避免同一份 CSV 內有重複
        addedCount++;
      }
    });

    if (addedCount > 0) { 
      setEmployees(nextEmployees); 
      alert(`匯入完成！共新增 ${addedCount} 名新員工，已重複的員編已自動忽略。`); 
    } else {
      alert("匯入檔案中沒有新的人員資料。");
    }
  };
  reader.readAsText(file);
};

  return (
    <div className="p-4 max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 font-sans">
      <div className="lg:col-span-4 bg-white p-5 rounded-3xl shadow border h-fit">
        <h2 className="text-lg font-black mb-4 flex items-center gap-2 text-gray-800"><UserCog size={20}/> 人員管理</h2>
        <form className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          if (editingId) {setEmployees(employees.map(emp => emp.id === editingId ? formData : emp));setEditingId(null);
          } else {
          const isDuplicate = employees.some(emp => emp.id === formData.id);

          if (isDuplicate) {alert("該員編已存在，系統已自動忽略。"); 
        } else {setEmployees([...employees, formData]);alert("成功新增 1 名員工。");
      }
    }
          setFormData({id: '', name: '', role: '1', labor: 'N', password: ''});
        }}>
          <div className="grid grid-cols-2 gap-2">
            <input className="border p-2 rounded-xl text-sm font-mono outline-none" placeholder="員編" value={formData.id} onChange={e => setFormData({...formData, id: e.target.value})} disabled={!!editingId} />
            <input className="border p-2 rounded-xl text-sm outline-none font-bold" placeholder="姓名" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
          </div>
          <div className="grid grid-cols-1 gap-2">
            <select className="border p-2 rounded-xl text-sm bg-white font-bold" value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})}>
              <option value="0">管理員 (0)</option>
              <option value="1">一般藥師 (1)</option>
              <option value="2">書記 (2)</option>
              <option value="3">藥庫藥師 (3)</option>
            </select>
          </div>
          <div className="grid grid-cols-1">
            <select className="border p-2 rounded-xl text-sm bg-white font-bold" value={formData.labor} onChange={e => setFormData({...formData, labor: e.target.value})}>
              <option value="Y">適用勞基法 (Y)</option>
              <option value="N">不適用勞基法 (N)</option>
            </select>
          </div>
          <input className="w-full border p-2 rounded-xl text-sm outline-none font-mono" placeholder="初始密碼/備註" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} />
          <button className={`w-full py-2 rounded-xl text-white font-bold shadow transition-all ${editingId ? 'bg-orange-500' : 'bg-blue-600'}`}>{editingId ? '更新帳號' : '新增帳號'}</button>
          <hr className="my-2" />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => importRef.current.click()} className="py-2 border rounded-xl text-xs font-black hover:bg-gray-50 flex items-center justify-center gap-1"><Upload size={14}/> 匯入名冊</button>
            <input type="file" ref={importRef} className="hidden" accept=".csv" onChange={handleImport} />
            <button type="button" onClick={handleExport} className="py-2 border rounded-xl text-xs font-black hover:bg-gray-50 flex items-center justify-center gap-1"><Download size={14}/> 匯出名冊</button>
          </div>
          <button type="button" onClick={() => setEmployees([...employees, { id: `SEP-${Date.now()}`, isSeparator: true }])} className="w-full mt-2 py-2 border-2 border-dashed rounded-xl text-[10px] font-black text-gray-400 hover:bg-gray-50 transition-all">插入分組分隔線</button>
        </form>
      </div>
      <div className="lg:col-span-8 bg-white rounded-3xl shadow border flex flex-col h-[650px]"> 
        <div className="flex-1 overflow-y-auto"> {/* 💡 這是讓內容可以捲動的關鍵 */}
          <table className="w-full text-sm border-collapse">
          <thead className="bg-gray-50 border-b text-[10px] font-black uppercase text-gray-400 sticky top-0 z-10">
            <tr>
              <th className="p-4 w-10 bg-gray-50"></th>
              <th className="p-4 text-left bg-gray-50">員編</th>
              <th className="p-4 text-left bg-gray-50">姓名</th>
              <th className="p-4 text-left bg-gray-50">角色</th>
              <th className="p-4 text-right bg-gray-50">操作</th>
            </tr>
          </thead>
            <tbody>
              {employees.map((emp, idx) => (
                <tr 
                  key={emp.id} 
                  draggable 
                  onDragStart={() => setDraggedIdx(idx)} 
                  onDragOver={e => { e.preventDefault(); setDragOverIdx(idx); }} 
                  onDrop={() => onDrop(idx)} 
                  className={`transition-all border-b last:border-0 group cursor-move ${emp.isSeparator ? 'bg-gray-100 h-[4px]' : 'hover:bg-blue-50'} ${dragOverIdx === idx ? 'border-t-4 border-t-blue-400' : ''}`}
                >
                  <td className="p-4 text-gray-300 group-hover:text-blue-500"><GripVertical size={16}/></td>
                  {emp.isSeparator ? <td colSpan={3} className="p-4 italic text-[10px] text-gray-400">分組線</td> : (
                    <>
                      <td className="p-4 font-mono text-xs">{emp.id}</td>
                      <td className="p-4 font-bold">{emp.name}</td>
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${emp.role === '0' ? 'bg-purple-100 text-purple-600' : emp.role === '1' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
                          {getRoleLabel(emp.role)}
                        </span>
                      </td>
                    </>
                  )}
                  <td className="p-4 text-right">
                    {!emp.isSeparator && <button onClick={() => { setEditingId(emp.id); setFormData(emp); }} className="text-blue-500 text-xs font-black mr-4">編輯</button>}
                    <button onClick={() => setDeleteTarget(emp)} className="text-red-400 hover:text-red-600 transition-all"><Trash2 size={16}/></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* 表格底部固定顯示統計 */}
        <div className="p-3 bg-gray-50 border-t text-[10px] font-black text-gray-400 text-center rounded-b-3xl">
          總計：{employees.filter(e => !e.isSeparator).length} 位人員
        </div>
      </div>
    </div>
  );
};

const ShiftsManagementView = ({ shifts, setShifts, holidays, setHolidays, setDeleteShiftTarget, personDayRules, setPersonDayRules }) => {
  const [formData, setFormData] = useState({ name: '', code: '', isRegular: 'N', regularDays: [] });
  const [editingId, setEditingId] = useState(null);
  const [ruleFormData, setRuleFormData] = useState({ pattern: '', value: '0.5', mode: 'exact' });
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [deleteRuleTarget, setDeleteRuleTarget] = useState(null); 
  const shiftImportRef = useRef(null);
  const ruleImportRef = useRef(null);

  const toggleDay = (day) => {
    const next = formData.regularDays.includes(day) 
      ? formData.regularDays.filter(d => d !== day) 
      : [...formData.regularDays, day];
    setFormData({ ...formData, regularDays: next });
  };

  const handleExportShifts = () => {
    let csv = "\ufeff縮寫,代碼,常態班(Y/N),常態日期(逗號隔開)\n";
    shifts.forEach(s => {
      if (!s.isSeparator) {
        csv += `${s.name},${s.code},${s.isRegular},"${s.regularDays.join(',')}"\n`;
      }
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `班別代碼清單.csv`;
    link.click();
  };

  const handleImportShifts = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const rows = ev.target.result.split(/\r?\n/).map(r => r.trim()).filter(Boolean).slice(1);
      const next = rows.map(r => {
        const parts = r.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/); 
        if (parts.length >= 2) {
          const name = parts[0].replace(/^"|"$/g, '');
          const code = parts[1].replace(/^"|"$/g, '');
          const isReg = parts[2] ? parts[2].replace(/^"|"$/g, '') : 'N';
          const daysStr = parts[3] ? parts[3].replace(/^"|"$/g, '') : '';
          return { id: `S-${Date.now()}-${Math.random()}`, name, code, isRegular: isReg, regularDays: daysStr ? daysStr.split(',') : [] };
        }
        return null;
      }).filter(Boolean);
      if (next.length > 0) { setShifts(next); alert(`匯入完成，已載入 ${next.length} 個班別。`); }
    };
    reader.readAsText(file); e.target.value = '';
  };

  const handleExportRules = () => {
    let csv = "\ufeff模式(exact/suffix),對照關鍵字,人日數\n";
    personDayRules.forEach(r => {
      csv += `${r.mode},${r.pattern},${r.value}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `人日數對照規則.csv`;
    link.click();
  };

  const handleImportRules = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const rows = ev.target.result.split(/\r?\n/).map(r => r.trim()).filter(Boolean).slice(1);
      const next = rows.map((r, i) => {
        const [mode, pattern, value] = r.split(',');
        if (mode && pattern) return { id: Date.now() + i, mode, pattern, value: value || '0.5' };
        return null;
      }).filter(Boolean);
      if (next.length > 0) { setPersonDayRules(next); alert(`匯入成功，已載入 ${next.length} 筆規則。`); }
    };
    reader.readAsText(file); e.target.value = '';
  };

  const handleRuleSubmit = (e) => {
    e.preventDefault();
    if (!ruleFormData.pattern) return;
    if (editingRuleId) {
      setPersonDayRules(personDayRules.map(r => r.id === editingRuleId ? { ...ruleFormData, id: editingRuleId } : r));
    } else {
      setPersonDayRules([...personDayRules, { ...ruleFormData, id: Date.now() }]);
    }
    setEditingRuleId(null);
    setRuleFormData({ pattern: '', value: '0.5', mode: 'exact' });
  };

  return (
      // 💡 調整最外層容器：加入自適應最大寬度與精緻的外距排版
      <div className="p-4 max-w-full lg:max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6 font-sans text-sm items-start">
        
        {/* 區塊 1：班別代碼管理 (左側獨立區塊) */}
        <div className="bg-white p-5 md:p-6 rounded-3xl shadow border flex flex-col h-auto min-h-[400px] max-h-[85vh]">
          <h2 className="text-lg font-black mb-4 text-gray-800 flex items-center gap-2">
            <CalendarRange size={20}/> 班別代碼管理
          </h2>
          
          <form className="bg-gray-50 p-4 rounded-2xl border mb-5 space-y-4 shadow-inner" onSubmit={(e) => {
            e.preventDefault();
            if (editingId) setShifts(shifts.map(s => s.id === editingId ? { ...formData, id: editingId } : s));
            else setShifts([...shifts, { ...formData, id: Date.now() }]);
            setEditingId(null); setFormData({ name: '', code: '', isRegular: 'N', regularDays: [] });
          }}>
            <div className="grid grid-cols-3 gap-2">
              <input className="border p-2 rounded-xl text-sm outline-none font-bold" placeholder="縮寫" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
              <input className="border p-2 rounded-xl text-sm outline-none font-mono" placeholder="代碼" value={formData.code} onChange={e => setFormData({ ...formData, code: e.target.value })} />
              <select className="border p-2 rounded-xl text-sm bg-white font-bold" value={formData.isRegular} onChange={e => setFormData({ ...formData, isRegular: e.target.value })}>
                <option value="Y">常態班</option><option value="N">非常態</option>
              </select>
            </div>
            {formData.isRegular === 'Y' && (
              <div className="flex flex-wrap gap-1.5 p-2 bg-white rounded-xl border border-dashed">
                {[...WEEKDAYS_MAP, "國", "月"].map(day => (
                  <button key={day} type="button" onClick={() => toggleDay(day)} className={`px-2 py-1 rounded-lg text-[10px] font-black transition-all ${formData.regularDays.includes(day) ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}>{day}</button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button className={`py-2 rounded-xl text-white font-bold shadow transition-all ${editingId ? 'bg-orange-500' : 'bg-blue-600 hover:bg-blue-700'}`}>{editingId ? '更新班別' : '新增班別'}</button>
              <div className="flex gap-1">
                <button type="button" onClick={() => shiftImportRef.current.click()} className="flex-1 bg-gray-100 text-gray-600 py-2 rounded-xl font-bold flex items-center justify-center gap-1 hover:bg-gray-200"><Upload size={14}/> 匯入</button>
                <button type="button" onClick={handleExportShifts} className="flex-1 bg-gray-100 text-gray-600 py-2 rounded-xl font-bold flex items-center justify-center gap-1 hover:bg-gray-200"><Download size={14}/> 匯出</button>
                <input type="file" ref={shiftImportRef} className="hidden" accept=".csv" onChange={handleImportShifts} />
              </div>
            </div>
          </form>

          {/* 💡 修正點：自適應滾動表格高度，隨內容多寡自動長高，最多不超過視窗的 45%，不會沈到底部 */}
          <div className="flex-1 overflow-y-auto min-h-[150px] max-h-[45vh] rounded-xl border border-gray-100">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-gray-50 border-b sticky top-0 z-10 font-black text-gray-400 uppercase tracking-tighter shadow-sm">
                <tr><th className="p-3 bg-gray-50">縮寫</th><th className="p-3 bg-gray-50">代碼</th><th className="p-3 bg-gray-50">常態規則</th><th className="p-3 bg-gray-50 text-right">操作</th></tr>
              </thead>
              <tbody className="divide-y">
                {shifts.map(s => !s.isSeparator && (
                  <tr key={s.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="p-3 font-black text-gray-700">{s.name}</td><td className="p-3 font-mono text-gray-400">{s.code}</td>
                    <td className="p-3"><span className="text-[10px] bg-gray-100 px-2 py-0.5 rounded-full font-bold text-gray-500">{s.isRegular === 'Y' ? s.regularDays.join(',') : '無'}</span></td>
                    <td className="p-3 text-right"><button onClick={() => { setEditingId(s.id); setFormData(s); }} className="text-blue-500 mr-2 text-xs font-black">編輯</button><button onClick={() => setDeleteShiftTarget(s)} className="text-red-300 hover:text-red-500"><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 右側欄位：國定假日 + 人日數 (右側垂直堆疊區塊) */}
        <div className="space-y-6 w-full flex flex-col justify-start">
          
          {/* 區塊 2：國定假日管理 */}
          <div className="bg-white p-5 md:p-6 rounded-3xl shadow border h-auto flex flex-col max-h-[45vh]">
            <h2 className="text-lg font-black mb-4 text-pink-600 flex items-center gap-2">
              <CalendarIcon size={18}/> 國定假日管理
            </h2>
            <div className="flex gap-2 mb-4">
              <input type="date" className="flex-grow border-2 p-2 rounded-xl text-sm outline-none focus:border-pink-300 bg-white" id="h_date" />
              <input type="text" className="flex-grow border-2 p-2 rounded-xl text-sm outline-none font-bold" placeholder="假日備註" id="h_note" />
              <button onClick={() => { const d = document.getElementById('h_date').value, n = document.getElementById('h_note').value; if (d && n) setHolidays({ ...holidays, [d]: n }); }} className="bg-pink-600 text-white px-4 py-2 rounded-xl font-bold shadow hover:bg-pink-700 active:scale-95 transition-all whitespace-nowrap">新增</button>
            </div>
            
            {/* 💡 修正點：改為自適應高度，可滑動 */}
            <div className="flex-1 overflow-y-auto min-h-[100px] rounded-xl border border-pink-100">
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-pink-50 border-b sticky top-0 z-10 text-[10px] text-pink-700 font-black uppercase tracking-tighter shadow-sm">
                  <tr><th className="p-3 bg-pink-50">日期</th><th className="p-3 bg-pink-50">備註</th><th className="p-3 bg-pink-50 text-right">操作</th></tr>
                </thead>
                <tbody className="divide-y divide-pink-50">
                  {Object.keys(holidays).sort().map(date => (
                    <tr key={date} className="hover:bg-pink-50/30 transition-colors">
                      <td className="p-3 font-mono text-gray-500">{date}</td>
                      <td className="p-3 font-black text-gray-700">{holidays[date]}</td>
                      <td className="p-3 text-right">
                        <button onClick={() => { const next = { ...holidays }; delete next[date]; setHolidays(next); }} className="text-red-300 hover:text-red-600 transition-all">
                          <Trash2 size={14}/>
                        </button>
                      </td>
                    </tr>
                  ))}
                  {Object.keys(holidays).length === 0 && (
                    <tr><td colSpan="3" className="p-10 text-center text-gray-300 font-bold italic bg-white">尚無假日設定</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 區塊 3：人日數設定區塊 */}
          <div className="bg-white p-5 md:p-6 rounded-3xl shadow border h-auto flex flex-col max-h-[50vh] relative">
            <div className="flex flex-wrap justify-between items-center gap-2 mb-4">
              <h2 className="text-lg font-black text-teal-600 flex items-center gap-2"><TrendingUp size={18}/> 人日數設定區塊</h2>
              <div className="flex gap-1">
                <button onClick={() => ruleImportRef.current.click()} className="text-[10px] bg-gray-100 text-gray-600 px-2 py-1 rounded font-bold hover:bg-gray-200 transition-colors flex items-center gap-1"><Upload size={10}/> 匯入規則</button>
                <button onClick={handleExportRules} className="text-[10px] bg-gray-100 text-gray-600 px-2 py-1 rounded font-bold hover:bg-gray-200 transition-colors flex items-center gap-1"><Download size={10}/> 匯出規則</button>
                <input type="file" ref={ruleImportRef} className="hidden" accept=".csv" onChange={handleImportRules} />
              </div>
            </div>
            
            <form className="bg-gray-50 p-4 rounded-2xl border mb-4 space-y-4 shadow-inner" onSubmit={handleRuleSubmit}>
              <div className="grid grid-cols-3 gap-2">
                <input className="border p-2 rounded-xl text-sm font-bold outline-none" placeholder="對照關鍵字/班別" value={ruleFormData.pattern} onChange={e => setRuleFormData({ ...ruleFormData, pattern: e.target.value })} />
                <select className="border p-2 rounded-xl text-sm bg-white font-bold" value={ruleFormData.value} onChange={e => setRuleFormData({ ...ruleFormData, value: e.target.value })}>
                  <option value="0">0 人日</option>
                  <option value="0.5">0.5 人日</option>
                  <option value="1">1.0 人日</option>
                </select>
                <select className="border p-2 rounded-xl text-sm bg-white font-bold" value={ruleFormData.mode} onChange={e => setRuleFormData({ ...ruleFormData, mode: e.target.value })}>
                  <option value="exact">完全相同</option>
                  <option value="suffix">後綴包含</option>
                </select>
              </div>
              <button className={`w-full py-2 rounded-xl text-white font-bold shadow transition-all ${editingRuleId ? 'bg-orange-500' : 'bg-teal-600 hover:bg-teal-700'}`}>{editingRuleId ? '規則更新' : '新增對照規則'}</button>
            </form>
            
            {/* 💡 修正點：改為自適應高度，可滑動 */}
            <div className="flex-1 overflow-y-auto min-h-[100px] rounded-xl border border-teal-100">
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-teal-50 border-b sticky top-0 z-10 text-[10px] text-teal-700 font-black uppercase tracking-tighter shadow-sm">
                  <tr><th className="p-3 bg-teal-50">模式</th><th className="p-3 bg-teal-50">對照關鍵字</th><th className="p-3 bg-teal-50">對應值</th><th className="p-3 bg-teal-50 text-right">操作</th></tr>
                </thead>
                <tbody className="divide-y divide-teal-50">
                  {personDayRules.map(rule => (
                    <tr key={rule.id} className="hover:bg-teal-50/30 transition-colors">
                      <td className="p-3 text-[10px] text-gray-400">{rule.mode === 'exact' ? '完全相同' : '後綴包含'}</td>
                      <td className="p-3 font-black text-gray-700">{rule.pattern}</td>
                      <td className="p-3 font-mono text-teal-600 font-black">{rule.value}</td>
                      <td className="p-3 text-right">
                        <button onClick={() => { setEditingRuleId(rule.id); setRuleFormData(rule); }} className="text-blue-500 mr-2 text-xs font-black">編輯</button>
                        <button onClick={() => setDeleteRuleTarget(rule)} className="text-red-300 hover:text-red-600 transition-all"><Trash2 size={14}/></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Modal 
              isOpen={!!deleteRuleTarget} 
              onClose={() => setDeleteRuleTarget(null)} 
              onConfirm={() => { setPersonDayRules(personDayRules.filter(r => r.id !== deleteRuleTarget.id)); setDeleteRuleTarget(null); }} 
              title="確定刪除班別？" 
              message={`確定刪除班別？移除 ${deleteRuleTarget?.pattern} 將影響人日數計算。`} 
            />
          </div>
        </div>

      </div>
  );
  };

const ManagementReportView = ({ currentMonth, employees, schedule, personDayRules, holidays, shifts }) => {
  const [reportType, setReportType] = useState('personDays'); 
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });

  const isFourWeekMode = reportType === 'shiftCode';
  const isNightFeeMode = reportType === 'nightFee';

  const hasSupportData = useMemo(() => {
    const supportRow = schedule[currentMonth]?.["夜診支援"] || {};
    return Object.values(supportRow).some(v => v && !["-", "#", "例", ""].includes(v.toString().trim()));
  }, [schedule, currentMonth]);

  const reportDays = useMemo(() => {
    if (!isFourWeekMode) {
      const [year, month] = currentMonth.split('-').map(Number);
      const date = new Date(year, month, 0);
      const days = [];
      for (let i = 1; i <= date.getDate(); i++) {
        const d = new Date(year, month - 1, i);
        const fullDate = `${currentMonth}-${String(i).padStart(2, '0')}`;
        days.push({ day: i, dayOfWeek: WEEKDAYS_MAP[d.getDay()], rawDay: d.getDay(), holiday: holidays[fullDate] || "", fullDate });
      }
      return days;
    } else {
      const days = [];
      const start = new Date(startDate);
      for (let i = 0; i < 28; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dayNum = d.getDate();
        const fullDate = `${y}-${m}-${String(dayNum).padStart(2, '0')}`;
        days.push({ day: dayNum, dayOfWeek: WEEKDAYS_MAP[d.getDay()], rawDay: d.getDay(), holiday: holidays[fullDate] || "", fullDate, monthKey: `${y}-${m}` });
      }
      return days;
    }
  }, [currentMonth, startDate, isFourWeekMode, holidays]);

// =======================================================================
  // 👑 修正版 1：優化代碼轉換，將「#」、「例」、「休」通通精確對齊為代碼 "0"
  // =======================================================================
  const calculateCellValue = (emp, dayInfo) => {
    const mKey = isFourWeekMode ? dayInfo.monthKey : currentMonth;
    let rawVal = schedule[mKey]?.[emp.name]?.[dayInfo.day];
    
    if (!rawVal || rawVal === "" || rawVal === undefined) {
      if (dayInfo.rawDay === 0 || dayInfo.holiday) rawVal = "例";
      else if (dayInfo.rawDay === 6) rawVal = "#";
      else rawVal = "-";
    }

    const rawStr = rawVal.toString().trim();

    if (reportType === 'shiftCode') {
      const baseShiftName = rawStr.split('/')[0];
      const shiftObj = (shifts || []).find(s => s.name === baseShiftName);
      // 🔥 修正點：不只 "#" 算 "0"，自動填補或手動輸入的 "例"、"休" 也必須是代碼 "0"
      const codeVal = shiftObj ? shiftObj.code : (["#", "例", "休"].includes(baseShiftName) ? "0" : (baseShiftName === "-" ? "1" : baseShiftName));
      return { display: codeVal, numeric: 0 };
    }

    if (reportType === 'nightFee') {
      const isSymbol = ["-", "#", "例"].includes(rawStr);
      if (getIsNightClinic(emp)) {
        return { display: isSymbol ? "" : rawStr, numeric: 0 };
      }
      const hasPA = rawStr.includes('P') || rawStr.includes('A');
      return { display: (hasPA && !isSymbol) ? rawStr : "", numeric: 0 };
    }

    if (rawStr === "-" || rawStr === "#" || rawStr === "例") return { display: rawStr, numeric: 0 };

    if (reportType === 'personDays') {
      if (emp.role === '2' || getIsNightClinic(emp)) return { display: "0", numeric: 0 };
      const rule = personDayRules.find(r => 
        r.mode === 'exact' ? rawStr === r.pattern.trim() : rawStr.endsWith(r.pattern.trim())
      );
      const val = rule ? parseFloat(rule.value) : 1;
      return { display: val.toString(), numeric: val };
    }

    return { display: rawStr, numeric: 0 };
  };

  // =======================================================================
  // 👑 修正版 2：滿血獨立檢核邏輯，完美跟隨起始日期變動，且切換分頁絕不卡死
  // =======================================================================
  const checkLaborCompliance = (emp, days) => {
    if (!isFourWeekMode) return true;
    
    // 這裡的 days 就是隨著起始日期變動的 28 天，精確切成兩個 14 天區塊
    const blocks = [days.slice(0, 14), days.slice(14, 28)];
    
    for (const block of blocks) {
      // 💡 關鍵修正：建立完全獨立的真實代碼提取，不受當前頁面切換到「人日數」或「夜班費」的干擾！
      const codes = block.map(d => {
        const mKey = d.monthKey || currentMonth;
        let rawVal = schedule[mKey]?.[emp.name]?.[d.day];
        
        // 100% 模擬排班表當天的預設值
        if (!rawVal || rawVal === "" || rawVal === undefined) {
          if (d.rawDay === 0 || d.holiday) rawVal = "例";
          else if (d.rawDay === 6) rawVal = "#";
          else rawVal = "-";
        }

        const rawStr = rawVal.toString().trim();
        const baseShiftName = rawStr.split('/')[0];
        const shiftObj = (shifts || []).find(s => s.name === baseShiftName);
        
        // 確保精確轉譯為真實代碼，將「例/休/#」通通群組為 "0" 進行加總
        if (shiftObj) return shiftObj.code;
        if (["#", "例", "休"].includes(baseShiftName)) return "0";
        if (baseShiftName === "-") return "1";
        return baseShiftName;
      });
      
      const count0 = codes.filter(c => c === "0").length;
      const countMinus3 = codes.filter(c => c === "-3").length;
      
      // 💡 執行組長指定的最新規則
      if (emp.labor === 'N') { 
        // 勞基法人員：14天內，"0" 必須剛好 4 天
        if (count0 !== 4) return false; 
      } 
      else if (emp.labor === 'Y') { 
        // 非勞基法人員：14天內，"0" 剛好 4 天 且 "-3" 剛好 4 天
        if (count0 !== 2 || countMinus3 !== 2) return false; 
      }
    }
    return true;
  };

  const filteredEmployees = useMemo(() => {
    let list = employees.filter(e => !e.isSeparator);
    if (reportType === 'personDays') return list.filter(e => !getIsNightClinic(e) && e.role !== '2');
    if (isFourWeekMode) return list.filter(e => !getIsNightClinic(e));
    if (isNightFeeMode) return list.filter(e => e.name !== "夜診支援" || hasSupportData);
    return list;
  }, [employees, reportType, isFourWeekMode, isNightFeeMode, hasSupportData]);

const handleExportCSV = (exportType = 'excel') => {
    const typeLabel = reportType === 'personDays' ? '人日數' : reportType === 'nightFee' ? '夜班費' : '班別代碼';
    
    let titleHeader = "台大醫院雲林分院藥劑部 班表";
    if (currentMonth) {
      const parts = currentMonth.split('-');
      if (parts.length === 2) {
        titleHeader = `台大醫院雲林分院藥劑部 ${parseInt(parts[0], 10) - 1911}年${parseInt(parts[1], 10)}月份班表`;
      }
    }

    const headers = ["員編", "姓名", ...reportDays.map(d => reportType === 'shiftCode' ? String(d.day) : `${d.day}(${d.dayOfWeek})`)];
    if (!isFourWeekMode && !isNightFeeMode) headers.push("總計");

    let xmlRows = "";
    // 建立大標題列
    xmlRows += `<tr style="height:35px;"><td colspan="${headers.length}" style="font-family:Microsoft JhengHei;font-size:16px;font-weight:bold;align:center;vertical-align:middle;background-color:#F3F4F6;">${titleHeader} (${typeLabel})</td></tr>`;

    // 建立日期標題列
    xmlRows += `<tr style="height:28px;font-family:Microsoft JhengHei;font-size:12px;font-weight:bold;align:center;vertical-align:middle;">`;
    headers.forEach(h => xmlRows += `<td style="background-color:#E5E7EB;border:0.5pt solid #D1D5DB;align:center;">${h.replace(/\n/g, " ")}</td>`);
    xmlRows += `</tr>`;
    
    // 建立資料列
    filteredEmployees.forEach(emp => {
      xmlRows += `<tr><td style="border:0.5pt solid #D1D5DB;">${emp.id}</td><td style="border:0.5pt solid #D1D5DB; font-weight:bold;">${emp.name}</td>`;
      
      reportDays.forEach(d => {
        const res = calculateCellValue(emp, d);
        
        // 1. 處理顯示值：確保 null/undefined/- 都變為真正空白
        const displayVal = (res.display === "-" || res.display === undefined || res.display === null) ? "" : res.display;
    
        // 2. 顏色判斷優先級邏輯
        // 優先級：週末/假日顏色 > Firebase 自訂顏色 > 預設白色
        let bg = "#FFFFFF"; 
        if (d.rawDay === 0 || !!d.holiday) bg = "#FFB3D9"; // 假日/節慶
        else if (d.rawDay === 6) bg = "#FFB366"; // 週六
        else {
           // 只有在非週末時，才檢查 Firebase 自訂色
           const customColor = cellColors?.[currentMonth]?.[emp.name]?.[d.day];
           if (customColor) {
              if (customColor.includes('red')) bg = '#FECACA';
              else if (customColor.includes('blue')) bg = '#BFDBFE';
              else if (customColor.includes('green')) bg = '#A7F3D0';
              else if (customColor.includes('yellow')) bg = '#FEF08A';
              else if (customColor.includes('purple')) bg = '#E9D5FF';
           }
        }

        xmlRows += `<td style="background-color:${bg}; border:0.5pt solid #D1D5DB; align:center;">${displayVal}</td>`;
      });
      xmlRows += `</tr>`;
    });

    const excelTemplate = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"/></head><body><table border="1">${xmlRows}</table></body></html>`;
    const blob = new Blob([excelTemplate], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${titleHeader}_${typeLabel}.xls`;
    link.click();
  };

  return (
    <div className="flex-grow flex flex-col bg-gray-50 overflow-hidden font-sans">
      <div className="bg-white border-b-2 border-gray-800 p-3 flex flex-wrap justify-between items-center shadow-md z-[60] gap-3">
        <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl shadow-inner">
          <button onClick={() => setReportType('personDays')} className={`px-4 py-1.5 rounded-lg text-xs font-black transition-all ${reportType === 'personDays' ? 'bg-white text-teal-600 shadow-md scale-105' : 'text-gray-400 hover:text-gray-600'}`}>人日數統計</button>
          <button onClick={() => setReportType('nightFee')} className={`px-4 py-1.5 rounded-lg text-xs font-black transition-all ${reportType === 'nightFee' ? 'bg-white text-indigo-600 shadow-md scale-105' : 'text-gray-400 hover:text-gray-600'}`}>夜班費</button>
          <button onClick={() => setReportType('shiftCode')} className={`px-4 py-1.5 rounded-lg text-xs font-black transition-all ${reportType === 'shiftCode' ? 'bg-white text-blue-600 shadow-md scale-105' : 'text-gray-400 hover:text-gray-600'}`}>班別代碼(四周)</button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => handleExportCSV('csv')} className="bg-teal-600 text-white px-3 py-1.5 rounded-xl text-xs font-black shadow-md hover:bg-teal-700">
            匯出 CSV
          </button>
          <button onClick={() => handleExportCSV('excel')} className="bg-emerald-600 text-white px-3 py-1.5 rounded-xl text-xs font-black shadow-md hover:bg-emerald-700">
            匯出 Excel (帶顏色)
          </button>
        </div>
      </div>
      <div className="flex-grow overflow-auto relative">
        <table className="w-full text-[12px] text-center border-separate border-spacing-0 table-fixed min-w-[1600px]">
          <thead className="sticky top-0 z-[50]">
            <tr className="bg-gray-100">
              <th className="sticky left-0 top-0 z-[55] bg-gray-100 border-r-2 border-b-2 border-gray-300 p-3 w-16 font-black text-[11px]">姓名</th>
              {reportDays.map((d, idx) => (
                <th key={idx} className={`border-r border-b-2 border-gray-300 p-1 w-12 font-bold ${d.rawDay === 0 || !!d.holiday ? 'bg-[#FFB3D9]' : d.rawDay === 6 ? 'bg-[#FFB366]' : 'bg-gray-100'}`}>
                  <div className="text-[10px] opacity-60">{d.dayOfWeek}</div><div className="text-base">{d.day}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredEmployees.map(emp => (
              <tr key={emp.id} className="hover:bg-blue-50 transition-colors">
                <td className="sticky left-0 z-40 bg-white border-r-2 border-b border-gray-200 p-2 font-black">{emp.name}</td>
                {reportDays.map((d, idx) => {
                  const res = calculateCellValue(emp, d);
                  return <td key={idx} className="border-r border-b border-gray-200 p-0 h-10">{res.display}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

const SchedulingView = ({ currentMonth, employees, daysInMonth, schedule, setSchedule, cellColors, setCellColors, shifts, exportScheduleCSV, setCurrentPage, setIsDirty, saveData, preLeaveData, setPreLeaveData, isAdmin, isMonthDrawn }) => {
  const [editSched, setEditSched] = useState({});
  const [activeColor, setActiveColor] = useState('bg-white');
  const [importPreview, setImportPreview] = useState(null);
  const [ignoredCells, setIgnoredCells] = useState(new Set()); 
  const fileRef = useRef(null);
  const [showLaborWarning, setShowLaborWarning] = useState(false);
  const [cycleStartDate, setCycleStartDate] = useState(`${currentMonth}-01`); // 預設使用當月1號作為四周週期起點
  const prevMonthRef = useRef(currentMonth);

  // 💡 修正 1：自動對齊月份切換，保護手動輸入不洗檔
  useEffect(() => {
    // 讓系統自己去對比，是不是真的換月份了
    const isMonthChanged = prevMonthRef.current !== currentMonth;

    // 🛑 情況 A：如果「不是切換月份」且「編輯器已經有暫存資料」，代表是同月內手動輸入
    // 啟動安全防護，全域監聽再怎麼跳動，都絕對攔截不洗檔！（解決兩秒消失）
    if (!isMonthChanged && editSched && Object.keys(editSched).length > 0) {
      return;
    }

    // 🌟 情況 B：如果是「初次載入」或「確認切換月份了」，精確從全域複製新月份班表進來！
    const curMonthSched = schedule[currentMonth] || {};
    const newSched = {};
    employees.forEach(e => {
      if (e.isSeparator) return;
      newSched[e.name] = { ...curMonthSched[e.name] };
      daysInMonth.forEach(d => { 
        if (!newSched[e.name][d.day]) {
          const isNC = getIsNightClinic(e);
          if (isNC) newSched[e.name][d.day] = ""; 
          else {
            if (d.rawDay === 0 || !!d.holiday) newSched[e.name][d.day] = e.labor === 'Y' ? "例" : "#";
            else if (d.rawDay === 6) newSched[e.name][d.day] = "#";
            else newSched[e.name][d.day] = "-";
          }
        } 
      });
    });

    setEditSched(newSched);
    
    // 如果是切換月份，自動把編輯狀態、CSV預覽狀態清洗乾淨，並更新 Ref 紀錄
    if (isMonthChanged) {
      setIsDirty(false);
      setImportPreview(null);
      setIgnoredCells(new Set());
      prevMonthRef.current = currentMonth;
    }
  }, [currentMonth, employees, daysInMonth, schedule, editSched]); 

  // 💡 修正 2：精確鎖定 Y+5碼員編的匯入檢核
const handleImportCSV = (e) => {
    try {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          // 拆解 CSV 資料並清除引號與空白
          const rows = ev.target.result.split(/\r?\n/).map(r => r.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
          
          // =================== 【 1. 彈性月份檢核 】 ===================
          let fileMonth = null;
          const topRowsText = rows.slice(0, 5).map(r => r.join("")).join("").replace(/,/g, "").replace(/\s/g, "");
          const match = topRowsText.match(/(1\d{2})年(\d{1,2})月/);
          
          if (match) {
            const rocYear = parseInt(match[1], 10);
            const month = parseInt(match[2], 10);
            fileMonth = `${rocYear + 1911}-${String(month).padStart(2, '0')}`;
          }
          
          if (!fileMonth || fileMonth !== currentMonth) {
            alert(`上傳的班表月份 (${fileMonth || '未偵測到'}) 與當前系統月份 (${currentMonth}) 不符！\n請確認 CSV 檔案最上方是否有正確的年月份。`);
            fileRef.current.value = '';
            return;
          }

          // =================== 【 2. 動態尋找「姓名」欄位定位 】 ===================
          let nameIdx = -1;
          let headerRow = null;

          // 掃描前 5 列，找出哪一列是包含「姓名」或「員工姓名」的標頭列
          for (let i = 0; i < Math.min(rows.length, 5); i++) {
            const idx = rows[i].findIndex(c => c.includes("姓名") || c === "姓名");
            if (idx !== -1) {
              nameIdx = idx;
              headerRow = rows[i];
              break;
            }
          }

          // 防呆：如果完全找不到姓名欄位，拋出錯誤
          if (nameIdx === -1) {
            alert("無法解析此 CSV 檔案！檔案內必須包含「姓名」或「員工姓名」欄位。");
            fileRef.current.value = '';
            return;
          }

          // =================== 【 3. 彈性抓取每日班別資料 】 ===================
// =================== 【 3. 彈性抓取每日班別資料 (過濾相同班別) 】 ===================
          const nextImportData = {};

          rows.forEach((r) => {
            const empName = r[nameIdx]; // 💡 動態鎖定姓名位置
            if (!empName || empName === "姓名" || empName === "員工姓名" || empName.trim() === "") return;

            // 檢查這個人是否存在於系統的員工名單中
            const empExists = employees.some(e => e.name === empName);
            if (!empExists) return;

            // 💡 姓名欄位的「右邊第一格」就是 1 號的班別，依此類推抓滿 31 天
            for (let day = 1; day <= 31; day++) {
              const cellValue = r[nameIdx + day]; 
              if (cellValue !== undefined) {
                // 將畫面上看到的中文字如 "例假"、"休假" 縮寫回系統認得的格式
                let finalValue = cellValue.trim();
                if (finalValue === "例假") finalValue = "例";
                if (finalValue === "休假") finalValue = "休";
                if (finalValue === "") finalValue = "-";
                
                // 【關鍵修復】：取得系統目前已經存的舊班別，並進行格式統一
                const currentRaw = schedule[currentMonth]?.[empName]?.[day];
                const currentVal = (currentRaw === null || currentRaw === undefined || String(currentRaw).trim() === "") ? "-" : String(currentRaw).trim();
                
                // 💡 只有當「上傳的新班別」跟「原本的舊班別」真的不同時，才記錄為變動！
                if (finalValue !== currentVal) {
                  if (!nextImportData[empName]) nextImportData[empName] = {};
                  nextImportData[empName][day] = finalValue;
                }
              }
            }
          });

          // 【加碼防呆】：如果整張表掃完，發現跟現在系統裡的班表一模一樣
          if (Object.keys(nextImportData).length === 0) {
            alert("比對完成：上傳的班表與目前系統內的班表「完全一致」，沒有變動的班別！");
            fileRef.current.value = '';
            return;
          }

          // 成功解析並有差異，送入比對與預覽模式
          setImportPreview(nextImportData);
          alert("🎉 CSV 班表解析成功！系統已進入「對比模式」，請確認藍框變動處無誤後，點擊『確認套用』！");

        } catch (err) {
          console.error(err);
          alert("上傳失敗，請檢查檔案格式是否為CSV UTF-8。");
        }
      };
      reader.readAsText(file, "UTF-8");
    } catch (error) {
      console.error(error);
    }
  };

  const confirmApplyImport = () => {
    const next = { ...editSched };
    Object.keys(importPreview).forEach(name => {
      Object.keys(importPreview[name]).forEach(day => {
        if (!ignoredCells.has(`${name}-${day}`)) next[name][day] = importPreview[name][day];
      });
    });
    setEditSched(next); setImportPreview(null); setIgnoredCells(new Set()); setIsDirty(true);
  };

  const isSatisfied = (cellValue, targetShiftName) => {
    if (!cellValue || cellValue === "-" || cellValue === "#" || cellValue === "例" || cellValue === "休") return false;
    const regex = new RegExp(`(^|[/()#])${targetShiftName}($|[/()#])`);
    return regex.test(String(cellValue).trim());
  };

  const getMissingData = () => {
    const data = {};
    const allScheduledThisMonth = new Set();
    Object.values(editSched).forEach(empSched => {
      Object.values(empSched).forEach(v => { if (v && !["-", "#", "例", ""].includes(v)) allScheduledThisMonth.add(String(v)); });
    });
    // 💡 修正點：加上 (shifts || []) 防止白屏
    const monthlyRules = (shifts || []).filter(s => s.isRegular === 'Y' && s.regularDays.includes("月"));
    daysInMonth.forEach(d => {
      const scheduledOnDay = Object.values(editSched).map(u => u?.[d.day]);
      const required = (shifts || []).filter(s => s.isRegular === 'Y' && !s.regularDays.includes("月") && (d.holiday ? s.regularDays.includes("國") : s.regularDays.includes(d.dayOfWeek)));
      let missing = required.filter(r => !scheduledOnDay.some(val => isSatisfied(val, r.name))).map(r => r.name);
      if (d.day === 1) {
        const missingMonthly = monthlyRules.filter(r => !Array.from(allScheduledThisMonth).some(v => isSatisfied(v, r.name))).map(r => r.name);
        missing = [...missing, ...missingMonthly];
      }
      if (missing.length > 0) data[d.day] = missing;
    });
    return data;
  };

  const handlePublishSchedule = () => {
    const nextSchedule = { ...schedule, [currentMonth]: deepClone(editSched) };
    setSchedule(nextSchedule);
    saveData({ schedule: nextSchedule }); 
    if (exportScheduleCSV) {
      exportScheduleCSV("發佈自動備份");
    }
    setIsDirty(false); 
    setCurrentPage('home');
    alert("班表發佈完成！已自動下載csv檔備份");
  };

  // 💡 勞基法即時檢核器 (跨月拼接 + 完美對齊報表邏輯)
  const laborAnalysis = useMemo(() => {
    if (!showLaborWarning || !cycleStartDate) return { codes: {}, details: {} };

    const analysis = { codes: {}, details: {} };
    const startObj = new Date(cycleStartDate);
    const dayMs = 24 * 60 * 60 * 1000;

    employees.forEach(emp => {
      if (emp.isSeparator) return;
      analysis.codes[emp.name] = {};
      const fourWeeksCodes = [];

      // 產生 28 天的完整跨月代碼陣列
      for (let i = 0; i < 28; i++) {
        const targetDate = new Date(startObj.getTime() + i * dayMs);
        const yKey = targetDate.getFullYear();
        const mKey = String(targetDate.getMonth() + 1).padStart(2, '0');
        const dKey = String(targetDate.getDate());
        const targetMonthStr = `${yKey}-${mKey}`;

        // 當月抓編輯中的 editSched，非當月抓已儲存的 schedule
        let rawVal = "-";
        if (targetMonthStr === currentMonth) {
          rawVal = editSched[emp.name]?.[dKey] || "-";
        } else {
          rawVal = schedule[targetMonthStr]?.[emp.name]?.[dKey] || "-";
        }

        let code = "";
        if (rawVal === "例") code = "-3";
        else if (["休", "#", "公"].includes(rawVal)) code = "0";
        else if (rawVal === "國") code = "-2";
        else {
          const shiftObj = shifts?.find(s => s.name === rawVal);
          if (shiftObj) code = shiftObj.code;
        }

        fourWeeksCodes.push(code);

        // 如果是當月，存入 codes 供格子右下角顯示
        if (targetMonthStr === currentMonth) {
          analysis.codes[emp.name][dKey] = code;
        }
      }

      // 統計例與休 (0 與 -2 皆視為休)
      let firstBiweekLi = 0, firstBiweekXiu = 0;
      let secondBiweekLi = 0, secondBiweekXiu = 0;

      for (let i = 0; i < 14; i++) {
        if (fourWeeksCodes[i] === "-3") firstBiweekLi++;
        else if (fourWeeksCodes[i] === "0" || fourWeeksCodes[i] === "-2") firstBiweekXiu++;
      }
      for (let i = 14; i < 28; i++) {
        if (fourWeeksCodes[i] === "-3") secondBiweekLi++;
        else if (fourWeeksCodes[i] === "0" || fourWeeksCodes[i] === "-2") secondBiweekXiu++;
      }

      // 判斷是否違規
      const isLabor = emp.labor === 'Y';
      let w1Violation = false, w2Violation = false;

      if (isLabor) {
        if (firstBiweekLi < 2 || firstBiweekXiu < 2) w1Violation = true;
        if (secondBiweekLi < 2 || secondBiweekXiu < 2) w2Violation = true;
      } else {
        if ((firstBiweekLi + firstBiweekXiu) < 4) w1Violation = true;
        if ((secondBiweekLi + secondBiweekXiu) < 4) w2Violation = true;
      }

      analysis.details[emp.name] = {
        hasViolation: w1Violation || w2Violation,
        isLabor, w1Violation, w2Violation,
        firstBiweekLi, firstBiweekXiu,
        secondBiweekLi, secondBiweekXiu
      };
    });

    // 補齊本月其餘日期
    employees.forEach(emp => {
      if (emp.isSeparator || !analysis.codes[emp.name]) return;
      daysInMonth.forEach(d => {
        if (analysis.codes[emp.name][d.day] === undefined) {
          const val = editSched[emp.name]?.[d.day] || "-";
          let code = "";
          if (val === "例") code = "-3";
          else if (["休", "#", "公假", "特休"].includes(val)) code = "0";
          else if (val === "國") code = "-2";
          else {
            const shiftObj = shifts?.find(s => s.name === val);
            if (shiftObj) code = shiftObj.code;
          }
          analysis.codes[emp.name][d.day] = code;
        }
      });
    });

    return analysis;
  }, [showLaborWarning, cycleStartDate, editSched, schedule, currentMonth, employees, daysInMonth, shifts]);

  return (
    <div className="flex-grow flex flex-col h-full bg-gray-100 overflow-hidden font-sans">
      <div className="flex-none bg-white border-b p-2 flex justify-between items-center shadow-sm z-20">
        <div className="flex gap-4 items-center">
          <span className="font-black text-gray-700">排班編輯器 - {currentMonth}</span>
          {!importPreview && (
            <div className="flex gap-1 bg-gray-100 p-1 rounded">
              {PALETTE.map(p => (
                <button 
                  key={p.name} 
                  onClick={() => setActiveColor(p.class)} 
                  className={`w-6 h-6 rounded-full border-2 ${p.class} ${activeColor === p.class ? 'border-blue-500 scale-110 shadow' : 'border-white'}`}
                />
              ))}
            </div>
          )}
          {importPreview && (
             <div className="flex items-center gap-2 bg-blue-50 px-3 py-1 rounded border border-blue-200">
               <span className="text-[10px] font-bold text-blue-700 animate-pulse flex items-center gap-1"><ShieldCheck size={14}/> 對比模式：點選切換</span>
               <button onClick={confirmApplyImport} className="text-[10px] bg-blue-600 text-white px-2 py-0.5 rounded font-bold">確認套用</button>
               <button onClick={() => setImportPreview(null)} className="text-[10px] bg-gray-400 text-white px-2 py-0.5 rounded font-bold">取消</button>
             </div>
          )}
        </div>
        <div className="flex items-center gap-3 ml-auto border-l-2 border-gray-200 pl-4">
          {/* 開啟時顯示起始日期選擇 */}
          {showLaborWarning && (
            <input 
              type="date" 
              value={cycleStartDate} 
              onChange={(e) => setCycleStartDate(e.target.value)} 
              className="border border-blue-300 rounded-lg px-2 py-1 text-xs font-bold outline-none text-blue-700 bg-blue-50"
              title="設定四周變形工時起始日"
            />
          )}
          
          <label className="flex items-center gap-2 text-sm font-bold bg-slate-50 hover:bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 cursor-pointer transition-colors shadow-sm">
            <div className="relative inline-block w-8 h-4 rounded-full bg-gray-300">
              <input 
                type="checkbox" 
                className="peer opacity-0 w-0 h-0"
                checked={showLaborWarning} 
                onChange={(e) => setShowLaborWarning(e.target.checked)}
              />
              <span className="absolute cursor-pointer top-0 left-0 right-0 bottom-0 bg-gray-300 rounded-full transition-all peer-checked:bg-blue-500 before:content-[''] before:absolute before:h-3 before:w-3 before:left-0.5 before:bottom-0.5 before:bg-white before:rounded-full before:transition-all peer-checked:before:translate-x-4"></span>
            </div>
            <span className={showLaborWarning ? 'text-blue-700' : 'text-gray-500'}>勞基法即時檢核</span>
          </label>
        </div>
        <div className="flex gap-2">
          {!importPreview && (
            <>
              {/* 💡 新增：排班頁面的 Excel/CSV 下載功能，自動帶有標準民國年大標題 */}
              <button 
                onClick={() => {
                  try {
                    let titleHeader = "台大醫院雲林分院藥劑部 班表";
                    if (currentMonth) {
                      const parts = currentMonth.split('-');
                      if (parts.length === 2) {
                        titleHeader = `台大醫院雲林分院藥劑部 ${parseInt(parts[0], 10) - 1911}年${parseInt(parts[1], 10)}月份班表`;
                      }
                    }

                    const getHex = (tailwindClass) => {
                      if (!tailwindClass) return null;
                      if (tailwindClass.includes('red') || tailwindClass.includes('rose')) return '#FECACA';
                      if (tailwindClass.includes('blue') || tailwindClass.includes('sky')) return '#BFDBFE';
                      if (tailwindClass.includes('green') || tailwindClass.includes('teal') || tailwindClass.includes('emerald')) return '#A7F3D0';
                      if (tailwindClass.includes('yellow') || tailwindClass.includes('amber')) return '#FEF08A';
                      if (tailwindClass.includes('purple') || tailwindClass.includes('violet')) return '#E9D5FF';
                      if (tailwindClass.includes('pink')) return '#FBCFE8';
                      if (tailwindClass.includes('orange')) return '#FED7AA';
                      if (tailwindClass.includes('gray') || tailwindClass.includes('slate')) return '#E5E7EB';
                      return null;
                    };

                    let xmlRows = "";
                    xmlRows += `
                      <tr style="height:35px;">
                        <td colspan="33" style="font-family:Microsoft JhengHei;font-size:16px;font-weight:bold;align:center;vertical-align:middle;background-color:#F3F4F6;">
                          ${titleHeader}
                        </td>
                      </tr>`;

                    xmlRows += `<tr style="height:25px;font-family:Microsoft JhengHei;font-size:11px;font-weight:bold;align:center;background-color:#E5E7EB;">`;
                    xmlRows += `<td style="border:0.5pt solid #D1D5DB;width:60pt;">員工編號</td>`;
                    xmlRows += `<td style="border:0.5pt solid #D1D5DB;width:60pt;">員工姓名</td>`;
                    
                    const weekMap = ['日', '一', '二', '三', '四', '五', '六'];
                    for (let d = 1; d <= 31; d++) {
                      const dateObj = new Date(`${currentMonth}-${String(d).padStart(2, '0')}`);
                      const dayOfWeek = weekMap[dateObj.getDay()];
                      xmlRows += `<td style="border:0.5pt solid #D1D5DB;width:30pt;">${d}(${dayOfWeek})</td>`;
                    }
                    xmlRows += `</tr>`;

                    employees.forEach(emp => {
                      xmlRows += `<tr style="height:24px;font-family:Microsoft JhengHei;font-size:12px;align:center;vertical-align:middle;">`;
                      xmlRows += `<td style="border:0.5pt solid #E5E7EB;">${emp.id}</td>`;
                      xmlRows += `<td style="border:0.5pt solid #E5E7EB;font-weight:bold;">${emp.name}</td>`;
                      
                      for (let d = 1; d <= 31; d++) {
                        const rawValue = schedule[currentMonth]?.[emp.name]?.[d];
                        const cellValue = (rawValue === undefined || rawValue === null) ? "" : rawValue;
                        
                        const customColorClass = cellColors?.[currentMonth]?.[emp.name]?.[d];
                        const dateObj = new Date(`${currentMonth}-${String(d).padStart(2, '0')}`);
                        const dayOfWeek = dateObj.getDay();
                        
                        let cellBg = "#FFFFFF";
                        if (dayOfWeek === 0) cellBg = "#FFB3D9"; 
                        else if (dayOfWeek === 6) cellBg = "#FFB366"; 
                        
                        if (customColorClass) {
                          const hex = getHex(customColorClass);
                          if (hex) cellBg = hex;
                        }

                        xmlRows += `<td style="background-color:${cellBg};border:0.5pt solid #E5E7EB;">${cellValue}</td>`;
                      }
                      xmlRows += `</tr>`;
                    });

                    const excelTemplate = `
                      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
                      <head></head>
                      <body><table border="1">${xmlRows}</table></body>
                      </html>`;

                    const blob = new Blob([excelTemplate], { type: 'application/vnd.ms-excel;charset=utf-8;' });
                    const link = document.createElement("a");
                    link.href = URL.createObjectURL(blob);
                    link.download = `${titleHeader}.xls`;
                    link.click();
                  } catch (err) {
                    console.error("匯出錯誤:", err);
                  }
                }}
                className="bg-emerald-600 text-white px-3 py-1.5 rounded text-xs font-bold flex items-center gap-1 hover:bg-emerald-700 shadow transition-all active:scale-95"
              >
                <Download size={14}/> 下載Excel
              </button>

              <button onClick={() => fileRef.current.click()} className="bg-gray-800 text-white px-4 py-1.5 rounded text-xs font-bold flex items-center gap-1 hover:bg-black shadow"><Upload size={14}/> 上傳 CSV</button>
              <button onClick={handlePublishSchedule} className="bg-blue-600 text-white px-5 py-1.5 rounded text-xs font-bold shadow flex items-center gap-2 hover:bg-blue-700 transition-all"><CheckCircle2 size={16}/> 發佈班表</button>
            </>
          )}
          <input type="file" ref={fileRef} className="hidden" accept=".csv" onChange={handleImportCSV} />
        </div>
      </div>
      <div className="overflow-x-auto w-full border rounded-lg shadow-sm">
        <table className="w-full text-[12px] text-center border-separate border-spacing-0 table-fixed min-w-[1600px] lg:min-w-[1800px]">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-[100] bg-gray-100 p-3 w-16 font-black text-[11px] shadow-[2px_2px_5px_rgba(0,0,0,0.1)] border-b-2 border-r-2 border-gray-300">姓名</th>
              {daysInMonth.map(d => {
                const cycleEnd = isCycleEnd(d.fullDate);
                let bgClass = "bg-gray-100";
                if (d.rawDay === 0 || d.holiday) bgClass = "bg-[#FFB3D9]";
                else if (d.rawDay === 6) bgClass = "bg-[#FFB366]";
                return (
                  <th key={d.day} 
                    className={`sticky top-0 z-[90] p-1 w-12 font-bold border-b-2 border-r border-gray-300 ${bgClass} ${cycleEnd ? 'border-r-4 border-r-gray-400' : ''}`} >
                    <div className="text-[10px] opacity-60">{d.dayOfWeek}</div>
                    <div className="text-base">{d.day}</div>
                    <div className="text-[9px] text-red-600 truncate h-4 leading-none font-normal">{String(d.holiday || "")}</div>
                  </th>);})}</tr>
            <tr className="sticky top-[65px] z-[60] bg-[#F3E5F5] border-b shadow-sm">
              <th className="sticky left-0 top-[65px] z-[70] bg-[#F3E5F5] border p-2 font-normal text-purple-600 text-[11px] w-[80px] min-w-[80px] shadow-[2px_0_5px_rgba(0,0,0,0.05)]"> 備註 </th>
              {daysInMonth.map(d => {
                const cycleEnd = isCycleEnd(d.fullDate);
                
                // 💡 修正：取消 isMonthDrawn 的限制。只要是管理員 (!isAdmin 為 false)，就永遠可以編輯備註！
                const isDisabled = !isAdmin; 
                
                return (
                  <th key={`note-${d.day}`} className={`border p-0.5 align-middle w-[55px] min-w-[55px] ${cycleEnd ? 'border-r-4 border-r-gray-400' : ''}`}>
                    <textarea 
                      rows={1}
                      value={preLeaveData?.remarks?.[currentMonth]?.[d.day] || ""} 
                      disabled={isDisabled}
                      onChange={e => { 
                        const next = deepClone(preLeaveData); 
                        if(!next.remarks) next.remarks = {};
                        if(!next.remarks[currentMonth]) next.remarks[currentMonth] = {}; 
                        next.remarks[currentMonth][d.day] = e.target.value;   
                        setPreLeaveData(next);
                        saveData({ preLeaveData: next }); 
                      }}
                      // 💡 樣式同步更新：當 isDisabled 時才顯示游標禁止 (cursor-not-allowed)
                      className={`w-full h-full bg-transparent text-[11px] font-bold text-purple-600 text-center outline-none resize-none overflow-hidden block ${isDisabled ? 'cursor-not-allowed opacity-70' : 'cursor-text'}`}
                      style={{ fieldSizing: 'content', minHeight: '1.5em' }}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => {
              if (emp.isSeparator) return <tr key={emp.id} className="bg-gray-200 h-[1.5px]"><td colSpan={daysInMonth.length + 1}></td></tr>;
              
              const isNC = getIsNightClinic(emp);
              const detail = laborAnalysis.details?.[emp.name];
              const isViolated = showLaborWarning && detail?.hasViolation;
              
              return (
                <tr key={emp.id} className="hover:bg-blue-50 border-b group transition-colors">
                  <td className={`sticky left-0 z-[50] bg-white border p-2 shadow-[2px_0_5px_rgba(0,0,0,0.1)] align-middle w-[80px] min-w-[80px]
                    ${isViolated ? 'bg-red-50 border-r-4 border-r-red-500' : 'group-hover:bg-blue-50'}
                  `}>
                    <div className="flex flex-col items-center justify-center gap-1 w-full text-center">
                      <span className={`font-black text-[13px] w-full truncate ${isViolated ? 'text-red-800' : 'text-gray-800'}`}>
                        {emp.name}
                      </span>
                      
                      {isViolated && (
                        <div className="text-red-600 font-bold text-[10px] leading-tight">
                          {detail.isLabor ? (
                            <>
                              {detail.w1Violation && <div>前半:<br/>{detail.firstBiweekLi}例 {detail.firstBiweekXiu}休</div>}
                              {detail.w2Violation && <div className="mt-1">後半:<br/>{detail.secondBiweekLi}例 {detail.secondBiweekXiu}休</div>}
                            </>
                          ) : (
                            <>
                              {detail.w1Violation && <div>前半:<br/>{detail.firstBiweekLi}例 {detail.firstBiweekXiu}休</div>}
                              {detail.w2Violation && <div className="mt-1">後半:<br/>{detail.secondBiweekLi}例 {detail.secondBiweekXiu}休</div>}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </td>

                  {/* 排班格子 */}
                  {daysInMonth.map((d) => {
                    const originalVal = editSched[emp.name]?.[d.day] || (isNC ? "" : "-");
                    const previewVal = importPreview ? importPreview[emp.name]?.[d.day] : null;
                    const isConflict = importPreview && originalVal !== "-" && originalVal !== "#" && originalVal !== "例" && originalVal !== "" && originalVal !== previewVal;
                    const isIgnored = ignoredCells.has(`${emp.name}-${d.day}`);
                    const displayVal = (importPreview && !isIgnored) ? previewVal : originalVal;
                    const customColor = cellColors[currentMonth]?.[emp.name]?.[d.day];
                    
                    let bgClass = "bg-white"; 
                    if (customColor && customColor !== "bg-white") bgClass = customColor; 
                    else if (d.rawDay === 0 || !!d.holiday) bgClass = "bg-[#FFB3D9]"; 
                    else if (d.rawDay === 6) bgClass = "bg-[#FFB366]";

                    const conflictClass = (importPreview && isConflict && !isIgnored) ? 'bg-blue-100 ring-inset ring-2 ring-blue-400 z-20' : '';
                    const isLocalEnd = isCycleEnd(d.fullDate);
                    const borderClass = isLocalEnd ? 'border-r-4 border-r-gray-400 z-30' : 'border-r';

                    return (
                      <td 
                        key={d.day} 
                        className={`relative border-y border-l p-0 align-middle ${bgClass} ${conflictClass} ${borderClass}`}
                        onClick={() => {
                          if (importPreview && isConflict) { 
                            const n = new Set(ignoredCells); 
                            if (n.has(`${emp.name}-${d.day}`)) n.delete(`${emp.name}-${d.day}`); 
                            else n.add(`${emp.name}-${d.day}`); 
                            setIgnoredCells(n);
                          } else if (!importPreview) { 
                            const nc = deepClone(cellColors); 
                            if (!nc[currentMonth]) nc[currentMonth] = {}; 
                            if (!nc[currentMonth][emp.name]) nc[currentMonth][emp.name] = {}; 
                            nc[currentMonth][emp.name][d.day] = activeColor; 
                            setCellColors(nc);
                            saveData({ cellColors: nc }); 
                          }
                        }}
                      >
                        <input 
                          type="text" 
                          value={displayVal} 
                          disabled={!!importPreview} 
                          className={`w-full h-full text-center bg-transparent focus:bg-white outline-none font-normal font-mono cursor-text relative z-10 whitespace-nowrap ${
                            importPreview ? 'pointer-events-none opacity-80' : ''
                          } ${
                            (!isNC && displayVal !== "" && !["-", "#", "例", "休", "公", "國"].includes(displayVal) && !(shifts || []).some(s => s.name === displayVal))
                              ? 'text-red-500 font-black' 
                              : (displayVal === "-" ? 'text-gray-300' : 'text-gray-800')
                          }`}
                          onChange={(e) => { 
                            if (!importPreview) { 
                              setEditSched(prev => ({ ...prev, [emp.name]: { ...prev[emp.name], [d.day]: e.target.value } })); 
                              setIsDirty(true); 
                            } 
                          }} 
                        />
                        
                        {/* 隱約顯示的勞基法代碼 */}
                        {showLaborWarning && laborAnalysis.codes[emp.name]?.[d.day] && (
                          <span className="absolute bottom-0 right-0.5 text-[8px] font-black z-0 opacity-40 select-none pointer-events-none text-gray-500">
                            {laborAnalysis.codes[emp.name][d.day]}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-gray-50 border-t-2 border-gray-300">
            <tr>
              <td className="sticky left-0 z-20 bg-gray-100 border p-1 text-[9px] font-black text-gray-400 text-center border-r-2">
                漏排提醒
              </td>
              {daysInMonth.map(d => { 
                const missing = getMissingData()[d.day] || [];
                return (
                  <td key={d.day} className={`aborder p-0.5 align-top min-h-12 bg-orange-50 ${isCycleEnd(d.fullDate) ? 'border-r-4 border-r-gray-400' : ''}`}>
                    {missing.length > 0 && (
                      <div className="flex flex-col gap-0.5">
                        {missing.map(m => (
                          <div key={m} className="bg-white border border-orange-200 text-orange-600 font-bold text-[8px] rounded p-0.5 shadow-sm">
                            {m}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};

const App = () => {
  const [currentPage, setCurrentPage] = useState('home');
  const [pendingPage, setPendingPage] = useState(null); 
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [currentMonth, setCurrentMonth] = useState('2026-05');
  const [showPassword, setShowPassword] = useState(false);
  const [employees, setEmployees] = useState(INITIAL_EMPLOYEES);
  const [shifts, setShifts] = useState(INITIAL_SHIFTS);
  const [holidays, setHolidays] = useState({ "2026-05-01": "勞動節" });
  const [personDayRules, setPersonDayRules] = useState(INITIAL_PERSON_DAY_RULES);
  const [schedule, setSchedule] = useState({});
  const [cellColors, setCellColors] = useState({});
  const [swapRequests, setSwapRequests] = useState([]); 
  const [swapTarget, setSwapTarget] = useState(null); 
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteShiftTarget, setDeleteShiftTarget] = useState(null);
  const [rejectingReq, setRejectingReq] = useState(null);
  const [rejectNote, setRejectNote] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [targetPage, setTargetPage] = useState(null);
  const [preLeaveData, setPreLeaveData] = useState({apps: {},dailyLimits: {},remarks: {},weekendLimit: 10,weekdayLimit: 3,lotteryDay: 15,drawnMonths: []});
  const [isModalOpen, setIsModalOpen] = useState(false);

  const saveData = async (updates) => {
    if (!auth.currentUser) return;
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'roster', 'main');
    try {
      await setDoc(docRef, updates, { merge: true });
    } catch (error) {
      console.error("雲端儲存失敗:", error);
    }
  };

  useEffect(() => {const initAuth = async () => { try {if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {await signInWithCustomToken(auth, __initial_auth_token);} else {await signInAnonymously(auth);}} catch (err) {console.warn("驗證不匹配:", err);await signInAnonymously(auth);}};initAuth();
}, []);
  
    useEffect(() => {const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'roster', 'main');const unsubData = onSnapshot(docRef, (snap) => {
      if (snap.exists()) {const d = snap.data();
        if (d.employees) setEmployees(d.employees);
        if (d.shifts) setShifts(d.shifts);
        if (d.holidays) setHolidays(d.holidays);
        if (d.personDayRules) setPersonDayRules(d.personDayRules);
        if (d.schedule) setSchedule(d.schedule);
        if (d.cellColors) setCellColors(d.cellColors);
        if (d.swapRequests) setSwapRequests(d.swapRequests);
        if (d.preLeaveData) setPreLeaveData(d.preLeaveData); 
      }
    }, (error) => console.error("雲端監聽失敗:", error));

    return () => unsubData();
  }, [appId]);
    
  const daysInMonth = useMemo(() => {
    const [year, month] = currentMonth.split('-').map(Number);
    const date = new Date(year, month, 0); const days = [];
    for (let i = 1; i <= date.getDate(); i++) { const d = new Date(year, month - 1, i), fullDate = `${currentMonth}-${String(i).padStart(2, '0')}`; days.push({ day: i, dayOfWeek: WEEKDAYS_MAP[d.getDay()], rawDay: d.getDay(), holiday: holidays[fullDate] || "", fullDate }); }
    return days;
  }, [currentMonth, holidays]);

  const handlePageChange = (p) => {
    if (currentPage === 'schedule' && isDirty) { setTargetPage(p); setShowExitConfirm(true); return; }
    const res = ['swap', 'records', 'schedule', 'account', 'shifts', 'leave', 'report'];
    if (res.includes(p) && !isLoggedIn) { setPendingPage(p); setCurrentPage('login'); } else setCurrentPage(p);
  };

  const confirmExit = () => { setIsDirty(false); setShowExitConfirm(false); const p = targetPage; setTargetPage(null);
    const res = ['swap', 'records', 'schedule', 'account', 'shifts', 'leave', 'report'];
    if (res.includes(p) && !isLoggedIn) { setPendingPage(p); setCurrentPage('login'); } else setCurrentPage(p);
  };

const handleLoginAction = (id, pwd) => {
  const emp = employees.find(e => e.id === id);
  if (!emp) { alert("無此員編權限。"); return; }
  if (emp.password === "" || emp.password === pwd) {
    if (emp.password === "" && pwd !== "") {
      const nextEmployees = employees.map(e => e.id === emp.id ? { ...e, password: pwd } : e); setEmployees(nextEmployees);saveData({ employees: nextEmployees });
      const updatedEmp = { ...emp, password: pwd };setCurrentUser(updatedEmp);
    } else {setCurrentUser(emp); } setIsLoggedIn(true);
    if (pendingPage) { setCurrentPage(pendingPage);  setPendingPage(null); 
    } else {setCurrentPage('home');}
  } else {alert("密碼錯誤！");}
};

const handleSwapApply = (targetEmp, dayInfo) => {
  if (!currentUser || targetEmp.id === currentUser.id) return;
  const targetDateStr = dayInfo.fullDate;
  
  // 1. 檢查是否已經在申請中
  const isDateLocked = currentUser.applyingDates?.includes(targetDateStr);
  if (isDateLocked) {
    alert(`您在 ${targetDateStr} 已經有一筆換班申請正在流程中。`);
    return;
  }

  const normalize = (v) => (v || "-").toString().trim() === "" ? "-" : (v || "-").toString().trim();
  const targetShift = normalize(schedule[currentMonth]?.[targetEmp.name]?.[dayInfo.day]);

  // --- 多人連鎖核心邏輯開始 ---
  if (swapTarget && swapTarget.date === targetDateStr) {
    // 【連鎖模式】：已經選過人了，現在點選的是第 3, 4... 位參與者
    
    // 檢查是否重複選點同一個人
    if (swapTarget.participants.some(p => p.id === targetEmp.id)) {
      alert("此人已在連鎖換班名單中。");
      return;
    }

    const newParticipants = [
      ...swapTarget.participants,
      {
        id: targetEmp.id,
        name: targetEmp.name,
        oldShift: targetShift
      }
    ];

    setSwapTarget({
      ...swapTarget,
      participants: newParticipants
    });
    setIsModalOpen(true); // 💡 開啟視窗確認
    return;
  }

  // 【首選模式】：點選第一個換班對象
  const myShift = normalize(schedule[currentMonth]?.[currentUser.name]?.[dayInfo.day]);
  
  // ... (您的整段換班判定邏輯 isBundle, daysToSwap 等維持不變) ...
  let isBundle = false, startDate = dayInfo.fullDate, endDate = dayInfo.fullDate, daysToSwap = [dayInfo.day];
  const targetDate = new Date(dayInfo.fullDate);
  const dOfW = targetDate.getDay(); 

  const getShiftType = (val) => {
    if (val.startsWith('A1') || val.startsWith('A2')) return 'A1A2';
    if (val.startsWith('A3')) return 'A3';
    if (val.startsWith('P')) return 'P';
    return null;
  };

  const type = getShiftType(targetShift) || getShiftType(myShift);

  if (type === 'A1A2') {
    if (dOfW >= 1 && dOfW <= 5) {
      isBundle = true;
      const mon = new Date(targetDate); mon.setDate(targetDate.getDate() - (dOfW - 1));
      const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
      startDate = `${currentMonth}-${String(mon.getDate()).padStart(2, '0')}`;
      endDate = `${currentMonth}-${String(fri.getDate()).padStart(2, '0')}`;
      daysToSwap = []; for (let i = 0; i < 5; i++) { const d = new Date(mon); d.setDate(mon.getDate() + i); daysToSwap.push(d.getDate()); }
    }
  } else if (type === 'A3') {
    if (dOfW >= 1 && dOfW <= 4) {
      isBundle = true;
      const mon = new Date(targetDate); mon.setDate(targetDate.getDate() - (dOfW - 1));
      const thu = new Date(mon); thu.setDate(mon.getDate() + 3);
      startDate = `${currentMonth}-${String(mon.getDate()).padStart(2, '0')}`;
      endDate = `${currentMonth}-${String(thu.getDate()).padStart(2, '0')}`;
      daysToSwap = []; for (let i = 0; i < 4; i++) { const d = new Date(mon); d.setDate(mon.getDate() + i); daysToSwap.push(d.getDate()); }
    }
  } else if (type === 'P') {
    if (dOfW === 6 || dOfW === 0 || (dOfW >= 1 && dOfW <= 4)) {
      isBundle = true;
      const sat = new Date(targetDate);
      if (dOfW === 6) {} else if (dOfW === 0) sat.setDate(targetDate.getDate() - 1); else sat.setDate(targetDate.getDate() - (dOfW + 1));
      
      // 💡 修改點：P 班延長為連續 14 天 (前 6 天 P 班 + 後 8 天休)
      const nextFri = new Date(sat); nextFri.setDate(sat.getDate() + 13);
      startDate = `${currentMonth}-${String(sat.getDate()).padStart(2, '0')}`;
      endDate = `${currentMonth}-${String(nextFri.getDate()).padStart(2, '0')}`;
      daysToSwap = []; for (let i = 0; i < 14; i++) { const d = new Date(sat); d.setDate(sat.getDate() + i); daysToSwap.push(d.getDate());  }
    }
  }
  
  if (isBundle && daysToSwap.length > 0) {
    const monthPrefix = dayInfo.fullDate.substring(0, 7); // 抓取 "YYYY-MM"
    const bundleDates = daysToSwap.map(d => `${monthPrefix}-${String(d).padStart(2, '0')}`);
    
    // 檢查申請人與被申請人的鎖定清單中，是否包含這段區間的任何一天
    const isCreatorLocked = bundleDates.some(d => currentUser.applyingDates?.includes(d));
    const isTargetLocked = bundleDates.some(d => targetEmp.applyingDates?.includes(d));
    
    if (isCreatorLocked || isTargetLocked) {
      alert(`無法換班：這段整段換班的區間內，您或對方已經有其他的換班申請正在流程中了！\n（整段區間若與他人申請重疊，將被禁止換班）`);
      return; // 攔截！不顯示換班視窗
    }
  }

  // 設置初始的兩位參與者
  setSwapTarget({
    date: dayInfo.fullDate,
    dayOfWeek: dayInfo.dayOfWeek,
    day: dayInfo.day,
    creatorId: currentUser.id,
    creatorName: currentUser.name,
    creatorShift: myShift,
    targetId: targetEmp.id,
    targetName: targetEmp.name,
    targetShift: targetShift,
    participants: [
      { id: currentUser.id, name: currentUser.name, oldShift: myShift },
      { id: targetEmp.id, name: targetEmp.name, oldShift: targetShift }
    ],
    isBundle,
    startDate,
    endDate,
    daysToSwap
  });

  setIsModalOpen(true); // 💡 顯示申請框
};

const handleSwapBack = () => {
  if (!swapTarget || swapTarget.participants.length <= 2) return;
  
  const newParticipants = [...swapTarget.participants];
  newParticipants.pop(); // 移除最後一位
  
  setSwapTarget({
    ...swapTarget,
    participants: newParticipants
  });
};

const handleRecordAction = (req, action) => {
  // 💡 修正 1：升級 unlockDate，讓它能同時解鎖名單內的所有人
  const unlockDate = (participants, req) => {
    const participantIds = participants ? participants.map(p => p.id) : [req.creatorId, req.targetId];
    
    // 計算需要解鎖的日期陣列 (預設至少解鎖單日)
    let datesToUnlock = req.date ? [req.date] : [];
    if (req.isBundle && Array.isArray(req.daysToSwap) && req.date) {
      const monthPrefix = req.date.substring(0, 7);
      datesToUnlock = req.daysToSwap.map(d => `${monthPrefix}-${String(d).padStart(2, '0')}`);
    }

    const nextEmployees = employees.map(e => {
      if (participantIds.includes(e.id)) {
        const currentDates = e.applyingDates || [];
        // 確保將解鎖陣列內的日期通通清空
        return { ...e, applyingDates: currentDates.filter(d => !datesToUnlock.includes(d)) };
      }
      return e;
    });
    setEmployees(nextEmployees);

    if (currentUser && participantIds.includes(currentUser.id)) {
      setCurrentUser(prev => ({
        ...prev,
        applyingDates: (prev.applyingDates || []).filter(d => !datesToUnlock.includes(d))
      }));
    }
    return nextEmployees;
  };

  if (action === 'Approve') {
    // 💡 情況 A：同仁全員簽完，轉 PendingAdmin
    if (req.status === 'WaitingParticipants') {
      const nextRequests = swapRequests.map(r => r.id === req.id ? { ...r, status: 'PendingAdmin' } : r);
      setSwapRequests(nextRequests);
      saveData({ swapRequests: nextRequests });
    } 
    // 💡 情況 B：組長核定 Approved
    else if (req.status === 'PendingAdmin') {
      const targetMonthKey = req.date ? req.date.substring(0, 7) : currentMonth;
      
      let isAllShiftsValid = true;
      let errorMsg = "";

      // 💡 升級：只有「單日換班」才需要進行舊班別字串比對，整段換班跳過。
      if (req.participants && !req.isBundle) {
        req.participants.forEach(p => {
          const exactDay = p.day || req.day || (req.startDate ? req.startDate.split('-')[2] : null);
          if (!exactDay) return;

          const currentSystemShift = schedule[targetMonthKey]?.[p.name]?.[Number(exactDay)];
          const normalize = (v) => {
            const s = (v === null || v === undefined) ? "-" : String(v).trim();
            return (s === "" || s === "-") ? "-" : s;
          };
          const clean = (val) => val.replace(/#|\(國\)/g, '');

          if (clean(normalize(currentSystemShift)) !== clean(normalize(p.oldShift))) {
            isAllShiftsValid = false;
            errorMsg += `【${p.name}】的班別不符（目前首頁：${normalize(currentSystemShift)}，紀錄：${p.oldShift}）\n`;
          }
        });
      }

      if (!isAllShiftsValid) {
        alert(`無法核定換班！\n\n${errorMsg}\n請組長再次確認「首頁」目前的最新班表。`);
        return; 
      }

      const nextStatus = 'Approved';
      const ns = deepClone(schedule);
      if (!ns[targetMonthKey]) ns[targetMonthKey] = {};
      
      let daysArray = [];
      if (req.isBundle && req.daysToSwap) {
        daysArray = req.daysToSwap;
      } else {
        const exactDay = req.day || (req.date ? Number(req.date.split('-')[2]) : null);
        if (exactDay) daysArray = [exactDay];
      }

      // 2. 針對每一天，進行班別交換
      daysArray.forEach(d => {
        if (!req.participants || req.participants.length < 2) return;

        const originalShifts = req.participants.map(p => {
          if (!ns[targetMonthKey][p.name]) ns[targetMonthKey][p.name] = {};
          return ns[targetMonthKey][p.name][d] || "-";
        });

        req.participants.forEach((p, idx) => {
          const nextIdx = (idx + 1) % req.participants.length;
          ns[targetMonthKey][p.name][d] = originalShifts[nextIdx];
        });
      });

      const nextRequests = swapRequests.map(r => r.id === req.id ? { ...r, status: nextStatus } : r);
      
      // 💡 修正點 1：傳入完整的 req 物件，而不是舊的 req.date，這樣才能解鎖一整段！
      const nextEmps = unlockDate(req.participants, req);

      setSchedule(ns);
      setSwapRequests(nextRequests);
      saveData({ schedule: ns, swapRequests: nextRequests, employees: nextEmps });
    }
  } 
  else if (action === 'Reject' || action === 'Delete') {
    const nextRequests = (action === 'Delete') 
      ? swapRequests.filter(r => r.id !== req.id)
      : swapRequests.map(r => r.id === req.id ? { ...r, status: 'Rejected' } : r);

    // 💡 修正點 2：撤回與刪除時，也一併呼叫升級版的 unlockDate 傳入完整的 req 進行整段解鎖！
    const nextEmps = unlockDate(req.participants, req);

    setSwapRequests(nextRequests);
    saveData({ swapRequests: nextRequests, employees: nextEmps });
  }
};

// 💡 在 main 組件內部的 handle 函式區域新增
const handleParticipantApprove = (reqId) => {
  const nextRequests = swapRequests.map(req => {
    if (req.id === reqId) {
      // 1. 更新當前登入者的簽核狀態
      const nextApprovals = (req.approvals || []).map(a => 
        a.id === currentUser.id 
          ? { ...a, status: 'Approved', updatedAt: new Date().toISOString() } 
          : a
      );
      
      // 2. 檢查是否除了發起人以外的所有參與者都簽完了
      const allOthersApproved = nextApprovals.every(a => a.status === 'Approved');
      
      return {
        ...req,
        approvals: nextApprovals,
        // 💡 如果全員簽完，狀態轉為 'PendingAdmin' 送交主管
        status: allOthersApproved ? 'PendingAdmin' : 'WaitingParticipants'
      };
    }
    return req;
  });
  
  setSwapRequests(nextRequests);
  saveData({ swapRequests: nextRequests });
};

    const exportScheduleCSV = (prefix = "") => {
    const rt = toROCTitle(currentMonth), fp = prefix ? `${prefix}_` : "";
    let csv = `\ufeff醫院藥劑部 ${rt} 班表,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,\n`; csv += "員編,姓名," + daysInMonth.map(d => `${d.day}(${d.dayOfWeek})`).join(",") + "\n";
    employees.forEach(emp => { if (emp.isSeparator) return; let row = [emp.id, emp.name]; daysInMonth.forEach(d => row.push(schedule[currentMonth]?.[emp.name]?.[d.day] || "-")); csv += row.join(",") + "\n"; });
    const b = new Blob([csv], { type: 'text/csv;charset=utf-8' }), l = document.createElement("a"); l.href = URL.createObjectURL(b); l.download = `${fp}班表_${currentMonth}.csv`; l.click();
  };

  return (
    <div className="flex flex-col h-screen bg-white font-sans text-gray-900 overflow-hidden">
      <Header currentMonth={currentMonth} setCurrentMonth={setCurrentMonth} currentPage={currentPage} handlePageChange={handlePageChange} isLoggedIn={isLoggedIn} currentUser={currentUser} handleLogout={()=>{setIsLoggedIn(false); setCurrentUser(null); setCurrentPage('home');}} exportScheduleCSV={exportScheduleCSV} swapRequests={swapRequests} isDirty={isDirty} />
      <main className="flex-grow flex flex-col overflow-hidden">
        {(() => {
          switch (currentPage) {
            case 'home': return <ScheduleTableView currentMonth={currentMonth} employees={employees} schedule={schedule} cellColors={cellColors} daysInMonth={daysInMonth} swapRequests={swapRequests} currentPage={currentPage} currentUser={currentUser} />;
            case 'account': return <AccountManagementView employees={employees} setEmployees={(val) => { setEmployees(val); saveData({ employees: val });}} setDeleteTarget={setDeleteTarget} />;
            case 'shifts': return <ShiftsManagementView shifts={shifts} setShifts={(val) => { setShifts(val); saveData({ shifts: val }); }}  holidays={holidays} setHolidays={(val) => { setHolidays(val); saveData({ holidays: val }); }}  setDeleteShiftTarget={setDeleteShiftTarget} personDayRules={personDayRules}  setPersonDayRules={(val) => { setPersonDayRules(val); saveData({ personDayRules: val }); }} />;
            case 'swap': return <ScheduleTableView currentMonth={currentMonth} employees={employees} schedule={schedule} cellColors={cellColors} daysInMonth={daysInMonth} onCellClick={handleSwapApply} swapRequests={swapRequests} currentPage={currentPage} currentUser={currentUser} swapTarget={swapTarget} handleSwapBack={handleSwapBack} isCycleEnd={isCycleEnd}/>;
            case 'records': return <RecordsView currentUser={currentUser} swapRequests={swapRequests} onAction={handleRecordAction} onApprove={handleParticipantApprove} setRejectingReq={setRejectingReq} schedule={schedule} currentMonth={currentMonth} />;
            case 'leave':  return  <PreLeaveView currentMonth={currentMonth} employees={employees} daysInMonth={daysInMonth} currentUser={currentUser} schedule={schedule} setSchedule={(val) => { setSchedule(val); saveData({ schedule: val }); }} preLeaveData={preLeaveData} setPreLeaveData={(val) => { setPreLeaveData(val); saveData({ preLeaveData: val }); }} saveData={saveData} />;
            case 'schedule': return <SchedulingView currentMonth={currentMonth} employees={employees} daysInMonth={daysInMonth} schedule={schedule} setSchedule={setSchedule} cellColors={cellColors} setCellColors={setCellColors} shifts={shifts} exportScheduleCSV={exportScheduleCSV} setCurrentPage={setCurrentPage} setIsDirty={setIsDirty} saveData={saveData} preLeaveData={preLeaveData}  setPreLeaveData={setPreLeaveData}  isAdmin={currentUser?.role === '0'}/> ;
            case 'report': return <ManagementReportView currentMonth={currentMonth} employees={employees} schedule={schedule} personDayRules={personDayRules} holidays={holidays} shifts={shifts} cellColors={cellColors}/>;
            case 'login': {
              const triggerLogin = () => { const id = document.getElementById('uid')?.value.toUpperCase(); const pwd = document.getElementById('upwd')?.value; if (!pwd) { alert("請輸入密碼！"); return; } handleLoginAction(id, pwd); };
              return (<div className="flex flex-col items-center justify-center min-h-[60vh] p-4"><div className="bg-white p-10 rounded-[2.5rem] shadow-2xl border max-w-sm w-full text-center"><h2 className="text-xl font-black mb-2 text-gray-800">藥劑部 班表系統登入</h2><div className="text-[10px] text-gray-400 font-bold mb-8">第一次輸入的密碼會自動設定為密碼</div><div className="space-y-4"><input className="w-full border-2 p-3 rounded-2xl outline-none font-mono text-center uppercase" placeholder="員編" id="uid" onInput={(e) => e.target.value = e.target.value.toUpperCase()} onKeyDown={(e) => e.key === 'Enter' && triggerLogin()} /><div className="relative"><input className="w-full border-2 p-3 rounded-2xl outline-none text-center" type={showPassword ? "text" : "password"} placeholder="密碼" id="upwd" onKeyDown={(e) => e.key === 'Enter' && triggerLogin()} /><button onClick={()=>setShowPassword(!showPassword)} className="absolute right-4 top-4 text-gray-400">{showPassword ? <Eye size={18}/> : <EyeOff size={18}/>}</button></div><button onClick={triggerLogin} className="w-full bg-blue-600 text-white p-3 rounded-2xl font-black shadow transition-all transform active:scale-95">進入系統</button></div></div><div className="mt-12 text-[11px] text-gray-400 font-bold tracking-wider">© 2026 NTUH Yunlin Pharmacy - V1.8</div></div>);
            }
            default: return null;
          }
        })()}
      </main>
      <Modal isOpen={showExitConfirm} onClose={() => { setShowExitConfirm(false); setTargetPage(null); }} onConfirm={confirmExit} title="班表尚未發佈" message="您有變更排班表，但尚未「發佈班表」。確定要離開嗎？" confirmText="仍要離開" cancelText="留在這裏" />
      
      {/* 💡 這是臨時加的緊急解鎖按鈕，清空舊資料後就可以整段刪除 */}
      {/*<button
        onClick={() => {
          const nextEmps = employees.map(e => ({ ...e, applyingDates: [] }));
          setEmployees(nextEmps);
          if (currentUser) setCurrentUser(prev => ({ ...prev, applyingDates: [] }));
          saveData({ employees: nextEmps });
          alert("✅ 系統中所有卡住的日期鎖已全面解除！請重新測試。");
        }}
        className="bg-red-500 text-white px-3 py-1 rounded-lg text-sm font-bold shadow-md hover:bg-red-600 transition-all z-50 mb-4 ml-4"
      >
        🚨 緊急強制解鎖
      </button> */}
      
      <SwapRequestModal 
        // 1. 狀態與基礎資料 (確保 isOpen 只出現一次)
        isOpen={isModalOpen && !!swapTarget}  
        data={swapTarget} 
        schedule={schedule} 
        currentMonth={currentMonth}

        // 2. 視窗控制權限 (確保 setIsModalOpen 只出現一次)
        setIsModalOpen={setIsModalOpen}
        
        // 3. 動作函式
        handleSwapBack={handleSwapBack} 

        // 4. 取消/關閉邏輯
        onClose={() => { 
          setSwapTarget(null); 
          setIsModalOpen(false); 
        }} 

        // 5. 確認/送出邏輯
        onConfirm={() => {
          const targetDateStr = swapTarget.date;
          
          // 💡 建立參與者的簽核名單 (排除申請人自己)
          const approvalList = swapTarget.participants
            .filter(p => p.id !== currentUser.id)
            .map(p => ({
              id: p.id,
              name: p.name,
              status: 'Pending', // 預設為待簽核
              updatedAt: null
            }));

          const nextRequests = [
            {
              id: Date.now().toString(),
              type: swapTarget.isBundle ? 'Bundle' : 'Single',
              status: 'WaitingParticipants', // 💡 狀態改為：等待參與者核定
              date: targetDateStr,
              participants: swapTarget.participants,
              approvals: approvalList, // 💡 新增簽核進度追蹤
              createdAt: new Date().toISOString(),
              creatorId: swapTarget.creatorId,
              creatorName: swapTarget.creatorName,
              isBundle: swapTarget.isBundle,
              startDate: swapTarget.startDate,
              endDate: swapTarget.endDate,
              daysToSwap: swapTarget.daysToSwap
            },
            ...swapRequests
          ];

          // 💡 1. 產生需要上鎖的完整日期陣列 (單日或整段)
          let datesToLock = [targetDateStr];
          if (swapTarget.isBundle && swapTarget.daysToSwap) {
            const monthPrefix = targetDateStr.substring(0, 7); // 取得 "YYYY-MM"
            datesToLock = swapTarget.daysToSwap.map(d => `${monthPrefix}-${String(d).padStart(2, '0')}`);
          }

          // 💡 2. 將整組陣列寫入同仁狀態中上鎖
          const allParticipantIds = swapTarget.participants.map(p => p.id);
          const nextEmps = employees.map(e => {
            if (allParticipantIds.includes(e.id)) {
              const dates = Array.isArray(e.applyingDates) ? e.applyingDates : [];
              // 合併原本的鎖與新的鎖，並去除重複
              const newDates = Array.from(new Set([...dates, ...datesToLock]));
              return { ...e, applyingDates: newDates };
            }
            return e;
          });

          setSwapRequests(nextRequests);
          setEmployees(nextEmps);
          const updatedMe = nextEmps.find(e => e.id === currentUser.id);
          if (updatedMe) setCurrentUser(updatedMe);

          saveData({ swapRequests: nextRequests, employees: nextEmps });
          setSwapTarget(null);
          setIsModalOpen(false);
        }}
      />
      {/* 以下 Modal 維持不變 */}
      <Modal 
        isOpen={!!rejectingReq} 
        onClose={()=>setRejectingReq(null)} 
        onConfirm={()=>{ 
          // 1. 更新單據狀態為被主管拒絕 (Rejected)
          const nextRequests = swapRequests.map(r => r.id === rejectingReq.id ? { ...r, status: 'Rejected', adminNote: rejectNote || "管理員否決" } : r);
          
          // 2. 💡 補上解鎖邏輯：找出這張單子的所有人與日期
          const participantsToUnlock = rejectingReq.participants 
            ? rejectingReq.participants.map(p => p.id) 
            : [rejectingReq.creatorId, rejectingReq.targetId];
          
          // 💡 3. 產生需要解鎖的完整日期陣列
          let datesToUnlock = rejectingReq.date ? [rejectingReq.date] : [];
          if (rejectingReq.isBundle && Array.isArray(rejectingReq.daysToSwap) && rejectingReq.date) {
            const monthPrefix = rejectingReq.date.substring(0, 7);
            datesToUnlock = rejectingReq.daysToSwap.map(d => `${monthPrefix}-${String(d).padStart(2, '0')}`);
          }

          // 💡 4. 產出解鎖後的全新 employees 陣列
          const nextEmps = employees.map(e => {
            if (participantsToUnlock.includes(e.id)) {
              const currentDates = e.applyingDates || [];
              return { ...e, applyingDates: currentDates.filter(d => !datesToUnlock.includes(d)) };
            }
            return e;
          });

          // 4. 同步更新所有狀態
          setSwapRequests(nextRequests);
          setEmployees(nextEmps); // 🔥 確保管理員點選時也更新全域同仁狀態

          // 5. 同步更新目前登入者狀態（如果管理員自己也在換班名單內）
          if (currentUser && participantsToUnlock.includes(currentUser.id)) {
            setCurrentUser(prev => ({
              ...prev,
              applyingDates: (prev.applyingDates || []).filter(d => !datesToUnlock.includes(d))
            }));
          }
          // 6. 寫入資料庫並關閉視窗
          saveData({ swapRequests: nextRequests, employees: nextEmps }); // 🔥 這裡一定要把解鎖後的 nextEmps 存進去
          setRejectNote(""); 
          setRejectingReq(null); 
        }} 
        title="否決換班申請" 
        confirmText="確認否決"
      >
        <textarea className="w-full border-2 rounded-2xl p-3 text-sm outline-none" placeholder="原因..." rows={3} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} />
      </Modal>
      <Modal isOpen={!!deleteTarget} onClose={()=>setDeleteTarget(null)} onConfirm={()=>{const next = employees.filter(e=>e.id!==deleteTarget.id); setEmployees(next); saveData({ employees: next }); setDeleteTarget(null)}} title="確定刪除人員？" message="移除該人員將影響本期報表。" />
      <Modal isOpen={!!deleteShiftTarget} onClose={()=>setDeleteShiftTarget(null)} onConfirm={()=>{const next = shifts.filter(s=>s.id!==deleteShiftTarget.id); setShifts(next); saveData({ shifts: next }); setDeleteShiftTarget(null)}} title="確定刪除班別？" message={`移除 ${deleteShiftTarget?.name}。`} />    </div>
  );
};

export default App;

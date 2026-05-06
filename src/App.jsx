import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, onSnapshot, collection, query, updateDoc, deleteDoc } from 'firebase/firestore';
import { 
  Home, UserCog, CalendarRange, ArrowLeftRight, Clock, LayoutGrid, Download, Upload, LogIn, LogOut,
  GripVertical, Plus, Trash2, Save, UserPlus, AlertCircle, Calendar as CalendarIcon, CheckCircle2,
  XCircle, Undo2, Redo2, Copy, FileText, SeparatorHorizontal, Info, ChevronLeft, ChevronRight, PaintBucket,
  Eye, EyeOff, ShieldCheck, ShieldAlert, BarChart3, History, Search, Check, X, ClipboardList, MessageSquare, User, Circle, Settings, Dice5, Lock, TrendingUp, Calculator
} from 'lucide-react';

// --- 常數定義與初始資料 ---
// 版本記錄：V1.7.10 - 深度重構連續換班校驗：僅校驗 Target 並相容 P#/P 變化
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
  apiKey: "AIzaSyCJ4U76sXFSc-eJsmRLnUgknNyV1V2Ll4Q",
  authDomain: "workforce-scheduling-software.firebaseapp.com",
  projectId: "workforce-scheduling-software",
  storageBucket: "workforce-scheduling-software.firebasestorage.app",
  messagingSenderId: "133587868564",
  appId: "1:133587868564:web:e306d0a59a2365622acd81",
  measurementId: "G-1EY4R8TBFJ"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'pharmacy-system-v1-7';

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

const SwapRequestModal = ({ isOpen, onClose, onConfirm, data }) => {
  if (!isOpen || !data) return null;
  const isBundle = data.isBundle;
  return (
    <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black bg-opacity-60 p-4 font-sans backdrop-blur-md">
      <div className="bg-white rounded-3xl shadow-2xl max-sm w-full overflow-hidden animate-in slide-in-from-bottom duration-300">
        <div className="bg-gradient-to-r from-cyan-600 to-blue-700 p-6 text-white text-center">
          <ArrowLeftRight className="mx-auto mb-2" size={32}/>
          <h3 className="text-xl font-black">換班申請</h3>
          {isBundle && <span className="inline-block mt-1 bg-yellow-400 text-blue-900 text-[10px] px-2 py-0.5 rounded-full font-black animate-pulse">整段換班</span>}
          <p className="text-blue-100 text-xs mt-1">需經同仁與組長核定</p>
        </div>
        <div className="p-6 space-y-4">
          <div className="text-center bg-gray-50 p-3 rounded-2xl border border-dashed font-bold text-blue-800">
            {isBundle ? `${data.startDate} ~ ${data.endDate}` : `${data.date} (${data.dayOfWeek})`}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1 text-center border-r border-gray-100">
              <label className="text-[10px] font-bold text-blue-500 uppercase tracking-tighter">申請人</label>
              <div className="font-black text-gray-700 leading-none py-1">{data.creatorName}</div>
              <div className="bg-blue-50 text-blue-700 rounded-lg py-2 mt-1 font-mono text-xs border border-blue-100 font-black">{data.creatorShift}</div>
            </div>
            <div className="space-y-1 text-center">
              <label className="text-[10px] font-bold text-cyan-600 uppercase tracking-tighter">欲換班同仁</label>
              <div className="font-black text-gray-700 leading-none py-1">{data.targetName}</div>
              <div className="bg-cyan-50 text-cyan-700 rounded-lg py-2 mt-1 font-mono text-xs border border-cyan-100 font-black">{data.targetShift}</div>
            </div>
          </div>
          {isBundle && <div className="text-[10px] text-gray-400 text-center italic bg-gray-50 p-2 rounded-xl">注意：系統將自動對調該整段週期之班別</div>}
        </div>
        <div className="p-6 pt-0 flex gap-3">
          <button onClick={onClose} className="flex-grow py-3 text-sm font-bold text-gray-400 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors">取消</button>
          <button onClick={onConfirm} className="flex-grow py-3 text-sm font-bold text-white bg-blue-600 rounded-xl shadow-lg hover:bg-blue-700 active:scale-95 transition-all">送出申請</button>
        </div>
      </div>
    </div>
  );
};

const Header = ({ currentMonth, setCurrentMonth, currentPage, handlePageChange, isLoggedIn, currentUser, handleLogout, exportScheduleCSV, swapRequests }) => {
  const isAdmin = currentUser?.role === '0';
  const hasPending = useMemo(() => {
    if (!isLoggedIn || !currentUser) return false;
    return swapRequests.some(req => {
      if (isAdmin) return req.status === 'PendingAdmin';
      return (req.targetId === currentUser.id && req.status === 'PendingTarget');
    });
  }, [swapRequests, isLoggedIn, currentUser, isAdmin]);

  return (
    <header className="bg-white border-b-2 border-gray-800 p-2 sm:p-3 sticky top-0 z-[100] shadow-md">
      <div className="max-w-full flex flex-col lg:flex-row lg:items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xs font-black text-gray-800 border-r-2 border-gray-300 pr-4 leading-none cursor-pointer" onClick={() => handlePageChange('home')}>台大雲林藥劑部班表 <span className="text-[10px] text-gray-400 font-normal ml-1">V1.7.10</span></h1>
          <div className="flex items-center gap-2">
            <input type="month" value={currentMonth} onChange={(e) => setCurrentMonth(e.target.value)} className="border-2 border-gray-300 rounded px-1.5 py-0.5 text-xs font-bold focus:border-blue-500 outline-none" />
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

const ScheduleTableView = ({ currentMonth, employees, schedule, cellColors, daysInMonth, onCellClick, swapRequests = [], currentPage, currentUser }) => {
  const isHome = currentPage === 'home';
  const isSwap = currentPage === 'swap';
  
// 計算提示條是否存在，若存在則標頭要往下壓 (提示條高度約為 44px)
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

      {/* 修改 3: 這裡才是真正會捲動的容器 */}
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

                    return (
                      <td key={d.day} 
                        className={`border p-0 ${isNC ? 'h-[32px]' : 'h-10'} ${bgClass} ${onCellClick && !isNC ? 'cursor-pointer hover:bg-blue-50 shadow-inner' : 'cursor-default'} transition-all relative ${cycleEnd ? 'border-r-4 border-r-gray-400' : ''}`} 
                        onClick={() => onCellClick && !isNC && onCellClick(emp, d)}>
                        <div className={`flex flex-col items-center justify-center h-full relative`}>
                          {isPendingSwap && (
                            <div className="absolute -top-3 -right-0.5 w-2 h-2 bg-blue-600 rounded-full animate-pulse shadow-sm z-10" title="換班申請中"></div>
                          )}
                          <span className={`${isSwap ? 'font-normal' : (isHome ? 'font-medium' : 'font-black')} ${isPendingSwap ? 'text-blue-900 scale-105 drop-shadow-sm' : (displayPart === "-" ? 'text-gray-300' : 'text-gray-800')} text-[13px] transition-all`}>{displayPart}</span>
                          {leaveMsg && <span className="text-[9px] text-red-600 font-black bg-red-50 rounded px-1.5 mt-1 leading-none shadow-sm">{leaveMsg}</span>}
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


  const handleLottery = () => {
    if (isMonthDrawn) return;
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
    saveData({ schedule: nextSched, preLeaveData: nextPreLeave });
    
    setTimeout(() => {
      alert(`${currentMonth} 抽籤完成！結果已同步至雲端，請手動下載備份。`);
    }, 100);
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
                         isApplied ? <span className="text-orange-700 font-black text-[11px]">預假</span> : null}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-white border-t-2 shadow-[0_-2px_5px_rgba(0,0,0,0.05)]">
            <tr className="bg-white border-b">
              <td className="sticky left-0 z-40 bg-white border p-1 font-bold text-gray-400 text-[10px]">預假名單</td>
              {daysInMonth.map(d => {
                const list = getLeaveList(d.day);
                return (
                  <td key={d.day} className={`border p-1 align-top h-20 overflow-y-auto bg-blue-50/30 ${isCycleEnd(d.fullDate) ? 'border-r-4 border-r-gray-500' : ''}`}>
                    <div className="flex flex-col gap-0.5">
                      {list.map((name, i) => {
                        const isWinner = schedule[currentMonth]?.[name]?.[d.day] === "休";
                        return (
                          <div key={i} className={`text-[9px] font-black text-center leading-none truncate border rounded py-1 shadow-sm ${isWinner ? 'bg-green-700 text-white border-green-800' : 'bg-white text-blue-500 border-blue-100'}`}>
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
            <Download size={14}/> 橫式 CSV 備份
          </button>
        </div>
      </div>
    </div>
  );
};

const RecordsView = ({ currentUser, swapRequests, onAction, schedule, currentMonth }) => {
  const [dateRange, setDateRange] = useState({ 
    start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], 
    end: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] 
  });
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, req: null, action: '' });
  const isAdmin = currentUser?.role === '0';

  const pendingList = useMemo(() => swapRequests.filter(req => req.status !== 'Approved' && req.status !== 'Rejected' && req.status !== 'Deleted' && (isAdmin || req.creatorId === currentUser.id || req.targetId === currentUser.id)).sort((a,b)=>a.timestamp - b.timestamp), [swapRequests, isAdmin, currentUser]);
  const historyList = useMemo(() => swapRequests.filter(req => (req.status === 'Approved' || req.status === 'Rejected' || req.status === 'Deleted') && req.date >= dateRange.start && req.date <= dateRange.end && (isAdmin || req.creatorId === currentUser.id || req.targetId === currentUser.id)).sort((a,b)=>b.timestamp - a.timestamp), [swapRequests, isAdmin, currentUser, dateRange]);

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
    const steps = [
      { id: '1', label: '申請人', active: true, color: 'bg-green-500' },
      { id: '2', label: '同仁核定', active: req.status !== 'PendingTarget', color: (isRejected && !req.adminNote) ? 'bg-red-500' : 'bg-green-500' },
      { id: '3', label: '組長核定', active: req.status === 'Approved' || (isRejected && req.adminNote), color: (isRejected && req.adminNote) ? 'bg-red-500' : 'bg-green-500' }
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
            {idx < steps.length - 1 && <div className={`h-[1px] w-6 mb-3 ${steps[idx+1].active ? steps[idx+1].color : 'bg-gray-100'}`}></div>}
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

              return (
                <div key={req.id} className="bg-white p-4 rounded-2xl shadow-sm border border-l-4 border-l-indigo-400 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-blue-600 text-base">{req.isBundle ? `${req.startDate}~${req.endDate}` : req.date}</span>
                      {req.isBundle && <span className="text-[9px] bg-yellow-100 text-yellow-700 px-1.5 rounded font-black">整段</span>}
                    </div>
                    <div className="text-[11px] font-bold text-gray-700 flex flex-wrap items-center gap-1">
                      <span className="text-blue-500">{req.creatorName} ({req.creatorShift})</span> 
                      <span className="text-gray-300 mx-1">⇄</span> 
                      <span className="text-cyan-600">{req.targetName} ({req.targetShift})</span>
                      <span className="text-[10px] text-gray-400 font-normal ml-2">🕒 送出: {new Date(req.timestamp).toLocaleString()}</span>
                    </div>
                    <StatusProgress req={req}/>
                    {isShiftMismatched && (
                      <div className="mt-2 text-[10px] bg-red-50 text-red-600 p-2 rounded-lg font-black border border-red-100 flex items-center gap-2 animate-pulse">
                        <AlertCircle size={14}/> 班別已更換，請再次確認換班內容
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 w-full sm:w-auto mt-2 sm:mt-0">
                    {((req.status === 'PendingTarget' && req.targetId === currentUser.id) || (isAdmin && req.status === 'PendingAdmin')) && (
                      <div className="flex gap-2 w-full">
                        <button onClick={() => triggerAction(req, 'Reject')} className="flex-1 sm:flex-none px-4 py-2 bg-red-50 text-red-600 text-xs font-black rounded-xl hover:bg-red-100 flex items-center justify-center gap-1 transition-all"><X size={14}/> 否決</button>
                        {!isShiftMismatched && (
                          <button onClick={() => triggerAction(req, 'Approve')} className="flex-1 sm:flex-none px-4 py-2 bg-blue-600 text-white text-xs font-black rounded-xl hover:bg-blue-700 flex items-center justify-center gap-1 shadow-md transition-all"><Check size={14}/> 核定</button>
                        )}
                      </div>
                    )}
                    {req.creatorId === currentUser.id && req.status === 'PendingTarget' && (<button onClick={() => triggerAction(req, 'Delete')} 
                    className="w-full sm:w-auto px-4 py-2 bg-gray-600 text-white hover:bg-gray-700 rounded-xl transition-all font-bold text-xs shadow-sm">撤回申請</button>)}
                  </div>
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
                        <div className="text-[9px] text-gray-400">申請: {new Date(req.timestamp).toLocaleDateString()}</div>
                      </td>
                      <td className="p-4 font-bold text-gray-700">
                        {req.creatorName}({req.creatorShift}) <span className="text-gray-300">⇄</span> {req.targetName}({req.targetShift})
                      </td>
                      <td className="p-4 text-center">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black shadow-sm ${req.status==='Approved'?'bg-green-100 text-green-600':req.status==='Rejected'?'bg-red-50 text-red-600':'bg-gray-100 text-gray-400'}`}>
                          {req.status==='Approved'?'已完成':req.status==='Rejected'?'已否決':'已撤回'}
                        </span>
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
      <div className="lg:col-span-8 bg-white rounded-3xl shadow border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b text-[10px] font-black uppercase text-gray-400">
            <tr><th className="p-4 w-10"></th><th className="p-4 text-left">員編</th><th className="p-4 text-left">姓名</th><th className="p-4 text-left">角色</th><th className="p-4 text-right">操作</th></tr>
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
                    <td className="p-4"><span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${emp.role === '0' ? 'bg-purple-100 text-purple-600' : emp.role === '1' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>{getRoleLabel(emp.role)}</span></td>
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
    <div className="p-4 max-w-full lg:max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6 font-sans text-sm">
      <div className="bg-white p-6 rounded-3xl shadow border flex flex-col">
        <h2 className="text-lg font-black mb-4 text-gray-800 flex items-center gap-2"><CalendarRange size={20}/> 班別代碼管理</h2>
        <form className="bg-gray-50 p-4 rounded-2xl border mb-6 space-y-4 shadow-inner" onSubmit={(e) => {
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
        <div className="max-h-96 overflow-auto rounded-xl border border-gray-100">
          <table className="w-full text-xs text-left">
            <thead className="bg-gray-50 border-b sticky top-0 z-10 font-black text-gray-400 uppercase tracking-tighter">
              <tr><th className="p-3">縮寫</th><th className="p-3">代碼</th><th className="p-3">常態規則</th><th className="p-3 text-right">操作</th></tr>
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

      <div className="space-y-6">
        <div className="bg-white p-6 rounded-3xl shadow border h-fit">
          <h2 className="text-lg font-black mb-4 text-pink-600 flex items-center gap-2"><CalendarIcon size={18}/> 國定假日管理</h2>
          <div className="flex gap-2 mb-6">
            <input type="date" className="flex-grow border-2 p-2 rounded-xl text-sm outline-none focus:border-pink-300" id="h_date" />
            <input type="text" className="flex-grow border-2 p-2 rounded-xl text-sm outline-none font-bold" placeholder="假日備註" id="h_note" />
            <button onClick={() => { const d = document.getElementById('h_date').value, n = document.getElementById('h_note').value; if (d && n) setHolidays({ ...holidays, [d]: n }); }} className="bg-pink-600 text-white px-4 py-2 rounded-xl font-bold shadow hover:bg-pink-700 active:scale-95 transition-all">新增</button>
          </div>
          <div className="max-h-64 overflow-auto rounded-xl border border-pink-100">
            <table className="w-full text-xs text-left"><thead className="bg-pink-50 border-b text-[10px] text-pink-700 font-black uppercase tracking-tighter"><tr><th className="p-3">日期</th><th className="p-3">備註</th><th className="p-3 text-right">操作</th></tr></thead>
              <tbody className="divide-y divide-pink-50">{Object.keys(holidays).sort().map(date => (<tr key={date} className="hover:bg-pink-50/30 transition-colors"><td className="p-3 font-mono text-gray-500">{date}</td><td className="p-3 font-black text-gray-700">{holidays[date]}</td><td className="p-3 text-right"><button onClick={() => { const next = { ...holidays }; delete next[date]; setHolidays(next); }} className="text-red-300 hover:text-red-600 transition-all"><Trash2 size={14}/></button></td></tr>))}
                {Object.keys(holidays).length === 0 && <tr><td colSpan="3" className="p-10 text-center text-gray-300 font-bold italic">尚無假日設定</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl shadow border h-fit relative">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-black text-teal-600 flex items-center gap-2"><TrendingUp size={18}/> 人日數設定區塊</h2>
            <div className="flex gap-1">
              <button onClick={() => ruleImportRef.current.click()} className="text-[10px] bg-gray-100 text-gray-600 px-2 py-1 rounded font-bold hover:bg-gray-200 transition-colors flex items-center gap-1"><Upload size={10}/> 匯入規則</button>
              <button onClick={handleExportRules} className="text-[10px] bg-gray-100 text-gray-600 px-2 py-1 rounded font-bold hover:bg-gray-200 transition-colors flex items-center gap-1"><Download size={10}/> 匯出規則</button>
              <input type="file" ref={ruleImportRef} className="hidden" accept=".csv" onChange={handleImportRules} />
            </div>
          </div>
          <form className="bg-gray-50 p-4 rounded-2xl border mb-6 space-y-4 shadow-inner" onSubmit={handleRuleSubmit}>
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
          <div className="max-h-64 overflow-auto rounded-xl border border-teal-100">
            <table className="w-full text-xs text-left">
              <thead className="bg-teal-50 border-b text-[10px] text-teal-700 font-black uppercase tracking-tighter">
                <tr><th className="p-3">模式</th><th className="p-3">對照關鍵字</th><th className="p-3">對應值</th><th className="p-3 text-right">操作</th></tr>
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
      const shiftObj = shifts.find(s => s.name === baseShiftName);
      const codeVal = shiftObj ? shiftObj.code : (baseShiftName === "#" ? "0" : (baseShiftName === "-" ? "1" : baseShiftName));
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

  const checkLaborCompliance = (emp, days) => {
    if (!isFourWeekMode) return true;
    const blocks = [days.slice(0, 14), days.slice(14, 28)];
    for (const block of blocks) {
      const codes = block.map(d => calculateCellValue(emp, d).display);
      const holidayCount = block.filter(d => !!d.holiday).length;
      const count0 = codes.filter(c => c === "0").length;
      const countMinus3 = codes.filter(c => c === "-3").length;
      if (emp.labor === 'N') { if (count0 !== 2 || countMinus3 !== 2) return false; }
      else if (emp.labor === 'Y') { if (count0 !== 4) return false; }
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

  const handleExportCSV = () => {
    const rtTitle = isFourWeekMode ? `28天報表(${startDate})` : `月報表(${currentMonth})`;
    const typeLabel = reportType === 'personDays' ? '人日數' : reportType === 'nightFee' ? '夜班費' : '班別代碼';
    let csv = `\ufeff藥劑部管理報表 - ${typeLabel} (${rtTitle}),,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,\n`;
    const headers = ["員編", "姓名", ...reportDays.map(d => `${d.day}(${d.dayOfWeek})`)];
    if (!isFourWeekMode && !isNightFeeMode) headers.push("總計");
    csv += headers.join(",") + "\n";
    filteredEmployees.forEach(emp => {
      let row = [emp.id, emp.name];
      let rowSum = 0;
      reportDays.forEach(d => {
        const res = calculateCellValue(emp, d);
        row.push(res.display); rowSum += res.numeric;
      });
      if (!isFourWeekMode && !isNightFeeMode) row.push(rowSum.toFixed(reportType === 'personDays' ? 1 : 0));
      csv += row.join(",") + "\n";
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `管理報表_${typeLabel}_${rtTitle}.csv`;
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
        <div className="flex items-center gap-3">
          {isFourWeekMode ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-black text-gray-400 uppercase tracking-tighter">起始日期</span>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="border-2 border-gray-300 rounded px-2 py-1 text-xs font-bold focus:border-blue-500 outline-none" />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-black text-gray-400 uppercase tracking-tighter">統計月份</span>
              <div className="bg-gray-100 border border-gray-200 px-3 py-1 rounded text-xs font-black text-gray-700">{currentMonth}</div>
            </div>
          )}
          <button onClick={handleExportCSV} className="bg-emerald-600 text-white px-4 py-1.5 rounded-xl text-xs font-black shadow-lg hover:bg-emerald-700 flex items-center gap-2 transition-all active:scale-95">
            <Download size={14}/> 匯出 CSV
          </button>
        </div>
      </div>
      <div className="flex-grow overflow-auto relative">
        <table className="w-full text-[12px] text-center border-separate border-spacing-0 table-fixed min-w-[1600px]">
          <thead className="sticky top-0 z-[50]">
            <tr className="bg-gray-100">
              <th className="sticky left-0 top-0 z-[55] bg-gray-100 border-r-2 border-b-2 border-gray-300 p-3 w-16 font-black text-[11px] shadow-[2px_0_5px_rgba(0,0,0,0.1)]">姓名</th>
              {reportDays.map((d, idx) => {
                const cycleEnd = isCycleEnd(d.fullDate);
                const isHoliday = d.rawDay === 0 || !!d.holiday;
                const isSat = d.rawDay === 6;
                return (
                  <th key={idx} className={`border-r border-b-2 border-gray-300 p-1 w-12 font-bold ${cycleEnd ? 'border-r-4 border-r-gray-400' : ''} ${isHoliday ? 'bg-[#FFB3D9]' : isSat ? 'bg-[#FFB366]' : 'bg-gray-100'}`}>
                    <div className="text-[10px] opacity-60">{d.dayOfWeek}</div><div className="text-base">{d.day}</div><div className="text-[9px] text-red-700 font-normal truncate h-3 mt-0.5" title={d.holiday}>{d.holiday}</div>
                  </th>
                );
              })}
              {!isFourWeekMode && !isNightFeeMode && (<th className="sticky right-0 top-0 z-[45] bg-[#E0F2F1] border-l-2 border-b-2 border-gray-300 p-3 w-20 font-black text-teal-700 shadow-[-2px_0_5px_rgba(0,0,0,0.05)]">總計</th>)}
            </tr>
          </thead>
          <tbody>
            {filteredEmployees.map(emp => {
              let rowSum = 0;
              const isCompliant = checkLaborCompliance(emp, reportDays);
              return (
                <tr key={emp.id} className="hover:bg-blue-50 transition-colors group">
                  <td className={`sticky left-0 z-40 bg-white border-r-2 border-b border-gray-200 p-2 font-black group-hover:bg-blue-50 text-[12px] truncate shadow-[2px_0_5px_rgba(0,0,0,0.05)] ${!isCompliant ? 'text-red-600' : ''}`}>
                    {emp.name}{!isCompliant && <div className="text-[8px] font-normal leading-none">⚠️ 例休</div>}
                  </td>
                  {reportDays.map((d, idx) => {
                    const res = calculateCellValue(emp, d); rowSum += res.numeric;
                    const cycleEnd = isCycleEnd(d.fullDate);
                    let bgClass = "bg-white";
                    if (d.rawDay === 0 || !!d.holiday) bgClass = "bg-[#FFB3D9]"; else if (d.rawDay === 6) bgClass = "bg-[#FFB366]";
                    return (
                      <td key={idx} className={`border-r border-b border-gray-200 p-0 h-10 ${bgClass} relative ${cycleEnd ? 'border-r-4 border-r-gray-400' : ''}`}>
                        <span className={`${(res.display === "" || res.display === "-" || res.display === "#" || res.display === "例") ? 'text-gray-300' : 'text-gray-800'} font-medium text-[13px]`}>{res.display}</span>
                      </td>
                    );
                  })}
                  {!isFourWeekMode && !isNightFeeMode && (
                    <td className="sticky right-0 z-30 bg-[#F1F8F7] border-l-2 border-b border-gray-200 p-2 font-black text-teal-800 group-hover:bg-[#E0F2F1] shadow-[-2px_0_5_rgba(0,0,0,0.05)] text-sm">
                      {rowSum > 0 ? rowSum.toFixed(reportType === 'personDays' ? 1 : 0) : "-"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const SchedulingView = ({ currentMonth, employees, daysInMonth, schedule, setSchedule, cellColors, setCellColors, shifts, exportScheduleCSV, setCurrentPage, setIsDirty, saveData }) => {
  const [editSched, setEditSched] = useState({});
  const [activeColor, setActiveColor] = useState('bg-white');
  const [importPreview, setImportPreview] = useState(null);
  const [ignoredCells, setIgnoredCells] = useState(new Set()); 
  const fileRef = useRef(null);

  useEffect(() => {
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
    setEditSched(newSched); setIsDirty(false);
  }, [currentMonth, employees, daysInMonth, schedule]);

  const handleImportCSV = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const rows = ev.target.result.split(/\r?\n/).map(r => r.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
      let fileMonth = null;
      for (const r of rows) { const line = r.join(","); if (line.includes("年") && line.includes("月")) { fileMonth = parseROCTitle(line); if (fileMonth) break; } }
      if (fileMonth !== currentMonth) { alert("CSV 標題月份與當前編輯月份不符。"); fileRef.current.value = ''; return; }
      const nextPreview = deepClone(editSched);
      const idPattern = /^[A-Z]\d+$/; 
      rows.forEach(rowCells => {
        rowCells.forEach((cell, cellIdx) => {
          if (idPattern.test(cell)) {
            const systemEmp = employees.find(e => e.id === cell);
            if (systemEmp && nextPreview[systemEmp.name]) {
              for (let d = 1; d <= daysInMonth.length; d++) {
                const shiftVal = rowCells[cellIdx + 1 + d];
                if (shiftVal !== undefined) nextPreview[systemEmp.name][d] = shiftVal || (getIsNightClinic(systemEmp) ? "" : "-");
              }
            }
          }
        });
      });
      setIgnoredCells(new Set()); setImportPreview(nextPreview);
    };
    reader.readAsText(file); e.target.value = '';
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
    if (!cellValue || cellValue === "-" || cellValue === "#" || cellValue === "例") return false;
    const regex = new RegExp(`(^|[/()#])${targetShiftName}($|[/()#])`);
    return regex.test(String(cellValue).trim());
  };

  const getMissingData = () => {
    const data = {};
    const allScheduledThisMonth = new Set();
    Object.values(editSched).forEach(empSched => {
      Object.values(empSched).forEach(v => { if (v && !["-", "#", "例", ""].includes(v)) allScheduledThisMonth.add(String(v)); });
    });
    const monthlyRules = shifts.filter(s => s.isRegular === 'Y' && s.regularDays.includes("月"));
    daysInMonth.forEach(d => {
      const scheduledOnDay = Object.values(editSched).map(u => u?.[d.day]);
      const required = shifts.filter(s => s.isRegular === 'Y' && !s.regularDays.includes("月") && (d.holiday ? s.regularDays.includes("國") : s.regularDays.includes(d.dayOfWeek)));
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
    alert("班表發佈完成！");
  };

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
        <div className="flex gap-2">
          {!importPreview && (
            <>
              <button onClick={() => fileRef.current.click()} className="bg-gray-800 text-white px-4 py-1.5 rounded text-xs font-bold flex items-center gap-1 hover:bg-black shadow"><Upload size={14}/> 上傳 CSV</button>
              <button onClick={handlePublishSchedule} className="bg-blue-600 text-white px-5 py-1.5 rounded text-xs font-bold shadow flex items-center gap-2 hover:bg-blue-700 transition-all"><CheckCircle2 size={16}/> 發佈班表</button>
            </>
          )}
          <input type="file" ref={fileRef} className="hidden" accept=".csv" onChange={handleImportCSV} />
        </div>
      </div>
      <div className="flex-grow overflow-auto relative p-4 select-none">
        <table className="w-full text-[11px] text-center border-separate border-spacing-0 table-fixed bg-white shadow-xl min-w-[1000px]">

      <thead>
        <tr className="bg-gray-50 border-b text-[10px]">
          <th className="sticky left-0 top-0 z-[100] bg-gray-100 p-2 w-20 font-black border-b-2 border-r-2 border-gray-200">姓名
          </th>
          {daysInMonth.map(d => {
            const cycleEnd = isCycleEnd(d.fullDate);
            let bgClass = "bg-gray-50";
            if (d.rawDay === 0 || d.holiday) bgClass = "bg-[#FFB3D9]";
            else if (d.rawDay === 6) bgClass = "bg-[#FFB366]";
            return (
              <th 
                key={d.day} 
                className={`sticky top-0 z-[90] p-1 w-12 font-bold border-b-2 border-r border-gray-200 ${bgClass} ${cycleEnd ? 'border-r-4 border-r-gray-400' : ''}`}>
                <div className="text-[10px] opacity-50">{d.dayOfWeek}</div>
                <div className="text-sm">{d.day}</div>
                <div className="text-[9px] text-red-600 truncate h-3 leading-none font-normal">{String(d.holiday || "")}</div>
              </th>
            );
          })}
        </tr>
      </thead>
          <tbody>
            {employees.map((emp) => {
              if (emp.isSeparator) return <tr key={emp.id} className="bg-gray-200 h-[1.5px]"><td colSpan={daysInMonth.length + 1}></td></tr>;
              const isNC = getIsNightClinic(emp);
              return (
                <tr key={emp.id} className="hover:bg-blue-50 border-b group transition-colors">
                  <td className="sticky left-0 z-10 bg-white border-r border-gray-200 p-2 font-black group-hover:bg-blue-50 shadow-[2px_0_5px_rgba(0,0,0,0.05)]">
                    {emp.name}
                  </td>
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
                    return (
                      <td key={d.day} className={`border p-0 ${isNC ? 'h-[32px]' : 'h-10'} relative ${bgClass} ${isCycleEnd(d.fullDate) ? 'border-r-4 border-r-gray-400' : ''} ${isConflict ? 'ring-2 ring-blue-500 ring-inset bg-blue-50' : ''}`}
                        onClick={() => {
                          if (importPreview && isConflict) { const n = new Set(ignoredCells); if (n.has(`${emp.name}-${d.day}`)) n.delete(`${emp.name}-${d.day}`); else n.add(`${emp.name}-${d.day}`); setIgnoredCells(n);
                          } else if (!importPreview) { const nc = deepClone(cellColors); if (!nc[currentMonth]) nc[currentMonth] = {}; if (!nc[currentMonth][emp.name]) nc[currentMonth][emp.name] = {}; nc[currentMonth][emp.name][d.day] = activeColor; setCellColors(nc);saveData({ cellColors: nc }); }
                        }}>
                        <input type="text" value={displayVal} disabled={!!importPreview} className={`w-full h-full text-center bg-transparent focus:bg-white outline-none font-bold font-mono cursor-text ${importPreview ? 'pointer-events-none opacity-80' : (displayVal === "-" ? 'text-gray-300' : 'text-gray-800')}`}
                          onChange={(e) => { if (!importPreview) { setEditSched(prev => ({ ...prev, [emp.name]: { ...prev[emp.name], [d.day]: e.target.value } })); setIsDirty(true); } }} />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
<tfoot className="bg-gray-50 border-t-2 border-gray-300">
  <tr>
    {/* 修正：移除 "sticky left-0" */}
    <td className="bg-gray-100 border p-1 text-[9px] font-black text-gray-400 text-center border-r-2">
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
  const isDateLocked = currentUser.applyingDates?.includes(targetDateStr);
  if (isDateLocked) {
    alert(`您在 ${targetDateStr} 已經有一筆換班申請正在流程中，請待該申請完成或撤回後，再發起同一天的申請。`);
    return;
  }
  const normalize = (v) => (v || "-").toString().trim() === "" ? "-" : (v || "-").toString().trim();
  const targetShift = normalize(schedule[currentMonth]?.[targetEmp.name]?.[dayInfo.day]);
  const myShift = normalize(schedule[currentMonth]?.[currentUser.name]?.[dayInfo.day]);
  
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
      const thu = new Date(sat); thu.setDate(sat.getDate() + 5);
      startDate = `${currentMonth}-${String(sat.getDate()).padStart(2, '0')}`;
      endDate = `${currentMonth}-${String(thu.getDate()).padStart(2, '0')}`;
      daysToSwap = []; for (let i = 0; i < 6; i++) { const d = new Date(sat); d.setDate(sat.getDate() + i); daysToSwap.push(d.getDate());  }
        }
      }

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
      isBundle,
      startDate,
      endDate,
      daysToSwap
    });
  };

const handleRecordAction = (req, action) => {
  const unlockDate = (empId, dateToRemove) => {
    const nextEmployees = employees.map(e => {
      if (e.id === empId) {
        const currentDates = e.applyingDates || [];
        return { ...e, applyingDates: currentDates.filter(d => d !== dateToRemove) };
      }
      return e;
    });
    setEmployees(nextEmployees);
    return nextEmployees;
  };

  if (action === 'Approve') {
    if (req.status === 'PendingTarget') {
      const nextRequests = swapRequests.map(r => r.id === req.id ? { ...r, status: 'PendingAdmin' } : r);
      setSwapRequests(nextRequests);
      saveData({ swapRequests: nextRequests });
    } 
    else if (req.status === 'PendingAdmin') {
      const nextStatus = 'Approved';
      const ns = deepClone(schedule);
      const targetMonthKey = req.date ? req.date.substring(0, 7) : currentMonth;
      
      if (!ns[targetMonthKey]) ns[targetMonthKey] = {};
      
      (req.isBundle ? req.daysToSwap : [req.day]).forEach(d => {
        const cS = ns[targetMonthKey][req.creatorName]?.[d] || "-";
        const tS = ns[targetMonthKey][req.targetName]?.[d] || "-";
        if (!ns[targetMonthKey][req.creatorName]) ns[targetMonthKey][req.creatorName] = {};
        if (!ns[targetMonthKey][req.targetName]) ns[targetMonthKey][req.targetName] = {};
        ns[targetMonthKey][req.creatorName][d] = tS;
        ns[targetMonthKey][req.targetName][d] = cS;
      });

      const nextRequests = swapRequests.map(r => r.id === req.id ? { ...r, status: nextStatus } : r);
      const nextEmps = unlockDate(req.creatorId, req.date);

      setSchedule(ns);
      setSwapRequests(nextRequests);
      saveData({ schedule: ns, swapRequests: nextRequests, employees: nextEmps });
    }
  } 
  else if (action === 'Reject' || action === 'Delete') {
    const nextRequests = (action === 'Delete') 
      ? swapRequests.filter(r => r.id !== req.id)
      : swapRequests.map(r => r.id === req.id ? { ...r, status: 'Rejected' } : r);

    const nextEmps = unlockDate(req.creatorId, req.date);

    setSwapRequests(nextRequests);
    saveData({ swapRequests: nextRequests, employees: nextEmps });

    if (currentUser && req.creatorId === currentUser.id) {
      setCurrentUser(prev => ({
        ...prev,
        applyingDates: (prev.applyingDates || []).filter(d => d !== req.date)
      }));
    }
  }
}; 
    const exportScheduleCSV = (prefix = "") => {
    const rt = toROCTitle(currentMonth), fp = prefix ? `${prefix}_` : "";
    let csv = `\ufeff醫院藥劑部 ${rt} 班表,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,\n`; csv += "員編,姓名," + daysInMonth.map(d => `${d.day}(${d.dayOfWeek})`).join(",") + "\n";
    employees.forEach(emp => { if (emp.isSeparator) return; let row = [emp.id, emp.name]; daysInMonth.forEach(d => row.push(schedule[currentMonth]?.[emp.name]?.[d.day] || "-")); csv += row.join(",") + "\n"; });
    const b = new Blob([csv], { type: 'text/csv;charset=utf-8' }), l = document.createElement("a"); l.href = URL.createObjectURL(b); l.download = `${fp}班表_${currentMonth}.csv`; l.click();
  };

  return (
    <div className="flex flex-col h-screen bg-white font-sans text-gray-900 overflow-hidden">
      <Header currentMonth={currentMonth} setCurrentMonth={setCurrentMonth} currentPage={currentPage} handlePageChange={handlePageChange} isLoggedIn={isLoggedIn} currentUser={currentUser} handleLogout={()=>{setIsLoggedIn(false); setCurrentUser(null); setCurrentPage('home');}} exportScheduleCSV={exportScheduleCSV} swapRequests={swapRequests} />
      <main className="flex-grow flex flex-col overflow-hidden">
        {(() => {
          switch (currentPage) {
            case 'home': return <ScheduleTableView currentMonth={currentMonth} employees={employees} schedule={schedule} cellColors={cellColors} daysInMonth={daysInMonth} swapRequests={swapRequests} currentPage={currentPage} currentUser={currentUser} />;
            case 'account': return <AccountManagementView employees={employees} setEmployees={(val) => { setEmployees(val); saveData({ employees: val });}} setDeleteTarget={setDeleteTarget} />;
            case 'shifts': return <ShiftsManagementView shifts={shifts} setShifts={(val) => { setShifts(val); saveData({ shifts: val }); }}  holidays={holidays} setHolidays={(val) => { setHolidays(val); saveData({ holidays: val }); }}  setDeleteShiftTarget={setDeleteShiftTarget} personDayRules={personDayRules}  setPersonDayRules={(val) => { setPersonDayRules(val); saveData({ personDayRules: val }); }} />;
            case 'swap': return <ScheduleTableView currentMonth={currentMonth} employees={employees} schedule={schedule} cellColors={cellColors} daysInMonth={daysInMonth} onCellClick={handleSwapApply} swapRequests={swapRequests} currentPage={currentPage} currentUser={currentUser} />;
            case 'records': return <RecordsView currentUser={currentUser} swapRequests={swapRequests} onAction={handleRecordAction} schedule={schedule} currentMonth={currentMonth} />;
            case 'leave':  return  <PreLeaveView currentMonth={currentMonth} employees={employees} daysInMonth={daysInMonth} currentUser={currentUser} schedule={schedule} setSchedule={(val) => { setSchedule(val); saveData({ schedule: val }); }} preLeaveData={preLeaveData} setPreLeaveData={(val) => { setPreLeaveData(val); saveData({ preLeaveData: val }); }}   saveData={saveData} />;
            case 'schedule': return <SchedulingView currentMonth={currentMonth} employees={employees} daysInMonth={daysInMonth} schedule={schedule} setSchedule={setSchedule} cellColors={cellColors} setCellColors={setCellColors} shifts={shifts} exportScheduleCSV={exportScheduleCSV} setCurrentPage={setCurrentPage} setIsDirty={setIsDirty} saveData={saveData} /> ;
            case 'report': return <ManagementReportView currentMonth={currentMonth} employees={employees} schedule={schedule} personDayRules={personDayRules} holidays={holidays} shifts={shifts} />;
            case 'login': {
              const triggerLogin = () => { const id = document.getElementById('uid')?.value.toUpperCase(); const pwd = document.getElementById('upwd')?.value; if (!pwd) { alert("請輸入密碼！"); return; } handleLoginAction(id, pwd); };
              return (<div className="flex flex-col items-center justify-center min-h-[60vh] p-4"><div className="bg-white p-10 rounded-[2.5rem] shadow-2xl border max-w-sm w-full text-center"><h2 className="text-xl font-black mb-2 text-gray-800">藥劑部 班表系統登入</h2><div className="text-[10px] text-gray-400 font-bold mb-8">第一次輸入的密碼會自動設定為密碼</div><div className="space-y-4"><input className="w-full border-2 p-3 rounded-2xl outline-none font-mono text-center uppercase" placeholder="員編" id="uid" onInput={(e) => e.target.value = e.target.value.toUpperCase()} onKeyDown={(e) => e.key === 'Enter' && triggerLogin()} /><div className="relative"><input className="w-full border-2 p-3 rounded-2xl outline-none text-center" type={showPassword ? "text" : "password"} placeholder="密碼" id="upwd" onKeyDown={(e) => e.key === 'Enter' && triggerLogin()} /><button onClick={()=>setShowPassword(!showPassword)} className="absolute right-4 top-4 text-gray-400">{showPassword ? <Eye size={18}/> : <EyeOff size={18}/>}</button></div><button onClick={triggerLogin} className="w-full bg-blue-600 text-white p-3 rounded-2xl font-black shadow transition-all transform active:scale-95">進入系統</button></div></div><div className="mt-12 text-[11px] text-gray-400 font-bold tracking-wider">© 2026 NTUH Yunlin Pharmacy - V1.7.10</div></div>);
            }
            default: return null;
          }
        })()}
      </main>
      <Modal isOpen={showExitConfirm} onClose={() => { setShowExitConfirm(false); setTargetPage(null); }} onConfirm={confirmExit} title="班表尚未發佈" message="您有變更排班表，但尚未「發佈班表」。確定要離開嗎？" confirmText="仍要離開" cancelText="留在這裏" />
      <SwapRequestModal 
         isOpen={!!swapTarget}  
         onClose={() => setSwapTarget(null)} 
         onConfirm={() => { 
          const targetDateStr = swapTarget.date; 
          const nextRequests = [
           ...swapRequests, 
            { ...swapTarget, id: `REQ-${Date.now()}`, status: 'PendingTarget', timestamp: Date.now(), adminNote: "" }
          ];

           const nextEmps = employees.map(e => {
             if (e.id === currentUser.id) {
             const currentDates = e.applyingDates || [];
             return { ...e, applyingDates: [...currentDates, targetDateStr] };
          }
          return e;
          });

          setSwapRequests(nextRequests);
          setEmployees(nextEmps); 
          saveData({ swapRequests: nextRequests, employees: nextEmps });  

          setCurrentUser({ 
            ...currentUser, 
            applyingDates: [...(currentUser.applyingDates || []), targetDateStr] 
          });

          setSwapTarget(null);  
        }}  
        data={swapTarget} 
      />
       <Modal isOpen={!!rejectingReq} onClose={()=>setRejectingReq(null)} onConfirm={()=>{ const nextRequests = swapRequests.map(r => r.id === rejectingReq.id ? { ...r, status: 'Rejected', adminNote: rejectNote || "管理員否決" } : r); setSwapRequests(nextRequests); saveData({ swapRequests: nextRequests }); setRejectNote(""); setRejectingReq(null); }} title="否決換班申請" confirmText="確認否決"><textarea className="w-full border-2 rounded-2xl p-3 text-sm outline-none" placeholder="原因..." rows={3} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} /></Modal>
      <Modal isOpen={!!deleteTarget} onClose={()=>setDeleteTarget(null)} onConfirm={()=>{const next = employees.filter(e=>e.id!==deleteTarget.id); setEmployees(next); saveData({ employees: next }); setDeleteTarget(null)}} title="確定刪除人員？" message="移除該人員將影響本期報表。" />
      <Modal isOpen={!!deleteShiftTarget} onClose={()=>setDeleteShiftTarget(null)} onConfirm={()=>{const next = shifts.filter(s=>s.id!==deleteShiftTarget.id); setShifts(next); saveData({ shifts: next }); setDeleteShiftTarget(null)}} title="確定刪除班別？" message={`移除 ${deleteShiftTarget?.name}。`} />
    </div>
  );
};

export default App;

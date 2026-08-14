import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, getDocs, onSnapshot, collection, query, updateDoc, deleteDoc, runTransaction, deleteField } from 'firebase/firestore';
import {
  Home, UserCog, CalendarRange, ArrowLeftRight, Clock, LayoutGrid, Download, Upload, LogIn, LogOut,
  GripVertical, Plus, Trash2, Save, UserPlus, AlertCircle, Calendar as CalendarIcon, CheckCircle2,
  XCircle, Undo2, Redo2, Copy, FileText, SeparatorHorizontal, Info, ChevronLeft, ChevronRight, PaintBucket,
  Eye, EyeOff, ShieldCheck, ShieldAlert, BarChart3, History, Search, Check, X, ClipboardList, MessageSquare, User, Circle, Settings, Dice5, Lock, TrendingUp, KeyRound as ResetPasswordIcon
} from 'lucide-react';

// --- 常數定義與初始資料 ---
// 版本記錄：V1.9 - 修正多人並發資料覆蓋問題、Firestore 依月份分文件儲存、員工自助改密碼
const WEEKDAYS_MAP = ["日", "一", "二", "三", "四", "五", "六"];
const PALETTE = [
  { name: '白', class: 'bg-white'},
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
// =====================================================================================
// 💡 測試專用開關：
//    - 留空字串 "" → 正式環境行為（optional __app_id 或固定 'pharmacy-system-v1-8'）
//    - 填入例如 "pharmacy-system-TEST" → 不論在哪個環境測試，永遠固定使用這個路徑，
//      跟正式資料(pharmacy-system-v1-8)完全隔開，也不會受測試平台隨機注入的 __app_id 影響，
//      你可以直接去 Firebase Console 找 artifacts/pharmacy-system-TEST/... 這個固定路徑確認資料
//    測試完成、準備上線前，記得改回空字串 "" 再推上 GitHub！
// =====================================================================================
const FORCE_APP_ID_FOR_TESTING = "";

const rawAppId = FORCE_APP_ID_FOR_TESTING || (typeof __app_id !== 'undefined' ? __app_id : 'pharmacy-system-v1-8');
// 💡 修正：某些執行環境注入的 __app_id 本身可能帶有 "/" 或其他不能出現在 Firestore
// 文件路徑中的字元（例如 "c_xxx_src/App.jsx-489"），若直接拿來當路徑片段，
// Firestore 會把它誤判成多一層路徑，導致 "Invalid document reference... has 7" 之類的錯誤。
// 這裡統一把危險字元換成底線，確保 appId 永遠只是「單一路徑片段」。
const appId = rawAppId.replace(/[\/\s]+/g, '_');
// 💡 方便除錯：打開瀏覽器 Console 就能立刻確認目前連到哪個路徑，
// 若這裡顯示的不是你預期的 appId，代表資料寫到別的地方去了
console.log('[藥劑部班表系統] 目前使用的 Firestore 資料路徑 appId =', appId);

// --- 輔助函數 ---
const cleanBundleData = (source) => {
  if (!source) return source;

  // 檢查是否有 daysToSwap 且是陣列
  if (source.isBundle && Array.isArray(source.daysToSwap)) {
    // 檢查第一個元素。如果字串中不包含 "-"，代表它是舊的純數字格式（例如 [28, 29]）
    if (source.daysToSwap.length > 0 && !String(source.daysToSwap[0]).includes('-')) {

      // 取得基準月份 (例如 "2026-06")
      const monthPrefix = source.date ? source.date.substring(0, 7) : '2026-06'; 

      // 【舊轉新】自動把 [28, 29] 升級成 ["2026-06-28", "2026-06-29"]
      source.daysToSwap = source.daysToSwap.map(d => `${monthPrefix}-${String(d).padStart(2, '0')}`);
    }
  }
  return source;
};

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
                    {data.daysToSwap.map((dayStr) => {
                      // 1. 從 "YYYY-MM-DD" 中切出正確的 "YYYY-MM" (動態支援跨月/跨年)
                      const targetMonth = dayStr.substring(0, 7); 

                      // 2. 從 "YYYY-MM-DD" 中切出純數字的「日」(例如 "24" -> 24)
                      const dayNum = Number(dayStr.split('-')[2]);

                      return (
                        <tr key={dayStr} className="hover:bg-blue-50/50 transition-colors">
                          {/* 畫面維持顯示乾淨的數字：例如 24日 */}
                          <td className="py-2 font-black text-gray-500 bg-gray-50/50 border-r border-gray-100 w-12">{dayNum}日</td>
                          {data.participants.map((p, idx) => {
                            // 3. 💡 將原本的 [currentMonth] 改為 [targetMonth]，並用 [dayNum] 抓班別
                            // 徹底解決跨月跨年時，班別抓錯月份的問題！
                            const shift = schedule[targetMonth]?.[p.name]?.[dayNum] || "-";

                            // 抓取換班後會獲得的新班別
                            const nextPerson = data.participants[(idx + 1) % data.participants.length];
                            const nextShift = schedule[targetMonth]?.[nextPerson.name]?.[dayNum] || "-";

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
                    );})}
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

  return (
    <header className="bg-white border-b-2 border-gray-800 p-2 sm:p-3 sticky top-0 z-[100] shadow-md">
      <div className="max-w-full flex flex-col lg:flex-row lg:items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xs font-black text-gray-800 border-r-2 border-gray-300 pr-4 leading-none cursor-pointer" onClick={() => handlePageChange('home')}>台大雲林藥劑部班表 <span className="text-[10px] text-gray-400 font-normal ml-1">V1.9</span></h1>
          <div className="flex items-center gap-2">
            <input 
              type="month" 
              value={currentMonth} 

              // 💡 利用 currentPage 與 isDirty 進行防呆攔截，避免排班編輯到一半被切走
              onChange={(e) => {
                const nextMonthVal = e.target.value;
                if (!nextMonthVal) return;

                if (currentPage === 'schedule' && isDirty) {
                  const confirmLeave = window.confirm("⚠️ 偵測到目前月份的班表已有編輯內容、尚未發佈！\n\n點擊「確定」將會放棄目前的修改並切換月份，點擊「取消」則留在原月份。");
                  if (!confirmLeave) return; // 使用者按取消，直接阻斷月份切換
                }

                if (typeof setEditSched === 'function') setEditSched({});
                setCurrentMonth(nextMonthVal);
              }} 
              className="border-2 border-gray-300 rounded px-1.5 py-0.5 text-xs font-bold focus:border-blue-500 outline-none" 
            />
            {isLoggedIn && (
              <span className="text-[11px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-100 flex items-center gap-1">
                <User size={12}/> 哈囉, {currentUser.name}
              </span>
            )}
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
          <div className="ml-2 pl-2 border-l border-gray-300 flex items-center gap-1">
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
                      // 💡 修正關鍵：不論是單日還是連班，都統一用最精準的 fullDate 進行對應
                      (r.isBundle ? r.daysToSwap.includes(d.fullDate) : r.date === d.fullDate) &&
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
                                // 🔥 徹底拋棄 bundleDates 這個變數名稱，直接用新格式陣列進行判斷
                                isSelecting = swapTarget.daysToSwap.includes(d.fullDate);
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
                                  // 💡 修正關鍵：因為已經是新格式，直接檢查是否包含目前的完整日期，不再做多餘的宣告與 map 拼接！
                                  return req.daysToSwap.includes(d.fullDate);
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

 const PreLeaveView = ({ currentMonth, employees, daysInMonth, currentUser, schedule, setSchedule, preLeaveData, setPreLeaveData, savePreLeaveMonth, saveMetaPreLeave, saveScheduleMonth, runLotteryTransaction, resetMonthDraw }) => {
  const [defaultHolidayLimit, setDefaultHolidayLimit] = useState(10);
  const [defaultWeekdayLimit, setDefaultWeekdayLimit] = useState(3);
  const [lotteryDay, setLotteryDay] = useState(15);
  const isAdmin = currentUser?.role === '0';
  const isMonthDrawn = (preLeaveData.drawnMonths || []).includes(currentMonth);

  // ========================================================
  // 💡 對齊「每月 X 號 00:00 抽出下個月預假結果」的月份邏輯
  // ========================================================
  useEffect(() => {
    // 沒登入或還沒載入好預假資料就先不執行
    if (!currentUser || !preLeaveData) return;

    const handleAutoLotteryCheck = async () => {
      try {
        const now = Date.now(); // 取得當前時間毫秒數

        // 1. 抽籤日綁定 preLeaveData.lotteryDay (例如：15)
        const targetDay = preLeaveData.lotteryDay || 15;

        // 2. 💡 currentMonth 是同仁當前畫面切換到、準備要抽籤的「目標月份」（例如 "2026-06"）
        const [yearStr, monthStr] = currentMonth.split('-');
        const targetYear = parseInt(yearStr);
        const targetMonthNum = parseInt(monthStr); // 目標月份，例如 6

        // 3. 💡 往前推算「應該要執行抽籤的時間點」
        const executionDate = new Date(targetYear, targetMonthNum - 2, targetDay, 0, 0, 0);
        const drawTimeTimestamp = executionDate.getTime();

        // 4. 核心判定：如果「該目標月份尚未抽籤(!isMonthDrawn)」且「目前時間已過設定的執行時間」
        if (!isMonthDrawn && now >= drawTimeTimestamp) {
          console.log(`⏰ 偵測到時間已過截止點 (${executionDate.toLocaleString()})，系統自動為 ${currentMonth} 月份執行預假抽籤...`);
          await handleLottery({ isAuto: true });
          console.log(`🎉 ${currentMonth} 月份自動抽籤執行並存檔成功！`);
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
      // 💡 修正：只存「這個月」的 apps 資料，不再整包月份物件覆寫，避免互相蓋掉其他月份
      savePreLeaveMonth(currentMonth, { apps: next.apps[currentMonth] });
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
    savePreLeaveMonth(currentMonth, { apps: next.apps[currentMonth] });
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
    else if (type === 'lotteryDay') next.lotteryDay = value;
    setPreLeaveData(next);
    // 💡 修正：這些是「全域設定」（不分月份），存到 meta 文件，不要跟著整包月份資料一起覆寫
    saveMetaPreLeave({ weekendLimit: next.weekendLimit, weekdayLimit: next.weekdayLimit, lotteryDay: next.lotteryDay });
  };


  // 💡 修正版 handleLottery：整段抽籤邏輯已搬進 App 層的 runLotteryTransaction，
  // 用 Firestore Transaction 保護，並以「讀取當下」的雲端最新資料計算，
  // 不再用畫面上可能過期的本地 schedule / apps 去抽，也修正了先前把結果寫進
  // 錯誤路徑（schedule.schedule.xxx）導致抽籤結果消失的 bug。
  const handleLottery = async (e) => {
    if (isMonthDrawn) return;

    const isAuto = e && e.isAuto;

    if (!isAuto) {
      const confirmDraw = window.confirm("確定要立即手動抽籤嗎？抽籤後將會鎖定本月班表。");
      if (!confirmDraw) return;
    }

    const result = await runLotteryTransaction(currentMonth, daysInMonth, defaultHolidayLimit, defaultWeekdayLimit);

    if (!result?.ok) {
      if (result?.reason === 'already-drawn') {
        // 💡 代表在你按下按鈕的同一時間，已經有別的裝置搶先完成抽籤了，這是正常、預期內的保護行為
        if (!isAuto) alert(`${currentMonth} 剛好已被其他裝置完成抽籤，畫面即將自動更新結果，不會重複抽獎。`);
      } else if (!isAuto) {
        alert("抽籤失敗，請檢查網路連線後再試一次。");
      }
      return;
    }

    // 抽籤結果已經直接寫入雲端該月份文件，畫面會透過即時監聽自動更新，這裡不需要再手動 setSchedule/setPreLeaveData

    if (!isAuto) {
      setTimeout(() => {
        alert(`${currentMonth} 手動抽籤完成！結果已同步至班表。`);
      }, 100);
    }
  };
  const [isRulesExpanded, setIsRulesExpanded] = useState(false);

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
                  savePreLeaveMonth(currentMonth, { remarks: next.remarks[currentMonth] });
                }}
              className={`w-full bg-transparent text-[11px] font-bold text-purple-600 text-center outline-none resize-none overflow-hidden block ${(!isAdmin || isMonthDrawn) ? 'cursor-not-allowed opacity-70' : 'cursor-text'}`}
              style={{ fieldSizing: 'content', minHeight: '1.5em' }}
                  />
               </td>
              ))}
            </tr>
            <tr className="bg-[#E0F2F1] border-b">
              <td className="sticky left-0 z-40 bg-[#E0F2F1] border p-1 font-bold text-teal-700 text-[10px]">可休人數</td>
              {daysInMonth.map(d => {
                // 💡 嚴謹判斷：只有當該天明確有被設定過（且不是 undefined/null），才讀取個別設定
                const hasDailyLimit = preLeaveData.dailyLimits?.[currentMonth]?.[d.day] !== undefined && 
                                       preLeaveData.dailyLimits?.[currentMonth]?.[d.day] !== null;
                
                // 💡 使用 ?? 確保 0 也能被正確顯示，不會被誤判為 false
                const displayValue = hasDailyLimit 
                  ? preLeaveData.dailyLimits[currentMonth][d.day] 
                  : (d.rawDay === 0 || d.rawDay === 6 || d.holiday ? (preLeaveData.weekendLimit ?? 10) : (preLeaveData.weekdayLimit ?? 3));
            
                return (
                  <td key={d.day} className={`border p-1 font-bold text-teal-800 ${isCycleEnd(d.fullDate) ? 'border-r-4 border-r-gray-400' : ''}`}>
                    <input 
                      type="number" 
                      value={displayValue} 
                      disabled={!isAdmin || isMonthDrawn}
                      onChange={e => { 
                        // 💡 強制轉為整數，避免字串相加或型別錯誤
                        const val = parseInt(e.target.value) || 0;
                        const next = deepClone(preLeaveData); 
                        if(!next.dailyLimits) next.dailyLimits = {};
                        if(!next.dailyLimits[currentMonth]) next.dailyLimits[currentMonth] = {}; 
                        
                        // 寫入該日期的特別名額
                        next.dailyLimits[currentMonth][d.day] = val; 
                        
                        setPreLeaveData(next);
                        // 💡 修正：只存這個月的 dailyLimits，避免整包覆寫
                        savePreLeaveMonth(currentMonth, { dailyLimits: next.dailyLimits[currentMonth] });
                      }}
                      className={`w-full bg-transparent text-center font-bold text-teal-800 outline-none ${(!isAdmin || isMonthDrawn) ? 'cursor-not-allowed opacity-70' : 'cursor-text'}`}
                    />
                  </td>
                );
              })}
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
                      className={`border py-1.5 px-0 h-10 transition-all ${bgClass} ${cycleEnd ? 'border-r-4 border-r-gray-400' : ''} ${isApplied || isWinner ? 'ring-2 ring-inset ring-orange-400 shadow-inner' : ''} ${canToggle ? 'cursor-pointer hover:opacity-80' : 'cursor-not-allowed'}`}
                    >
                      <div className="flex flex-col items-center justify-center h-full">
                        {isFixed ? <span className="text-gray-500 font-bold opacity-60 text-xs">{sVal}</span> :
                         isWinner ? <span className="text-green-800 font-black text-[13px] bg-green-50 px-1 rounded">休</span> :
                         /* 💡 只有在『已完成抽籤』且『沒抽中』時才顯示『預假(未中)』；抽籤前一律顯示乾淨的『預假』 */
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
              <td className="sticky left-0 z-40 bg-white border p-1 font-bold text-gray-400 text-[10px]">預假名單</td>
              {daysInMonth.map(d => {
                const list = getLeaveList(d.day);
                return (
                  <td key={d.day} className={`border p-1 align-top h-20 overflow-y-auto bg-blue-50/30 ${isCycleEnd(d.fullDate) ? 'border-r-4 border-r-gray-500' : ''}`}>
                    <div className="flex flex-col gap-0.5">
                      {list.map((name, i) => {
                        const isWinner = schedule[currentMonth]?.[name]?.[d.day] === "休";
                        return (
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

      <div className="border-t bg-gray-50 shadow-inner relative">
        {/* 1. 抽籤鎖定提示 */}
        {isMonthDrawn && (
          <div className="absolute top-[-20px] left-1/2 transform -translate-x-1/2 bg-red-600 text-white px-6 py-1 rounded-t-xl font-black text-xs shadow-lg flex items-center gap-2 z-10 whitespace-nowrap">
            <Lock size={14}/> 本月已抽籤完畢，功能已鎖定
          </div>
        )}

        {/* 2. 標題列：點擊展開/收合 */}
        <div 
          className="p-3 flex items-center justify-between cursor-pointer hover:bg-gray-100 transition-colors"
          onClick={() => setIsRulesExpanded(!isRulesExpanded)}
        >
          <div className="flex items-center gap-2">
            <Settings size={18} className="text-gray-600"/>
            <span className="text-sm font-black text-gray-700">預假規範 {isRulesExpanded ? '▲' : '▼'}</span>
          </div>
          <span className="text-[9px] text-gray-400 font-bold bg-gray-200 px-2 py-0.5 rounded-full">
            {isMonthDrawn ? "已抽籤" : `每月 ${preLeaveData.lotteryDay || 15} 號抽`}
          </span>
        </div>

        {/* 3. 展開內容區 */}
        {isRulesExpanded && (
          <div className="p-3 pt-0 border-t border-gray-200 bg-white">
            <div className="flex flex-wrap gap-2 mt-3">
              <div className="flex-1 flex gap-2">
                <div className="flex-1 bg-gray-50 p-2 rounded-lg border border-gray-200">
                  <div className="text-[9px] font-black text-gray-400 mb-1">假日名額</div>
                  <input type="number" value={preLeaveData.weekendLimit || 10} onChange={e => handleAdminSettingChange('holiday', parseInt(e.target.value) || 0)} className="w-full bg-transparent font-bold text-blue-600 text-sm outline-none" disabled={!isAdmin || isMonthDrawn} />
                </div>
                <div className="flex-1 bg-gray-50 p-2 rounded-lg border border-gray-200">
                  <div className="text-[9px] font-black text-gray-400 mb-1">平日名額</div>
                  <input type="number" value={preLeaveData.weekdayLimit || 3} onChange={e => handleAdminSettingChange('weekday', parseInt(e.target.value) || 0)} className="w-full bg-transparent font-bold text-blue-600 text-sm outline-none" disabled={!isAdmin || isMonthDrawn} />
                </div>
                <div className="flex-1 bg-gray-50 p-2 rounded-lg border border-gray-200">
                  <div className="text-[9px] font-black text-gray-400 mb-1">抽籤日</div>
                  <input type="number" value={preLeaveData.lotteryDay || 15} onChange={e => handleAdminSettingChange('lotteryDay', parseInt(e.target.value) || 1)} className="w-full bg-transparent font-bold text-blue-600 text-sm outline-none" disabled={!isAdmin || isMonthDrawn} />
                </div>
              </div>

              <div className="flex w-full gap-2 mt-1">
                {!isMonthDrawn && isAdmin && (
                  <button onClick={handleLottery} className="flex-1 py-2 bg-red-500 text-white rounded-lg text-xs font-black shadow-sm active:scale-95 transition-transform">
                    <Dice5 size={14} className="inline mr-1"/>立即抽籤
                  </button>
                )}
                {isMonthDrawn && isAdmin && (
                  <button
                    onClick={() => {
                      const ok = window.confirm(
                        `⚠️ 即將解除「${currentMonth}」的抽籤鎖定，讓本月可以重新執行抽籤。\n\n` +
                        `不會刪除同仁的預假申請紀錄，但目前班表上已經標記為「休」的人會維持原樣，\n` +
                        `重新抽籤只會針對名額還沒抽滿的日期繼續抽出中籤者。\n\n` +
                        `確定要解鎖嗎？`
                      );
                      if (ok) resetMonthDraw(currentMonth);
                    }}
                    className="flex-1 py-2 bg-amber-500 text-white rounded-lg text-xs font-black shadow-sm active:scale-95 transition-transform"
                  >
                    <Undo2 size={14} className="inline mr-1"/>解鎖並重新抽籤
                  </button>
                )}
                <button onClick={handleExportPreLeave} className="flex-1 py-2 bg-green-600 text-white rounded-lg text-xs font-bold shadow-sm active:scale-95 transition-transform">
                  <Download size={14} className="inline mr-1"/>匯出 CSV
                </button>
              </div>
            </div>
          </div>
        )}
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

  const formatSafeDate = (req) => {
    if (!req) return "未知時間";

    const ts = req.timestamp || 
               req.timeStamp || 
               req.time || 
               req.createdAt || 
               req.date;

    if (!ts) {
      if (typeof req.toDate === 'function') return req.toDate().toLocaleString();
      return "未知時間";
    }

    if (typeof ts === 'number') return new Date(ts).toLocaleString();

    if (typeof ts === 'object' && ts.seconds) {
      return new Date(ts.seconds * 1000).toLocaleString();
    }

    if (typeof ts === 'object' && typeof ts.toDate === 'function') {
      return ts.toDate().toLocaleString();
    }

    const parsed = new Date(ts);
    if (!isNaN(parsed.getTime())) return parsed.toLocaleString();

    if (typeof ts === 'string' && ts.trim() !== "") return ts;

    return "未知時間";
  };

  const pendingList = useMemo(() => {
      return swapRequests.filter(req => {
        const isClosed = req.status === 'Approved' || req.status === 'Rejected' || req.status === 'Deleted';
        if (isClosed) return false;

        const isParticipant = 
          req.creatorId === currentUser.id || 
          req.targetId === currentUser.id || 
          (req.participants && req.participants.some(p => p.id === currentUser.id));

        if (isAdmin) {
          return isParticipant || req.status === 'PendingAdmin';
        }

        return isParticipant;
      }).sort((a, b) => a.timestamp - b.timestamp);
    }, [swapRequests, isAdmin, currentUser]);  

    const historyList = useMemo(() => {
        return swapRequests.filter(req => {
          const isClosed = req.status === 'Approved' || req.status === 'Rejected' || req.status === 'Deleted';
          if (!isClosed) return false;

          const isInRange = req.date >= dateRange.start && req.date <= dateRange.end;
          if (!isInRange) return false;

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

    const isStep2Completed = req.status === 'PendingAdmin' || req.status === 'Approved' || (isRejected && !req.adminNote);
    const isStep3Completed = req.status === 'Approved' || (isRejected && req.adminNote);

    const steps = [
      { id: '1', label: '申請人', active: true, color: 'bg-green-500' },
      { 
        id: '2', 
        label: '同仁核定', 
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
              const reqMonthKey = req.date ? req.date.substring(0, 7) : currentMonth;
              // 💡 修正：req.day 可能因為舊資料/建立當下沒寫入而是空的，
              // 這裡加上防呆，優先用 req.day，沒有的話就從 req.date 反推當月的「日」，
              // 避免誤判成「找不到班別」而顯示錯誤的已更動警告
              const fallbackDay = req.date ? Number(req.date.split('-')[2]) : null;
              const checkDays = req.isBundle ? req.daysToSwap : [req.day ?? fallbackDay];

              const normalize = (v) => {
                const s = (v === null || v === undefined) ? "-" : String(v).trim();
                return (s === "" || s === "-") ? "-" : s;
              };
              const clean = (val) => val.replace(/#|\(國\)/g, '');

              // 💡 修正：改為檢查「所有參與者」的班別是否都跟申請當下記錄的一致，
              // 不再只檢查被申請人一個人，避免漏掉發起人或第三、四位參與者的班別變動
              const isShiftMismatched = checkDays.some(d => {
                const isFullDate = String(d).includes('-');
                const targetMonth = isFullDate ? d.substring(0, 7) : reqMonthKey;
                const dayKey = isFullDate ? Number(d.split('-')[2]) : d;

                if (Array.isArray(req.participants) && req.participants.length > 0) {
                  return req.participants.some(p => {
                    const rawCur = schedule[targetMonth]?.[p.name]?.[dayKey];
                    return clean(normalize(rawCur)) !== clean(normalize(p.oldShift));
                  });
                }

                // 相容沒有 participants 的極舊資料：退回只檢查被申請人
                const rawCurTarget = schedule[targetMonth]?.[req.targetName]?.[dayKey];
                return clean(normalize(rawCurTarget)) !== clean(normalize(req.targetShift));
              });

              return (
                <div key={req.id} className="bg-white p-5 rounded-3xl shadow-sm border border-l-8 border-l-indigo-400 space-y-4">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-indigo-600 text-lg">{req.isBundle ? `${req.startDate}~${req.endDate}` : req.date}</span>
                      {req.isBundle && <span className="text-[10px] bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-lg font-black uppercase">整段</span>}
                    </div>
                  <span className="text-[10px] text-gray-400 font-bold bg-gray-50 px-2 py-1 rounded-lg">🕒 {formatSafeDate(req)}</span>
                  </div>

                  <div className="bg-indigo-50/50 p-4 rounded-2xl border border-indigo-100/50 space-y-3">
                    <div className="text-[11px] font-black text-indigo-800 flex items-center gap-1 opacity-70 uppercase tracking-widest">
                      <ArrowLeftRight size={12} /> 參與同仁與班別更動：
                    </div>

                    <div className="grid grid-cols-1 gap-2">
                      {req.participants ? (
                        req.participants.map((p, idx) => {
                          const nextP = req.participants[(idx + 1) % req.participants.length];

                          const isCreator = p.id === req.creatorId;
                          const approval = req.approvals?.find(a => a.id === p.id);

                          return (
                            <div key={idx} className="flex items-center justify-between bg-white px-3 py-2.5 rounded-xl shadow-sm border border-indigo-100/30">
                              <div className="flex items-center gap-2">
                                <span className="w-5 h-5 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-[10px] font-black">{idx + 1}</span>
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-black text-sm text-gray-700">{p.name}</span>

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
                        <div className="flex items-center justify-between bg-white px-3 py-2.5 rounded-xl shadow-sm">
                          <span className="font-black text-sm">{req.creatorName} ⇄ {req.targetName}</span>
                          <span className="text-xs text-indigo-600 font-bold">({req.creatorShift} ⇄ {req.targetShift})</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row justify-between items-end sm:items-center gap-4 pt-2 border-t border-gray-50">
                    <StatusProgress req={req}/>

                  <div className="flex flex-wrap gap-2 pt-2 border-t border-dashed border-gray-100 w-full">

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

                    {req.creatorId === currentUser.id && (req.status === 'WaitingParticipants' || req.status === 'PendingAdmin') && (
                      <button
                        onClick={() => triggerAction(req, 'Delete')}
                        className="w-full py-2 px-3 bg-gray-100 text-gray-500 rounded-xl font-black text-xs md:text-sm hover:bg-gray-200 transition-all flex items-center justify-center gap-1.5 whitespace-nowrap"
                      >
                        <Undo2 size={14} /> 撤回申請
                      </button>
                    )}

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
                              {req.participants.map(p => p.name).join(' → ')}
                            </div>
                            <div className="text-[10px] text-gray-400 font-normal">
                              {req.participants.map((p, idx) => {
                                const nextP = req.participants[(idx + 1) % req.participants.length];
                                return `${p.name}(${p.oldShift}→${nextP.oldShift})`;
                              }).join(', ')}
                            </div>
                          </div>
                        ) : (
                          `${req.creatorName}(${req.creatorShift}) ⇄ ${req.targetName}(${req.targetShift})`
                        )}
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-black shadow-sm ${req.status==='Approved'?'bg-green-100 text-green-600':req.status==='Rejected'?'bg-red-50 text-red-600':'bg-gray-100 text-gray-400'}`}>
                            {req.status==='Approved'?'已完成':req.status==='Rejected'?'已否決':'已撤回'}
                          </span>

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

const AccountManagementView = ({ employees, updateEmployees, setDeleteTarget, onExportFullBackup, onImportFullBackup }) => {
  const [formData, setFormData] = useState({ id: '', name: '', role: '1', labor: 'N', password: '' });
  const [editingId, setEditingId] = useState(null);
  const [draggedIdx, setDraggedIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const importRef = useRef(null);
  const backupRef = useRef(null);

  const getRoleLabel = (role) => {
    const map = { '0': '管理員', '1': '一般藥師', '2': '書記', '3': '藥庫藥師' };
    return map[role] || '一般藥師';
  };

  // 💡 修正核心：拖曳排序不再直接覆寫本地陣列，而是透過 Firestore transaction
  // 以「雲端最新資料」為基礎進行操作，避免跟其他人同時編輯時互相蓋掉
  const onDrop = (targetIdx) => {
    if (draggedIdx === null) return;
    const fromIdx = draggedIdx;
    updateEmployees(latest => {
      // 用「目前畫面上的順序(本地 employees)」對照「雲端最新清單」做順序重排
      // 因為排序是視覺操作，用本地順序去重排雲端最新資料是最直覺的方式
      const localOrderIds = employees.map(e => e.id);
      const latestById = new Map(latest.map(e => [e.id, e]));
      // 以本地順序為主排序，若雲端有本地沒有的新資料(代表別人剛新增)，一律補在最後面
      const ordered = localOrderIds.filter(id => latestById.has(id)).map(id => latestById.get(id));
      latest.forEach(e => { if (!localOrderIds.includes(e.id)) ordered.push(e); });

      const next = [...ordered];
      const item = next.splice(fromIdx, 1)[0];
      next.splice(targetIdx, 0, item);
      return next;
    });
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
      const parsedRows = rows.map(r => {
        const [id, name, role, labor, pwd] = r.split(',');
        return { id, name, role, labor, pwd };
      }).filter(r => r.id && r.name);

      // 💡 修正：以 Firestore 最新清單為基礎新增，避免匯入時把別人剛新增/編輯的人員蓋掉
      updateEmployees(latest => {
        let addedCount = 0;
        const existingIds = new Set(latest.map(emp => emp.id));
        const nextEmployees = [...latest];
        parsedRows.forEach(({ id, name, role, labor, pwd }) => {
          if (!existingIds.has(id)) {
            const isNC = (id === "E1" || id === "E2" || id === "E3" || name.includes("夜診"));
            nextEmployees.push({ id, name, role: role || '1', labor: labor || 'N', password: pwd || "", isNightClinic: isNC });
            existingIds.add(id);
            addedCount++;
          }
        });
        setTimeout(() => {
          if (addedCount > 0) alert(`匯入完成！共新增 ${addedCount} 名新員工，已重複的員編已自動忽略。`);
          else alert("匯入檔案中沒有新的人員資料。");
        }, 0);
        return nextEmployees;
      });
    };
    reader.readAsText(file);
  };

  return (
    <div className="p-4 max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 font-sans">
      <div className="lg:col-span-4 bg-white p-5 rounded-3xl shadow border h-fit">
        <h2 className="text-lg font-black mb-4 flex items-center gap-2 text-gray-800"><UserCog size={20}/> 人員管理</h2>
        <form className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          const submittedData = { ...formData };
          const isEditing = !!editingId;
          // 💡 修正核心：新增/編輯人員一律以 Firestore 「當下最新」的清單為基礎操作
          // 不再使用本地(可能過時)的 employees 陣列直接覆寫，杜絕「剛新增的人被別人洗掉」的問題
          updateEmployees(latest => {
            if (isEditing) {
              return latest.map(emp => emp.id === editingId ? { ...emp, ...submittedData } : emp);
            }
            const isDuplicate = latest.some(emp => emp.id === submittedData.id);
            if (isDuplicate) {
              setTimeout(() => alert("該員編已存在，系統已自動忽略。"), 0);
              return latest;
            }
            setTimeout(() => alert("成功新增 1 名員工。"), 0);
            return [...latest, submittedData];
          });
          setEditingId(null);
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
          <button type="button" onClick={() => updateEmployees(latest => [...latest, { id: `SEP-${Date.now()}`, isSeparator: true }])} className="w-full mt-2 py-2 border-2 border-dashed rounded-xl text-[10px] font-black text-gray-400 hover:bg-gray-50 transition-all">插入分組分隔線</button>
        </form>

        {/* 💡 全系統備份 / 還原：因應 Firestore 單一文件欄位數上限，提供完整 JSON 備份下載與還原 */}
        <div className="mt-4 pt-4 border-t border-dashed">
          <div className="text-[10px] font-black text-gray-400 mb-2 uppercase tracking-widest">系統完整備份 (含所有月份班表/預假/顏色)</div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={onExportFullBackup} className="py-2 border-2 border-emerald-200 bg-emerald-50 text-emerald-700 rounded-xl text-xs font-black hover:bg-emerald-100 flex items-center justify-center gap-1"><Download size={14}/> 下載完整備份</button>
            <button type="button" onClick={() => backupRef.current.click()} className="py-2 border-2 border-amber-200 bg-amber-50 text-amber-700 rounded-xl text-xs font-black hover:bg-amber-100 flex items-center justify-center gap-1"><Upload size={14}/> 上傳並還原</button>
            <input type="file" ref={backupRef} className="hidden" accept=".json" onChange={(e) => { const f = e.target.files[0]; if (f) onImportFullBackup(f); e.target.value = ''; }} />
          </div>
          <p className="text-[9px] text-gray-400 mt-2 leading-relaxed">建議定期下載備份保存在自己的電腦；若雲端資料異常，可用備份檔還原。還原前系統會再次跟您確認。</p>
        </div>
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
                        {emp.password === "" && (
                          <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-600" title="下次登入時需先設定新密碼">
                            尚未設定密碼
                          </span>
                        )}
                      </td>
                    </>
                  )}
                  <td className="p-4 text-right">
                    {!emp.isSeparator && (
                      <>
                        <button onClick={() => { setEditingId(emp.id); setFormData(emp); }} className="text-blue-500 text-xs font-black mr-3">編輯</button>
                        <button
                          onClick={() => {
                            if (!window.confirm(`確定要重設「${emp.name}」的密碼嗎？\n重設後該員工下次登入時，輸入的任何密碼都會被設為新密碼。`)) return;
                            updateEmployees(latest => latest.map(e => e.id === emp.id ? { ...e, password: "" } : e));
                          }}
                          title="重設密碼（清空，下次登入自動設定新密碼）"
                          className="text-amber-500 text-xs font-black mr-3 hover:text-amber-700 inline-flex items-center gap-1"
                        >
                          <ResetPasswordIcon size={12}/> 重設密碼
                        </button>
                      </>
                    )}
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

const ShiftsManagementView = ({ shifts, updateShifts, holidays, updateHolidays, setDeleteShiftTarget, personDayRules, updatePersonDayRules }) => {
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
      if (next.length > 0) { updateShifts(() => next); alert(`匯入完成，已載入 ${next.length} 個班別。`); }
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
      if (next.length > 0) { updatePersonDayRules(() => next); alert(`匯入成功，已載入 ${next.length} 筆規則。`); }
    };
    reader.readAsText(file); e.target.value = '';
  };

  const handleRuleSubmit = (e) => {
    e.preventDefault();
    if (!ruleFormData.pattern) return;
    if (editingRuleId) {
      updatePersonDayRules(latest => latest.map(r => r.id === editingRuleId ? { ...ruleFormData, id: editingRuleId } : r));
    } else {
      updatePersonDayRules(latest => [...latest, { ...ruleFormData, id: Date.now() }]);
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
            if (editingId) updateShifts(latest => latest.map(s => s.id === editingId ? { ...formData, id: editingId } : s));
            else updateShifts(latest => [...latest, { ...formData, id: Date.now() }]);
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

          {/* 💡 自適應滾動表格高度，隨內容多寡自動長高，最多不超過視窗的 45%，不會沈到底部 */}
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
              <button onClick={() => { const d = document.getElementById('h_date').value, n = document.getElementById('h_note').value; if (d && n) updateHolidays(latest => ({ ...latest, [d]: n })); }} className="bg-pink-600 text-white px-4 py-2 rounded-xl font-bold shadow hover:bg-pink-700 active:scale-95 transition-all whitespace-nowrap">新增</button>
            </div>

            {/* 💡 改為自適應高度，可滑動 */}
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
                        <button onClick={() => { updateHolidays(latest => { const next = { ...latest }; delete next[date]; return next; }); }} className="text-red-300 hover:text-red-600 transition-all">
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

            {/* 💡 改為自適應高度，可滑動 */}
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
              onConfirm={() => { updatePersonDayRules(latest => latest.filter(r => r.id !== deleteRuleTarget.id)); setDeleteRuleTarget(null); }} 
              title="確定刪除班別？" 
              message={`確定刪除班別？移除 ${deleteRuleTarget?.pattern} 將影響人日數計算。`} 
            />
          </div>
        </div>

      </div>
  );
  };

const ManagementReportView = ({ currentMonth, employees, schedule, personDayRules, holidays, shifts, cellColors }) => {
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

      // 💡 明確使用 year 和 month (JavaScript 月份從 0 開始，這裡用 month 就剛好代表下個月的第 0 天)
      const lastDay = new Date(year, month, 0).getDate(); 
      const days = [];

      for (let i = 1; i <= lastDay; i++) {
        // 💡 明確使用 month - 1 來對應正確月份
        const d = new Date(year, month - 1, i);
        const fullDate = `${currentMonth}-${String(i).padStart(2, '0')}`;

        days.push({ 
          day: i, 
          dayOfWeek: WEEKDAYS_MAP[d.getDay()], 
          rawDay: d.getDay(), 
          holiday: holidays[fullDate] || "", 
          fullDate 
        });
      }
      return days;
    } else {
      // 四週模式不需要變動
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
      const shiftObj = (shifts || []).find(s => s.name === baseShiftName);
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

  const checkLaborCompliance = (emp, days) => {
    if (!isFourWeekMode) return true;
    const blocks = [days.slice(0, 14), days.slice(14, 28)];

    for (const block of blocks) {
      const codes = block.map(d => {
        const mKey = d.monthKey || currentMonth;
        let rawVal = schedule[mKey]?.[emp.name]?.[d.day];

        if (!rawVal || rawVal === "" || rawVal === undefined) {
          if (d.rawDay === 0 || d.holiday) rawVal = "例";
          else if (d.rawDay === 6) rawVal = "#";
          else rawVal = "-";
        }

        const rawStr = rawVal.toString().trim();
        const baseShiftName = rawStr.split('/')[0];
        const shiftObj = (shifts || []).find(s => s.name === baseShiftName);

        if (shiftObj) return shiftObj.code;
        if (["#", "例", "休"].includes(baseShiftName)) return "0";
        if (baseShiftName === "-") return "1";
        return baseShiftName;
      });

      const count0 = codes.filter(c => c === "0").length;
      const countMinus3 = codes.filter(c => c === "-3").length;

      if (emp.labor === 'N') { 
        if (count0 !== 4) return false; 
      } 
      else if (emp.labor === 'Y') { 
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

  const handleExportCSV = (exportType = 'csv') => {
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

    if (exportType === 'csv') {
      let csv = `\ufeff${titleHeader}${(",").repeat(headers.length - 1)}\n`;
      csv += headers.join(",") + "\n";

      filteredEmployees.forEach(emp => {
        let row = [emp.id, emp.name];
        let rowSum = 0;
        reportDays.forEach(d => {
          const res = calculateCellValue(emp, d);
          rowSum += res.numeric;
          row.push(res.display || "");
        });
        if (!isFourWeekMode && !isNightFeeMode) row.push(rowSum.toFixed(reportType === 'personDays' ? 1 : 0));
        csv += row.join(",") + "\n";
      });

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${titleHeader}_(${typeLabel}).csv`;
      link.click();
    } 
    else if (exportType === 'excel') {
      let xmlRows = "";

      xmlRows += `
        <tr style="height:35px;">
          <td colspan="${headers.length}" style="font-family:Microsoft JhengHei;font-size:16px;font-weight:bold;align:center;vertical-align:middle;background-color:#F3F4F6;">
            ${titleHeader} (${typeLabel})
          </td>
        </tr>`;

      xmlRows += `<tr style="height:28px;font-family:Microsoft JhengHei;font-size:12px;font-weight:bold;align:center;vertical-align:middle;">`;
      headers.forEach(h => xmlRows += `<td style="background-color:#E5E7EB;border:0.5pt solid #D1D5DB;align:center;">${h.replace(/\n/g, " ")}</td>`);
      xmlRows += `</tr>`;

      filteredEmployees.forEach(emp => {
        xmlRows += `<tr style="height:25px;font-family:Microsoft JhengHei;font-size:12px;align:center;vertical-align:middle;">`;
        xmlRows += `<td style="border:0.5pt solid #E5E7EB;align:center;">${emp.id}</td>`;
        xmlRows += `<td style="border:0.5pt solid #E5E7EB;font-weight:bold;align:center;">${emp.name}</td>`;

        let rowSum = 0;
        reportDays.forEach(d => {
          const res = calculateCellValue(emp, d);
          rowSum += res.numeric;

          let cellBg = "#FFFFFF";
          if (d.rawDay === 0 || !!d.holiday) cellBg = "#FFB3D9";
          else if (d.rawDay === 6) cellBg = "#FFB366";
          else {
            const customColor = cellColors?.[currentMonth]?.[emp.name]?.[d.day];
            if (customColor) {
               if (customColor.includes('red')) cellBg = '#FECACA';
               else if (customColor.includes('blue')) cellBg = '#BFDBFE';
               else if (customColor.includes('green')) cellBg = '#A7F3D0';
               else if (customColor.includes('yellow')) cellBg = '#FEF08A';
               else if (customColor.includes('purple')) cellBg = '#E9D5FF';
            }
          }

          const displayVal = (res.display === "-" || res.display === undefined || res.display === null) ? "" : res.display;
          xmlRows += `<td style="background-color:${cellBg};border:0.5pt solid #E5E7EB;align:center;">${displayVal}</td>`;
        });

        if (!isFourWeekMode && !isNightFeeMode) {
          xmlRows += `<td style="background-color:#F1F8F7;font-weight:bold;color:#0F766E;border:0.5pt solid #E5E7EB;align:center;">${rowSum.toFixed(reportType === 'personDays' ? 1 : 0)}</td>`;
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
      link.download = `${titleHeader}_(${typeLabel}).xls`;
      link.click();
    }
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

          <div className="flex items-center gap-2">
            <button onClick={() => handleExportCSV('csv')} className="bg-teal-600 text-white px-3 py-1.5 rounded-xl text-xs font-black shadow-md hover:bg-teal-700">
              匯出 CSV
            </button>
            <button onClick={() => handleExportCSV('excel')} className="bg-emerald-600 text-white px-3 py-1.5 rounded-xl text-xs font-black shadow-md hover:bg-emerald-700">
              匯出 Excel (帶顏色)
            </button>
          </div>
        </div>
      </div>

      <div className="flex-grow overflow-auto relative">
        <table className="w-full text-[12px] text-center border-separate border-spacing-0 table-fixed min-w-[1600px]">
          <thead className="sticky top-0 z-[50]">
            <tr className="bg-gray-100">
              <th className="sticky left-0 top-0 z-[55] bg-gray-100 border-r-2 border-b-2 border-gray-300 p-3 w-16 font-black text-[11px] shadow-[2px_0_5px_rgba(0,0,0,0.1)]">姓名</th>
              {reportDays.map((d, idx) => {
                const isHoliday = d.rawDay === 0 || !!d.holiday;
                const isSat = d.rawDay === 6;
                return (
                  <th key={idx} className={`border-r border-b-2 border-gray-300 p-1 w-12 font-bold ${isHoliday ? 'bg-[#FFB3D9]' : isSat ? 'bg-[#FFB366]' : 'bg-gray-100'}`}>
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
                    const res = calculateCellValue(emp, d); 
                    rowSum += res.numeric;
                    let bgClass = "bg-white";
                    if (d.rawDay === 0 || !!d.holiday) bgClass = "bg-[#FFB3D9]"; else if (d.rawDay === 6) bgClass = "bg-[#FFB366]";
                    return (
                      <td key={idx} className={`border-r border-b border-gray-200 p-0 h-10 ${bgClass}`}>
                        <span className={`${(res.display === "" || res.display === "-" || res.display === "#" || res.display === "例") ? 'text-gray-300' : 'text-gray-800'} font-medium text-[13px]`}>{res.display}</span>
                      </td>
                    );
                  })}
                  {!isFourWeekMode && !isNightFeeMode && (
                    <td className="sticky right-0 z-30 bg-[#F1F8F7] border-l-2 border-b border-gray-200 p-2 font-black text-teal-800 group-hover:bg-[#E0F2F1] shadow-[-2px_0_5px_rgba(0,0,0,0.05)] text-sm">
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

const SchedulingView = ({ currentMonth, employees, daysInMonth, schedule, setSchedule, cellColors, setCellColors, shifts, exportScheduleCSV, setCurrentPage, setIsDirty, saveScheduleMonth, saveCellColorsMonth, preLeaveData, setPreLeaveData, savePreLeaveMonth, isAdmin, isMonthDrawn }) => {
  const [editSched, setEditSched] = useState({});
  const [activeColor, setActiveColor] = useState('bg-white');
  const [importPreview, setImportPreview] = useState(null);
  const [ignoredCells, setIgnoredCells] = useState(new Set()); 
  const fileRef = useRef(null);
  const [showLaborWarning, setShowLaborWarning] = useState(false);
  const [cycleStartDate, setCycleStartDate] = useState(`${currentMonth}-01`); // 預設使用當月1號作為四周週期起點
  const prevMonthRef = useRef(currentMonth);

  // 💡 自動對齊月份切換，保護手動輸入不洗檔
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

  const handleImportCSV = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const arrayBuffer = ev.target.result;

        let text;
        try {
          text = new TextDecoder('big5').decode(arrayBuffer);
          if (!text.includes('藥劑部')) {
            text = new TextDecoder('utf-8').decode(arrayBuffer);
          }
        } catch (err) {
          text = new TextDecoder('utf-8').decode(arrayBuffer);
        }

        const rows = text.split(/\r?\n/).map(r => r.split(',').map(c => c.trim().replace(/^"|"$/g, '')));

        const topRowsText = rows.slice(0, 5)
          .map(r => r.join(""))
          .join("")
          .replace(/,/g, "")
          .replace(/\s/g, "")
          .replace(/\u3000/g, "");

        const match = topRowsText.match(/(1\d{2})年.*?(\d{1,2})月/);

        if (!match) throw new Error("找不到年份月份");

        const fileMonth = `${parseInt(match[1], 10) + 1911}-${String(parseInt(match[2], 10)).padStart(2, '0')}`;

        if (fileMonth !== currentMonth) {
          throw new Error(`月份不符: 偵測到 ${fileMonth}，系統要求 ${currentMonth}`);
        }

        let idIdx = -1, nameIdx = -1, dataStartRow = -1;

        for (let i = 0; i < Math.min(rows.length, 20); i++) {
          const row = rows[i];

          const foundIdIdx = row.findIndex(c => 
            (c && c.includes("員編")) || 
            (c && c.length >= 5 && c.startsWith("Y"))
          );

          if (foundIdIdx !== -1) {
            idIdx = foundIdIdx;
            nameIdx = idIdx + 1;
            dataStartRow = i;

            if (row[idIdx].includes("員編")) {
              dataStartRow = i + 1;
            }
            break;
          }
        }

        if (idIdx === -1 || nameIdx === -1 || nameIdx >= rows[dataStartRow]?.length) {
          alert("定位失敗：找不到員編欄位或姓名欄位異常。");
          return;
        }

        const nextImportData = {};

        for (let i = dataStartRow; i < rows.length; i++) {
          const r = rows[i];
          const empId = r[idIdx] ? r[idIdx].trim() : "";
          if (!empId) continue;

          const emp = employees.find(e => String(e.id).trim() === empId);
          if (!emp) continue;

          for (let day = 1; day <= 31; day++) {
            let finalValue = (r[nameIdx + day] === undefined || r[nameIdx + day] === null || String(r[nameIdx + day]).trim() === "") 
                             ? "-" 
                             : String(r[nameIdx + day]).trim();
            if (finalValue === "例假") finalValue = "例";
            else if (finalValue === "休假") finalValue = "休";

            const currentRaw = schedule[currentMonth]?.[emp.name]?.[day];
            const currentVal = (currentRaw === null || currentRaw === undefined || String(currentRaw).trim() === "") 
                               ? "-" 
                               : String(currentRaw).trim();

            if (finalValue !== currentVal) {
              if (!nextImportData[emp.name]) nextImportData[emp.name] = {};
              nextImportData[emp.name][day] = finalValue;
            }
          }
        }
        if (Object.keys(nextImportData).length === 0) {
          alert("班表內容完全一致，無變動。");
          return;
        }

        setImportPreview(nextImportData);
        alert("解析成功！請確認對比預覽。");

      } catch (err) {
        console.error(err);
        alert("解析失敗，檔案編碼或格式有誤。");
      }
    };

    reader.readAsArrayBuffer(file);
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

  const handlePublishSchedule = async () => {
    const nextSchedule = { ...schedule, [currentMonth]: deepClone(editSched) };
    setSchedule(nextSchedule);
    // 💡 修正核心：只把「當月」的班表寫進「當月自己的文件」，絕對不會動到其他月份的資料，
    // 也不會因為本地端 schedule 過期而把別的月份/別人剛發佈的班表覆蓋掉
    await saveScheduleMonth(currentMonth, deepClone(editSched));
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

      for (let i = 0; i < 28; i++) {
        const targetDate = new Date(startObj.getTime() + i * dayMs);
        const yKey = targetDate.getFullYear();
        const mKey = String(targetDate.getMonth() + 1).padStart(2, '0');
        const dKey = String(targetDate.getDate());
        const targetMonthStr = `${yKey}-${mKey}`;

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

        if (targetMonthStr === currentMonth) {
          analysis.codes[emp.name][dKey] = code;
        }
      }

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

                // 💡 只要是管理員 (!isAdmin 為 false)，就永遠可以編輯備註！
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
                        savePreLeaveMonth(currentMonth, { remarks: next.remarks[currentMonth] });
                      }}
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
                    const isConflict = importPreview && 
                                      previewVal !== null && 
                                      previewVal !== undefined && 
                                      previewVal !== originalVal;
                    // 對比模式藍框衝突判定邏輯
                    const isIgnored = ignoredCells.has(`${emp.name}-${d.day}`);
                    // 如果預覽值存在、不是 null 且不等於原值，才判定為變動
                    const isChanged = previewVal !== null && previewVal !== undefined && previewVal !== originalVal && !isIgnored;
                    // 3. 決定最終顯示內容
                    const displayVal = (previewVal !== null && previewVal !== undefined && !isIgnored) ? previewVal : originalVal;
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

                          // 1. 更新或刪除顏色
                          if (activeColor === 'bg-white') {
                            delete nc[currentMonth][emp.name][d.day];
                          } else {
                            nc[currentMonth][emp.name][d.day] = activeColor;
                          }

                          // 2. 清理空物件邏輯 (防止空架構遺留在資料庫)
                          if (Object.keys(nc[currentMonth][emp.name]).length === 0) {
                            delete nc[currentMonth][emp.name];
                          }
                          if (Object.keys(nc[currentMonth]).length === 0) {
                            delete nc[currentMonth];
                          }

                          setCellColors(nc);
                          // 💡 修正核心：只存「當月」的 cellColors 到當月自己的文件
                          saveCellColorsMonth(currentMonth, nc[currentMonth] || {});
                        }
                        }}
                      >
                        {isChanged && (
                          <div className="absolute inset-0 bg-blue-200 border-2 border-blue-500 pointer-events-none z-0" />
                        )}
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

// =====================================================================================
// 💡 Firestore 資料層 V1.9：
//    - meta 文件 (main)：employees / shifts / holidays / personDayRules / swapRequests / preLeaveMeta
//    - monthlyData 子集合：每個年月各自一份文件，內含 { schedule, cellColors, apps, dailyLimits, remarks }
//    這樣設計可以讓「編輯 A 月份」與「編輯 B 月份」完全不會互相覆蓋，
//    也不會因為某個人瀏覽器裡的資料比較舊，就把雲端最新的其他月份資料洗掉。
// =====================================================================================
const mainDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'roster', 'main');
const monthlyColRef = collection(mainDocRef, 'monthlyData');
const getMonthDocRef = (monthKey) => doc(monthlyColRef, monthKey);

const App = () => {
  const [currentPage, setCurrentPage] = useState('home');
  const [pendingPage, setPendingPage] = useState(null); 
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [currentMonth, setCurrentMonth] = useState(() => {
    // 優先從 localStorage 讀取上一次停留在哪
    const saved = localStorage.getItem('lastMonth');
    if (saved) return saved;

    // 沒紀錄的話，才用今天日期
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  // 當月份改變時，同步儲存到 localStorage
  useEffect(() => {
    localStorage.setItem('lastMonth', currentMonth);
  }, [currentMonth]);
  const [employees, setEmployees] = useState(INITIAL_EMPLOYEES);
  const [shifts, setShifts] = useState(INITIAL_SHIFTS);
  const [holidays, setHolidays] = useState({ "2026-05-01": "勞動節" });
  const [personDayRules, setPersonDayRules] = useState(INITIAL_PERSON_DAY_RULES);
  const [schedule, setSchedule] = useState({});
  const [cellColors, setCellColors] = useState({});
  // 💡 換班紀錄改為「按月份分組」儲存 ({ '2026-06': [...], '2026-07': [...] })，
  // 對外仍用 swapRequests 這個攤平後的陣列，元件端完全不用改
  const [swapRequestsByMonth, setSwapRequestsByMonth] = useState({});
  const swapRequests = useMemo(() => Object.values(swapRequestsByMonth).flat(), [swapRequestsByMonth]);
  const getReqMonthKey = (req) => (req?.date ? req.date.substring(0, 7) : currentMonth);
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
  const [loadedMonths, setLoadedMonths] = useState(new Set());
  const migrationDoneRef = useRef(false);

  // ---------------------------------------------------------------------------------
  // 存「共用/非月份」資料 (員工、班別代碼、假日、人日規則、換班紀錄、預假全域設定)
  // ---------------------------------------------------------------------------------
  const saveMeta = async (updates) => {
    if (!auth.currentUser || !updates) return;
    try {
      await setDoc(mainDocRef, updates, { merge: true });
    } catch (error) {
      console.error("雲端儲存失敗(meta):", error);
    }
  };

  // ---------------------------------------------------------------------------------
  // 💡 換班紀錄：只寫入該筆申請「所屬月份」的文件，不會動到其他月份的換班紀錄
  // mutatorFn 接收「該月份目前的換班紀錄陣列」，回傳新的陣列
  // ---------------------------------------------------------------------------------
  const patchSwapRequestsMonth = (monthKey, mutatorFn) => {
    const current = swapRequestsByMonth[monthKey] || [];
    const next = mutatorFn(current).map(req => cleanBundleData(req));
    setSwapRequestsByMonth(prev => ({ ...prev, [monthKey]: next }));
    saveMonthDoc(monthKey, { swapRequests: next });
  };

  // ---------------------------------------------------------------------------------
  // 存「單一月份」資料：schedule / cellColors / apps / dailyLimits / remarks
  // 關鍵：只會寫入該月份自己的文件，絕不動到其他月份，杜絕「不同月份互相覆蓋、資料消失」的問題
  // ---------------------------------------------------------------------------------
  const saveMonthDoc = async (monthKey, updates) => {
    if (!auth.currentUser || !monthKey || !updates) return;
    try {
      await setDoc(getMonthDocRef(monthKey), updates, { merge: true });
    } catch (error) {
      console.error(`雲端儲存失敗(月份 ${monthKey}):`, error);
    }
  };

  const saveScheduleMonth = (monthKey, monthScheduleObj) => saveMonthDoc(monthKey, { schedule: monthScheduleObj });
  const saveCellColorsMonth = (monthKey, monthColorObj) => saveMonthDoc(monthKey, { cellColors: monthColorObj });
  const savePreLeaveMonth = (monthKey, partial) => saveMonthDoc(monthKey, partial); // partial: {apps} / {dailyLimits} / {remarks}
  const saveMetaPreLeave = (partial) => saveMeta({ preLeaveMeta: partial });

  // ---------------------------------------------------------------------------------
  // 💡 預假抽籤：整個「讀取申請名單 → 抽出中籤者 → 寫回班表 → 標記本月已抽籤」
  // 全部包在同一個 Firestore Transaction 裡，且一律以 Transaction 當下讀到的最新資料為準
  // （不使用畫面上可能過期的本地 state），確保無論同時有幾台裝置觸發，
  // 只會有一次真正生效，其餘會在 Transaction 內偵測到「已抽籤」而自動放棄，不會互相覆蓋。
  // ---------------------------------------------------------------------------------
  const runLotteryTransaction = async (monthKey, daysInMonthArr, defaultHolidayLimit, defaultWeekdayLimit) => {
    let result = null;
    try {
      await runTransaction(db, async (tx) => {
        const mDocRef = getMonthDocRef(monthKey);
        const snap = await tx.get(mDocRef);
        const data = snap.exists() ? snap.data() : {};

        if (data.isDrawn === true) { result = { ok: false, reason: 'already-drawn' }; return; }

        const nextMonthSched = deepClone(data.schedule || {});
        const apps = data.apps || {};
        const dailyLimits = data.dailyLimits || {};

        const getLeaveListFresh = (day) => employees
          .filter(e => !e.isSeparator && !getIsNightClinic(e) && e.role !== '2' && e.role !== '3' && apps?.[e.name]?.[day] === "預假")
          .map(e => e.name);

        daysInMonthArr.forEach(d => {
          const limit = parseInt(dailyLimits?.[d.day] || (d.rawDay === 0 || d.rawDay === 6 || d.holiday ? defaultHolidayLimit : defaultWeekdayLimit));

          // 💡 先算出這天目前已經有多少人是「休」（例如手動排班已排定、或救援重抽前的既有結果），
          // 只補抽名額還沒滿的部分，避免解鎖重新抽籤時把既有結果洗掉或抽出超過名額的人數
          const alreadyOffCount = Object.values(nextMonthSched).filter(empDays => empDays && empDays[d.day] === "休").length;
          const remainingSlots = limit - alreadyOffCount;
          if (remainingSlots <= 0) return;

          const candidates = getLeaveListFresh(d.day).filter(name => nextMonthSched[name]?.[d.day] !== "休");
          const winners = [...candidates].sort(() => 0.5 - Math.random()).slice(0, remainingSlots);
          winners.forEach(name => {
            if (!nextMonthSched[name]) nextMonthSched[name] = {};
            nextMonthSched[name][d.day] = "休";
          });
        });

        // 💡 只用單一 tx.set 一次寫入 schedule + isDrawn，確保「抽籤結果」與「已抽籤標記」原子性地同時生效
        tx.set(mDocRef, { schedule: nextMonthSched, isDrawn: true }, { merge: true });
        result = { ok: true };
      });
    } catch (error) {
      console.error("抽籤 Transaction 失敗:", error);
      result = { ok: false, reason: 'error', error };
    }
    return result;
  };

  // 💡 管理員救援用：強制解鎖某個月份的「已抽籤」狀態，讓該月可以重新執行抽籤或手動調整。
  // 只清除 isDrawn 這個旗標，不會動到同仁的申請紀錄(apps)，也不會清除既有班表。
  const resetMonthDraw = (monthKey) => saveMonthDoc(monthKey, { isDrawn: false });


  // ---------------------------------------------------------------------------------
  // 💡 Transaction 安全寫入：employees / shifts / holidays / personDayRules
  // 每次寫入前，都會先讀取「雲端當下最新版本」，把 mutatorFn(latestArrayOrObj) 的結果
  // 寫回去，而不是盲目地把本地(可能過期)的整包資料覆蓋上去。
  // 這是解決「員工被清空」「密碼被離奇改變」「剛新增的資料被別人洗掉」的根本作法。
  // ---------------------------------------------------------------------------------
  const runMetaTransaction = async (fieldName, mutatorFn, fallbackValue) => {
    if (!auth.currentUser) return;
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(mainDocRef);
        const cloudVal = snap.exists() && snap.data()[fieldName] !== undefined ? snap.data()[fieldName] : fallbackValue;
        const nextVal = mutatorFn(deepClone(cloudVal));
        tx.set(mainDocRef, { [fieldName]: nextVal }, { merge: true });
      });
    } catch (error) {
      console.error(`Transaction 寫入失敗(${fieldName}):`, error);
      alert("儲存失敗，可能是網路問題，請重新操作一次。");
    }
  };

  // 員工異動一律走這裡：mutatorFn 接收「雲端最新員工陣列」，回傳新的員工陣列
  const updateEmployees = (mutatorFn) => runMetaTransaction('employees', mutatorFn, INITIAL_EMPLOYEES);
  const updateShifts = (mutatorFn) => runMetaTransaction('shifts', mutatorFn, INITIAL_SHIFTS);
  const updateHolidays = (mutatorFn) => runMetaTransaction('holidays', mutatorFn, {});
  const updatePersonDayRules = (mutatorFn) => runMetaTransaction('personDayRules', mutatorFn, INITIAL_PERSON_DAY_RULES);

  // 舊版相容用：其餘地方若仍呼叫 saveData(...)，自動依 key 分流到正確的位置
  const saveData = async (updates) => {
    if (!updates) return;
    if (updates.schedule) {
      await Promise.all(Object.keys(updates.schedule).map(m => saveScheduleMonth(m, updates.schedule[m])));
    }
    if (updates.cellColors) {
      await Promise.all(Object.keys(updates.cellColors).map(m => saveCellColorsMonth(m, updates.cellColors[m])));
    }
    if (updates.preLeaveData) {
      const pld = updates.preLeaveData;
      const monthKeys = new Set([...Object.keys(pld.apps || {}), ...Object.keys(pld.dailyLimits || {}), ...Object.keys(pld.remarks || {})]);
      await Promise.all(Array.from(monthKeys).map(m => saveMonthDoc(m, {
        apps: pld.apps?.[m] || {}, dailyLimits: pld.dailyLimits?.[m] || {}, remarks: pld.remarks?.[m] || {}
      })));
      await saveMetaPreLeave({ weekendLimit: pld.weekendLimit, weekdayLimit: pld.weekdayLimit, lotteryDay: pld.lotteryDay, drawnMonths: pld.drawnMonths || [] });
    }
    const metaUpdates = {};
    let hasMeta = false;
    ['employees', 'shifts', 'holidays', 'personDayRules', 'swapRequests'].forEach(k => {
      if (updates[k] !== undefined) { metaUpdates[k] = updates[k]; hasMeta = true; }
    });
    if (hasMeta) await saveMeta(metaUpdates);
  };

  useEffect(() => {const initAuth = async () => { try {if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {await signInWithCustomToken(auth, __initial_auth_token);} else {await signInAnonymously(auth);}} catch (err) {console.warn("驗證不匹配:", err);await signInAnonymously(auth);}};initAuth();
}, []);

  // 💡 監聽 meta 主文件 (員工/班別/假日/人日規則/換班紀錄/預假全域設定)
  useEffect(() => {
    const unsubMeta = onSnapshot(mainDocRef, async (snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      if (d.employees) setEmployees(d.employees);
      if (d.shifts) setShifts(d.shifts);
      if (d.holidays) setHolidays(d.holidays);
      if (d.personDayRules) setPersonDayRules(d.personDayRules);
      if (d.preLeaveMeta) {
        setPreLeaveData(prev => ({ ...prev, ...d.preLeaveMeta }));
      }

      // 💡 一次性資料遷移：如果偵測到舊版把 schedule / cellColors / preLeaveData / swapRequests
      // 整包塞在主文件裡，自動依「所屬月份」搬到 monthlyData 子集合，並在主文件中清除，
      // 避免舊資料繼續在「main」這一份文件裡越滾越大，也避免換班紀錄互相覆蓋的問題
      const hasLegacySwap = d.swapRequests && Array.isArray(d.swapRequests) && d.swapRequests.length > 0;
      if (!migrationDoneRef.current && (d.schedule || d.cellColors || hasLegacySwap || (d.preLeaveData && (d.preLeaveData.apps || d.preLeaveData.dailyLimits || d.preLeaveData.remarks)))) {
        migrationDoneRef.current = true;
        try {
          const monthKeys = new Set([
            ...Object.keys(d.schedule || {}),
            ...Object.keys(d.cellColors || {}),
            ...Object.keys(d.preLeaveData?.apps || {}),
            ...Object.keys(d.preLeaveData?.dailyLimits || {}),
            ...Object.keys(d.preLeaveData?.remarks || {})
          ]);

          // 舊版 swapRequests 是攤平陣列，依每筆申請的日期分組回各自月份
          const legacySwapByMonth = {};
          if (hasLegacySwap) {
            d.swapRequests.forEach(req => {
              const cleaned = cleanBundleData(req);
              const m = getReqMonthKey(cleaned);
              monthKeys.add(m);
              if (!legacySwapByMonth[m]) legacySwapByMonth[m] = [];
              legacySwapByMonth[m].push(cleaned);
            });
          }

          for (const m of monthKeys) {
            await setDoc(getMonthDocRef(m), {
              schedule: d.schedule?.[m] || {},
              cellColors: d.cellColors?.[m] || {},
              apps: d.preLeaveData?.apps?.[m] || {},
              dailyLimits: d.preLeaveData?.dailyLimits?.[m] || {},
              remarks: d.preLeaveData?.remarks?.[m] || {},
              swapRequests: legacySwapByMonth[m] || [],
              // 💡 是否已抽籤改成各月份自己記錄，依照舊資料裡的 drawnMonths 陣列還原
              isDrawn: (d.preLeaveData?.drawnMonths || []).includes(m)
            }, { merge: true });
          }
          const legacyPreLeave = d.preLeaveData || {};
          await setDoc(mainDocRef, {
            schedule: deleteField(),
            cellColors: deleteField(),
            preLeaveData: deleteField(),
            swapRequests: deleteField(),
            preLeaveMeta: {
              weekendLimit: legacyPreLeave.weekendLimit ?? 10,
              weekdayLimit: legacyPreLeave.weekdayLimit ?? 3,
              lotteryDay: legacyPreLeave.lotteryDay ?? 15
            }
          }, { merge: true });
          console.log(`✅ 舊版資料已自動搬遷至 ${monthKeys.size} 份月份文件，並清除主文件內舊格式殘留。`);
        } catch (err) {
          console.error("舊資料自動搬遷失敗:", err);
        }
      }

      // 💡 第二階段遷移：先前版本把「已抽籤月份清單」存在 preLeaveMeta.drawnMonths（全域共用陣列），
      // 這正是造成不同月份抽籤結果互相覆蓋的風險之一，這裡自動把它拆成各月份自己的 isDrawn 欄位
      if (d.preLeaveMeta?.drawnMonths && Array.isArray(d.preLeaveMeta.drawnMonths) && d.preLeaveMeta.drawnMonths.length > 0) {
        try {
          for (const m of d.preLeaveMeta.drawnMonths) {
            await setDoc(getMonthDocRef(m), { isDrawn: true }, { merge: true });
          }
          await setDoc(mainDocRef, { 'preLeaveMeta.drawnMonths': deleteField() }, { merge: true });
          console.log(`✅ 已抽籤月份清單搬遷完成，共 ${d.preLeaveMeta.drawnMonths.length} 個月份。`);
        } catch (err) {
          console.error("已抽籤月份清單搬遷失敗:", err);
        }
      }
    }, (error) => console.error("雲端監聽失敗(meta):", error));

    return () => unsubMeta();
  }, []);

  // 💡 監聽 monthlyData 子集合，把每份月份文件重組回本地熟悉的 {月份: {...}} 巢狀結構
  // 這一步是保留舊有元件邏輯 (schedule[currentMonth]...) 完全不需要更動的關鍵
  useEffect(() => {
    const unsubMonths = onSnapshot(monthlyColRef, (snap) => {
      setSchedule(prevSched => {
        const next = { ...prevSched };
        snap.docChanges().forEach(change => {
          const m = change.doc.id;
          const data = change.doc.data();
          if (change.type === 'removed') { delete next[m]; return; }
          next[m] = data.schedule || {};
        });
        return next;
      });
      setCellColors(prevColors => {
        const next = { ...prevColors };
        snap.docChanges().forEach(change => {
          const m = change.doc.id;
          const data = change.doc.data();
          if (change.type === 'removed') { delete next[m]; return; }
          next[m] = data.cellColors || {};
        });
        return next;
      });
      setPreLeaveData(prevPreLeave => {
        const nextApps = { ...(prevPreLeave.apps || {}) };
        const nextDailyLimits = { ...(prevPreLeave.dailyLimits || {}) };
        const nextRemarks = { ...(prevPreLeave.remarks || {}) };
        const nextDrawnSet = new Set(prevPreLeave.drawnMonths || []);
        snap.docChanges().forEach(change => {
          const m = change.doc.id;
          const data = change.doc.data();
          if (change.type === 'removed') { delete nextApps[m]; delete nextDailyLimits[m]; delete nextRemarks[m]; nextDrawnSet.delete(m); return; }
          nextApps[m] = data.apps || {};
          nextDailyLimits[m] = data.dailyLimits || {};
          nextRemarks[m] = data.remarks || {};
          // 💡 「本月是否已抽籤」改成看該月份自己的文件裡的 isDrawn 欄位，
          // 不再共用一個全域陣列，避免不同月份的抽籤結果互相覆蓋
          if (data.isDrawn === true) nextDrawnSet.add(m); else nextDrawnSet.delete(m);
        });
        return { ...prevPreLeave, apps: nextApps, dailyLimits: nextDailyLimits, remarks: nextRemarks, drawnMonths: Array.from(nextDrawnSet) };
      });
      setSwapRequestsByMonth(prev => {
        const next = { ...prev };
        snap.docChanges().forEach(change => {
          const m = change.doc.id;
          const data = change.doc.data();
          if (change.type === 'removed') { delete next[m]; return; }
          next[m] = (data.swapRequests || []).map(req => cleanBundleData(req));
        });
        return next;
      });
    }, (error) => console.error("雲端監聽失敗(monthlyData):", error));

    return () => unsubMonths();
  }, []);

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

const handleLoginAction = async (id, pwd) => {
  const emp = employees.find(e => e.id === id);
  if (!emp) { alert("無此員編權限。"); return; }

  // 💡 修正核心：不再依賴「本地可能過期的 employees 陣列」判斷密碼，
  // 一律用 transaction 讀取雲端當下最新的那一筆資料來驗證/設定密碼，
  // 這樣即使有其他人剛好也在修改別的員工資料，也不會互相干擾、更不會讓密碼「無端變動」。
  let loginResult = null;
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(mainDocRef);
      const latestEmployees = (snap.exists() && snap.data().employees) ? snap.data().employees : employees;
      const latestEmp = latestEmployees.find(e => e.id === id);
      if (!latestEmp) { loginResult = { ok: false, msg: "無此員編權限。" }; return; }

      if (latestEmp.password === "" || latestEmp.password === pwd) {
        if (latestEmp.password === "" && pwd !== "") {
          // 首次登入自動設定密碼：只更新這一位員工，其餘人完全不受影響
          const nextEmployees = latestEmployees.map(e => e.id === latestEmp.id ? { ...e, password: pwd } : e);
          tx.set(mainDocRef, { employees: nextEmployees }, { merge: true });
          loginResult = { ok: true, emp: { ...latestEmp, password: pwd } };
        } else {
          loginResult = { ok: true, emp: latestEmp };
        }
      } else {
        loginResult = { ok: false, msg: "密碼錯誤！" };
      }
    });
  } catch (error) {
    console.error("登入 Transaction 失敗:", error);
    loginResult = { ok: false, msg: "登入時發生錯誤，請重新嘗試。" };
  }

  if (!loginResult || !loginResult.ok) { alert(loginResult?.msg || "登入失敗。"); return; }

  setCurrentUser(loginResult.emp);
  setIsLoggedIn(true);

  // 💡 防呆：帳號/班別/排班/報表 僅限管理員(role 0)使用，即使是透過 pendingPage 導向也要再檢查一次
  const adminOnlyPages = ['account', 'shifts', 'schedule', 'report'];
  if (pendingPage) {
    if (adminOnlyPages.includes(pendingPage) && loginResult.emp.role !== '0') {
      alert("此功能僅限管理員使用。");
      setCurrentPage('home');
    } else {
      setCurrentPage(pendingPage);
    }
    setPendingPage(null);
  } else { setCurrentPage('home'); }
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

    if (swapTarget.participants.some(p => p.id === targetEmp.id)) {
      alert("此人已在連鎖換班名單中。");
      return;
    }

    const newParticipants = [
      ...swapTarget.participants,
      { id: targetEmp.id, name: targetEmp.name, oldShift: targetShift }
    ];

    setSwapTarget({ ...swapTarget, participants: newParticipants });
    setIsModalOpen(true);
    return;
  }

  // 【首選模式】：點選第一個換班對象
  const clickedMonth = dayInfo.fullDate.substring(0, 7);
  const myShift = normalize(schedule[clickedMonth]?.[currentUser.name]?.[dayInfo.day]);

  let isBundle = false, startDate = dayInfo.fullDate, endDate = dayInfo.fullDate, daysToSwap = [dayInfo.fullDate];
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

        startDate = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`;
        endDate = `${fri.getFullYear()}-${String(fri.getMonth() + 1).padStart(2, '0')}-${String(fri.getDate()).padStart(2, '0')}`;

        daysToSwap = []; 
        for (let i = 0; i < 5; i++) { 
          const d = new Date(mon); 
          d.setDate(mon.getDate() + i); 
          const yStr = d.getFullYear();
          const mStr = String(d.getMonth() + 1).padStart(2, '0');
          const dStr = String(d.getDate()).padStart(2, '0');
          daysToSwap.push(`${yStr}-${mStr}-${dStr}`); 
        }
      }
    } else if (type === 'A3') {
      if (dOfW >= 1 && dOfW <= 4) {
        isBundle = true;
        const mon = new Date(targetDate); mon.setDate(targetDate.getDate() - (dOfW - 1));
        const thu = new Date(mon); thu.setDate(mon.getDate() + 3);

        startDate = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`;
        endDate = `${thu.getFullYear()}-${String(thu.getMonth() + 1).padStart(2, '0')}-${String(thu.getDate()).padStart(2, '0')}`;

        daysToSwap = []; 
        for (let i = 0; i < 4; i++) { 
          const d = new Date(mon); 
          d.setDate(mon.getDate() + i); 
          const yStr = d.getFullYear();
          const mStr = String(d.getMonth() + 1).padStart(2, '0');
          const dStr = String(d.getDate()).padStart(2, '0');
          daysToSwap.push(`${yStr}-${mStr}-${dStr}`); 
        }
      }
    } else if (type === 'P') {
    if (dOfW === 6 || dOfW === 0 || (dOfW >= 1 && dOfW <= 4)) {
      isBundle = true;

      const sat = new Date(targetDate);
      if (dOfW === 6) {
        // 週六：不變
      } else if (dOfW === 0) {
        sat.setDate(targetDate.getDate() - 1);
      } else {
        sat.setDate(targetDate.getDate() - (dOfW + 1));
      }

      const endDay = new Date(sat);
      endDay.setDate(sat.getDate() + 13);

      startDate = `${sat.getFullYear()}-${String(sat.getMonth() + 1).padStart(2, '0')}-${String(sat.getDate()).padStart(2, '0')}`;
      endDate = `${endDay.getFullYear()}-${String(endDay.getMonth() + 1).padStart(2, '0')}-${String(endDay.getDate()).padStart(2, '0')}`;

      daysToSwap = [];
      for (let i = 0; i < 14; i++) {
        const d = new Date(sat);
        d.setDate(sat.getDate() + i);

        const yStr = d.getFullYear();
        const mStr = String(d.getMonth() + 1).padStart(2, '0');
        const dStr = String(d.getDate()).padStart(2, '0');

        daysToSwap.push(`${yStr}-${mStr}-${dStr}`); 
      }
    }

    const isCreatorLocked = daysToSwap.some(d => currentUser.applyingDates?.includes(d));
    const isTargetLocked = daysToSwap.some(d => targetEmp.applyingDates?.includes(d));

    if (isCreatorLocked || isTargetLocked) {
      alert(`無法換班：這段整段換班的區間內，您或對方已經有其他的換班申請正在流程中了！\n（整段區間若與他人申請重疊，將被禁止換班）`);
      return; // 攔截！不顯示換班視窗
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
    participants: [
      { id: currentUser.id, name: currentUser.name, oldShift: myShift },
      { id: targetEmp.id, name: targetEmp.name, oldShift: targetShift }
    ],
    isBundle, startDate, endDate, daysToSwap
  });

  setIsModalOpen(true);
};

const handleSwapBack = () => {
  if (!swapTarget || swapTarget.participants.length <= 2) return;
  const newParticipants = [...swapTarget.participants];
  newParticipants.pop();
  setSwapTarget({ ...swapTarget, participants: newParticipants });
};

const handleRecordAction = (req, action) => {
  // 💡 解鎖名單內所有人的日期鎖：透過 transaction 對雲端最新員工資料操作，避免覆蓋其他人剛好也在做的變更
  const unlockParticipantIds = req.participants ? req.participants.map(p => p.id) : [req.creatorId, req.targetId];
  let datesToUnlock = req.date ? [req.date] : [];
  if (req.isBundle && Array.isArray(req.daysToSwap)) {
    datesToUnlock = [...req.daysToSwap];
  }

  const doUnlock = () => {
    updateEmployees(latest => latest.map(e => {
      if (!unlockParticipantIds.includes(e.id)) return e;
      const currentDates = e.applyingDates || [];
      return { ...e, applyingDates: currentDates.filter(d => !datesToUnlock.includes(d)) };
    }));
    if (currentUser && unlockParticipantIds.includes(currentUser.id)) {
      setCurrentUser(prev => ({ ...prev, applyingDates: (prev.applyingDates || []).filter(d => !datesToUnlock.includes(d)) }));
    }
  };

  const reqMonthKey = getReqMonthKey(req);

  if (action === 'Approve') {
    if (req.status === 'WaitingParticipants') {
      patchSwapRequestsMonth(reqMonthKey, list => list.map(r => r.id === req.id ? { ...r, status: 'PendingAdmin' } : r));
    } 
    else if (req.status === 'PendingAdmin') {
      const targetMonthKey = req.date ? req.date.substring(0, 7) : currentMonth;

      let isAllShiftsValid = true;
      let errorMsg = "";

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
      const monthSchedBase = deepClone(schedule[targetMonthKey] || {});

      let daysArray = [];
        if (req.isBundle && req.daysToSwap) {
          daysArray = [...req.daysToSwap];
        } else {
          const exactDay = req.day || (req.date ? Number(req.date.split('-')[2]) : null);
          if (exactDay) daysArray = [exactDay];
        }

      daysArray.forEach(dRaw => {
        // daysToSwap 可能是 "YYYY-MM-DD"（整段換班）或純數字（單日換班），統一換算成當月的「日」數字
        const d = req.isBundle ? Number(String(dRaw).split('-')[2]) : dRaw;
        if (!req.participants || req.participants.length < 2) return;

        const originalShifts = req.participants.map(p => {
          if (!monthSchedBase[p.name]) monthSchedBase[p.name] = {};
          return monthSchedBase[p.name][d] || "-";
        });

        req.participants.forEach((p, idx) => {
          const nextIdx = (idx + 1) % req.participants.length;
          monthSchedBase[p.name][d] = originalShifts[nextIdx];
        });
      });

      setSchedule(prev => ({ ...prev, [targetMonthKey]: monthSchedBase }));

      // 💡 分流寫入：schedule 只存到「目標月份自己的文件」；換班紀錄只更新這一筆申請所屬的月份文件
      saveScheduleMonth(targetMonthKey, monthSchedBase);
      patchSwapRequestsMonth(reqMonthKey, list => list.map(r => r.id === req.id ? { ...r, status: nextStatus } : r));
      doUnlock();
    }
  } 
  else if (action === 'Reject' || action === 'Delete') {
    patchSwapRequestsMonth(reqMonthKey, list => (action === 'Delete')
      ? list.filter(r => r.id !== req.id)
      : list.map(r => r.id === req.id ? { ...r, status: 'Rejected' } : r));
    doUnlock();
  }
};

const handleParticipantApprove = (reqId) => {
  // 先找出這筆申請屬於哪個月份，才能只更新那個月份自己的文件
  const monthKey = Object.keys(swapRequestsByMonth).find(m => (swapRequestsByMonth[m] || []).some(r => r.id === reqId));
  if (!monthKey) return;

  patchSwapRequestsMonth(monthKey, list => list.map(req => {
    if (req.id !== reqId) return req;
    const nextApprovals = (req.approvals || []).map(a => 
      a.id === currentUser.id 
        ? { ...a, status: 'Approved', updatedAt: new Date().toISOString() } 
        : a
    );
    const allOthersApproved = nextApprovals.every(a => a.status === 'Approved');
    return { ...req, approvals: nextApprovals, status: allOthersApproved ? 'PendingAdmin' : 'WaitingParticipants' };
  }));
};

    const exportScheduleCSV = (prefix = "") => {
    const rt = toROCTitle(currentMonth), fp = prefix ? `${prefix}_` : "";
    let csv = `\ufeff台大醫院雲林分院藥劑部 ${rt} 班表,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,\n`; csv += "員編,姓名," + daysInMonth.map(d => `${d.day}(${d.dayOfWeek})`).join(",") + "\n";
    employees.forEach(emp => { if (emp.isSeparator) return; let row = [emp.id, emp.name]; daysInMonth.forEach(d => row.push(schedule[currentMonth]?.[emp.name]?.[d.day] || "-")); csv += row.join(",") + "\n"; });
    const b = new Blob([csv], { type: 'text/csv;charset=utf-8' }), l = document.createElement("a"); l.href = URL.createObjectURL(b); l.download = `${fp}班表_${currentMonth}.csv`; l.click();
  };

  // ---------------------------------------------------------------------------------
  // 💡 系統完整備份 / 還原 (對應「Firestore 欄位數上限、想手動下載備份」需求)
  // 下載：把 meta 文件 + 全部 monthlyData 子集合文件，打包成一份 JSON 讓管理員存在自己電腦
  // 上傳：讀取 JSON，寫回 meta 文件與每一份月份文件 (逐一 setDoc，不受 20000 欄位限制影響)
  // ---------------------------------------------------------------------------------
  const handleExportFullBackup = async () => {
    try {
      const metaSnap = await getDoc(mainDocRef);
      const meta = metaSnap.exists() ? metaSnap.data() : {};
      const monthsSnap = await getDocs(monthlyColRef);
      const monthlyData = {};
      monthsSnap.forEach(docSnap => { monthlyData[docSnap.id] = docSnap.data(); });

      const backup = {
        exportedAt: new Date().toISOString(),
        version: 'V1.9',
        meta: {
          employees: meta.employees || [],
          shifts: meta.shifts || [],
          holidays: meta.holidays || {},
          personDayRules: meta.personDayRules || [],
          // 💡 換班紀錄現在存在各月份文件裡（monthlyData 已包含），這裡不再重複備份
          preLeaveMeta: meta.preLeaveMeta || { weekendLimit: 10, weekdayLimit: 3, lotteryDay: 15, drawnMonths: [] }
        },
        monthlyData
      };

      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8;' });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `藥劑部班表系統_完整備份_${new Date().toISOString().split('T')[0]}.json`;
      link.click();
    } catch (error) {
      console.error("備份下載失敗:", error);
      alert("備份下載失敗，請檢查網路連線後再試一次。");
    }
  };

  const handleImportFullBackup = (file) => {
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const backup = JSON.parse(ev.target.result);
        if (!backup || !backup.meta) { alert("備份檔格式錯誤，找不到 meta 資料。"); return; }

        const confirmRestore = window.confirm(
          `⚠️ 即將用此備份檔(匯出時間: ${backup.exportedAt || '未知'})覆蓋雲端目前的所有資料！\n\n` +
          `包含：人員名冊、班別代碼、假日設定、人日規則、換班紀錄，以及全部月份的班表/顏色/預假資料。\n\n` +
          `此動作無法復原，確定要繼續嗎？`
        );
        if (!confirmRestore) return;

        await setDoc(mainDocRef, {
          employees: backup.meta.employees || [],
          shifts: backup.meta.shifts || [],
          holidays: backup.meta.holidays || {},
          personDayRules: backup.meta.personDayRules || [],
          preLeaveMeta: backup.meta.preLeaveMeta || { weekendLimit: 10, weekdayLimit: 3, lotteryDay: 15, drawnMonths: [] },
          // 順手清掉舊版可能殘留在主文件裡的舊格式欄位（包含舊版把換班紀錄整包放在這裡的情況）
          schedule: deleteField(),
          cellColors: deleteField(),
          preLeaveData: deleteField(),
          swapRequests: deleteField()
        }, { merge: true });

        const monthlyData = deepClone(backup.monthlyData || {});

        // 💡 相容舊版備份檔：如果備份是舊格式、換班紀錄整包放在 meta.swapRequests，
        // 依每筆申請的日期分組，補進對應月份的 monthlyData 裡再一起寫回
        if (backup.meta.swapRequests && Array.isArray(backup.meta.swapRequests)) {
          backup.meta.swapRequests.forEach(req => {
            const m = getReqMonthKey(req);
            if (!monthlyData[m]) monthlyData[m] = {};
            if (!Array.isArray(monthlyData[m].swapRequests)) monthlyData[m].swapRequests = [];
            monthlyData[m].swapRequests.push(req);
          });
        }

        for (const monthKey of Object.keys(monthlyData)) {
          await setDoc(getMonthDocRef(monthKey), monthlyData[monthKey], { merge: true });
        }

        alert(`還原完成！已寫回 ${Object.keys(monthlyData).length} 個月份的資料。`);
      } catch (error) {
        console.error("還原失敗:", error);
        alert("還原失敗，請確認上傳的是本系統匯出的備份 JSON 檔。");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex flex-col h-screen bg-white font-sans text-gray-900 overflow-hidden">
      <Header 
        currentMonth={currentMonth} 
        setCurrentMonth={setCurrentMonth} 
        currentPage={currentPage} 
        handlePageChange={handlePageChange} 
        isLoggedIn={isLoggedIn} 
        currentUser={currentUser} 
        handleLogout={()=>{setIsLoggedIn(false); setCurrentUser(null); setCurrentPage('home');}} 
        exportScheduleCSV={exportScheduleCSV} 
        swapRequests={swapRequests} 
        isDirty={isDirty}
      />
      <main className="flex-grow flex flex-col overflow-hidden">
        {(() => {
          const isAdmin = currentUser?.role === '0';
          const adminOnlyPages = ['account', 'shifts', 'schedule', 'report'];
          // 💡 防呆：即使頁面被直接切換過去（例如網址列/重整），非管理員一律導回首頁
          if (adminOnlyPages.includes(currentPage) && !isAdmin) {
            return (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
                <ShieldAlert size={40} />
                <p className="font-black">此功能僅限管理員使用</p>
              </div>
            );
          }
          switch (currentPage) {
            case 'home': return <ScheduleTableView currentMonth={currentMonth} employees={employees} schedule={schedule} cellColors={cellColors} daysInMonth={daysInMonth} swapRequests={swapRequests} currentPage={currentPage} currentUser={currentUser} />;
            case 'account': return <AccountManagementView employees={employees} updateEmployees={updateEmployees} setDeleteTarget={setDeleteTarget} onExportFullBackup={handleExportFullBackup} onImportFullBackup={handleImportFullBackup} />;
            case 'shifts': return <ShiftsManagementView shifts={shifts} updateShifts={updateShifts} holidays={holidays} updateHolidays={updateHolidays} setDeleteShiftTarget={setDeleteShiftTarget} personDayRules={personDayRules} updatePersonDayRules={updatePersonDayRules} />;
            case 'swap': return <ScheduleTableView currentMonth={currentMonth} employees={employees} schedule={schedule} cellColors={cellColors} daysInMonth={daysInMonth} onCellClick={handleSwapApply} swapRequests={swapRequests} currentPage={currentPage} currentUser={currentUser} swapTarget={swapTarget} handleSwapBack={handleSwapBack} isCycleEnd={isCycleEnd}/>;
            case 'records': return <RecordsView currentUser={currentUser} swapRequests={swapRequests} onAction={handleRecordAction} onApprove={handleParticipantApprove} setRejectingReq={setRejectingReq} schedule={schedule} currentMonth={currentMonth} />;
            case 'leave':  return  <PreLeaveView currentMonth={currentMonth} employees={employees} daysInMonth={daysInMonth} currentUser={currentUser} schedule={schedule} setSchedule={setSchedule} preLeaveData={preLeaveData} setPreLeaveData={setPreLeaveData} savePreLeaveMonth={savePreLeaveMonth} saveMetaPreLeave={saveMetaPreLeave} saveScheduleMonth={saveScheduleMonth} runLotteryTransaction={runLotteryTransaction} resetMonthDraw={resetMonthDraw} />;
            case 'schedule': return <SchedulingView currentMonth={currentMonth} employees={employees} daysInMonth={daysInMonth} schedule={schedule} setSchedule={setSchedule} cellColors={cellColors} setCellColors={setCellColors} shifts={shifts} exportScheduleCSV={exportScheduleCSV} setCurrentPage={setCurrentPage} setIsDirty={setIsDirty} saveScheduleMonth={saveScheduleMonth} saveCellColorsMonth={saveCellColorsMonth} preLeaveData={preLeaveData} setPreLeaveData={setPreLeaveData} savePreLeaveMonth={savePreLeaveMonth} isAdmin={currentUser?.role === '0'} isMonthDrawn={(preLeaveData.drawnMonths || []).includes(currentMonth)} /> ;
            case 'report': return <ManagementReportView currentMonth={currentMonth} employees={employees} schedule={schedule} personDayRules={personDayRules} holidays={holidays} shifts={shifts} cellColors={cellColors}/>;
            case 'login': {
              return <LoginPage employees={employees} onLogin={handleLoginAction} />;
            }
            default: return null;
          }
        })()}
      </main>
      <Modal isOpen={showExitConfirm} onClose={() => { setShowExitConfirm(false); setTargetPage(null); }} onConfirm={confirmExit} title="班表尚未發佈" message="您有變更排班表，但尚未「發佈班表」。確定要離開嗎？" confirmText="仍要離開" cancelText="留在這裏" />

      <SwapRequestModal 
        isOpen={isModalOpen && !!swapTarget}  
        data={swapTarget} 
        schedule={schedule} 
        currentMonth={currentMonth}
        setIsModalOpen={setIsModalOpen}
        handleSwapBack={handleSwapBack} 
        onClose={() => { 
          setSwapTarget(null); 
          setIsModalOpen(false); 
        }} 
        onConfirm={() => {
          const targetDateStr = swapTarget.date;

          const approvalList = swapTarget.participants
            .filter(p => p.id !== currentUser.id)
            .map(p => ({ id: p.id, name: p.name, status: 'Pending', updatedAt: null }));

          const newRequest = {
            id: Date.now().toString(),
            type: swapTarget.isBundle ? 'Bundle' : 'Single',
            status: 'WaitingParticipants',
            date: targetDateStr,
            day: swapTarget.day,
            timestamp: Date.now(),
            participants: swapTarget.participants,
            approvals: approvalList,
            createdAt: new Date().toISOString(),
            creatorId: swapTarget.creatorId,
            creatorName: swapTarget.creatorName,
            creatorShift: swapTarget.creatorShift,
            targetId: swapTarget.targetId,
            targetName: swapTarget.targetName,
            targetShift: swapTarget.targetShift,
            isBundle: swapTarget.isBundle,
            startDate: swapTarget.startDate,
            endDate: swapTarget.endDate,
            daysToSwap: swapTarget.daysToSwap
          };

          let datesToLock = [targetDateStr];
          if (swapTarget.isBundle && swapTarget.daysToSwap) {
            datesToLock = [...swapTarget.daysToSwap];
          }

          const allParticipantIds = swapTarget.participants.map(p => p.id);

          // 💡 新申請只會寫入「這筆申請所屬月份」自己的文件，不會動到其他月份的換班紀錄
          patchSwapRequestsMonth(getReqMonthKey(newRequest), list => [newRequest, ...list]);

          // 💡 上鎖同樣走 transaction 安全更新，避免跟其他同時發生的員工異動互相覆蓋
          updateEmployees(latest => latest.map(e => {
            if (!allParticipantIds.includes(e.id)) return e;
            const dates = Array.isArray(e.applyingDates) ? e.applyingDates : [];
            return { ...e, applyingDates: Array.from(new Set([...dates, ...datesToLock])) };
          }));

          if (currentUser) {
            setCurrentUser(prev => ({
              ...prev,
              applyingDates: Array.from(new Set([...(prev.applyingDates || []), ...datesToLock]))
            }));
          }

          setSwapTarget(null);
          setIsModalOpen(false);
        }}
      />

      <Modal 
        isOpen={!!rejectingReq} 
        onClose={()=>setRejectingReq(null)} 
        onConfirm={()=>{ 
          const participantsToUnlock = rejectingReq.participants 
            ? rejectingReq.participants.map(p => p.id) 
            : [rejectingReq.creatorId, rejectingReq.targetId];

          let datesToUnlock = rejectingReq.date ? [rejectingReq.date] : [];
          if (rejectingReq.isBundle && Array.isArray(rejectingReq.daysToSwap)) {
            datesToUnlock = [...rejectingReq.daysToSwap];
          }

          patchSwapRequestsMonth(getReqMonthKey(rejectingReq), list => list.map(r => r.id === rejectingReq.id ? { ...r, status: 'Rejected', adminNote: rejectNote || "管理員否決" } : r));

          updateEmployees(latest => latest.map(e => {
            if (!participantsToUnlock.includes(e.id)) return e;
            const currentDates = e.applyingDates || [];
            return { ...e, applyingDates: currentDates.filter(d => !datesToUnlock.includes(d)) };
          }));

          if (currentUser && participantsToUnlock.includes(currentUser.id)) {
            setCurrentUser(prev => ({
              ...prev,
              applyingDates: (prev.applyingDates || []).filter(d => !datesToUnlock.includes(d))
            }));
          }

          setRejectNote(""); 
          setRejectingReq(null); 
        }} 
        title="否決換班申請" 
        confirmText="確認否決"
      >
        <textarea className="w-full border-2 rounded-2xl p-3 text-sm outline-none" placeholder="原因..." rows={3} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} />
      </Modal>
      <Modal isOpen={!!deleteTarget} onClose={()=>setDeleteTarget(null)} onConfirm={()=>{ updateEmployees(latest => latest.filter(e=>e.id!==deleteTarget.id)); setDeleteTarget(null); }} title="確定刪除人員？" message="移除該人員將影響本期報表。" />
      <Modal isOpen={!!deleteShiftTarget} onClose={()=>setDeleteShiftTarget(null)} onConfirm={()=>{ updateShifts(latest => latest.filter(s=>s.id!==deleteShiftTarget.id)); setDeleteShiftTarget(null); }} title="確定刪除班別？" message={`移除 ${deleteShiftTarget?.name}。`} />
    </div>
  );
};

// =====================================================================================
// 💡 登入頁 V1.10：改為兩步驟，從根本解決「密碼被離奇改變」的真正成因
//    真正的成因不是資料庫時間差，而是「密碼欄位是空的（新人或剛被重設）時，
//    系統會把第一次輸入的任何內容直接當成新密碼」，一旦手滑打錯，
//    那個打錯的內容就永久變成正式密碼。
//    解法：輸入員編後，先判斷密碼是否為空 —
//      - 空的 → 進入「設定新密碼」模式，強制輸入兩次且必須一致才能繼續
//      - 不是空的 → 維持原本單一密碼欄位登入
// =====================================================================================
const LoginPage = ({ employees, onLogin }) => {
  const [step, setStep] = useState('id'); // 'id' | 'setpass' | 'password'
  const [id, setId] = useState('');
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [showPwd, setShowPwd] = useState(false);

  const resetToIdStep = () => { setStep('id'); setPwd(''); setPwd2(''); setShowPwd(false); };

  const handleContinue = () => {
    const trimmedId = id.trim().toUpperCase();
    if (!trimmedId) { alert("請輸入員編！"); return; }
    const emp = employees.find(e => e.id === trimmedId);
    if (!emp) { alert("無此員編權限。"); return; }
    setId(trimmedId);
    // 💡 防止裝置/瀏覽器自動填入殘留的舊值（例如共用裝置上一位同仁留下的自動填入密碼），
    // 切換到下一步時強制清空密碼欄位，一定要讓同仁自己重新手動輸入
    setPwd('');
    setPwd2('');
    if (emp.password === "") {
      // 💡 設定新密碼時預設「顯示明碼」，讓同仁能親眼確認自己打的（或被自動填入的）內容是否正確，
      // 而不是被遮住的圓點，看不出來是不是被瀏覽器自動帶入了錯誤/別人的密碼
      setShowPwd(true);
      setStep('setpass');
    } else {
      setShowPwd(false);
      setStep('password');
    }
  };

  const handleSubmitPassword = () => {
    if (!pwd) { alert("請輸入密碼！"); return; }
    onLogin(id, pwd);
  };

  const handleSubmitNewPassword = () => {
    if (!pwd || !pwd2) { alert("請輸入兩次新密碼！"); return; }
    if (pwd !== pwd2) { alert("兩次輸入的新密碼不一致，請重新輸入。"); setPwd(''); setPwd2(''); return; }
    const confirmOk = window.confirm(`請再次確認畫面上顯示的新密碼是您自己要設定的內容：\n\n${pwd}\n\n（若這是共用裝置，密碼可能被瀏覽器自動填入錯誤內容，請仔細核對後再繼續）`);
    if (!confirmOk) return;
    onLogin(id, pwd);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-4">
      <div className="bg-white p-10 rounded-[2.5rem] shadow-2xl border max-w-sm w-full text-center">
        <h2 className="text-xl font-black mb-2 text-gray-800">藥劑部 班表系統登入</h2>

        {step === 'id' && (
          <>
            <div className="text-[10px] text-gray-400 font-bold mb-8">請先輸入您的員編</div>
            <div className="space-y-4">
              <input
                className="w-full border-2 p-3 rounded-2xl outline-none font-mono text-center uppercase"
                placeholder="員編" value={id}
                autoComplete="off"
                onChange={e => setId(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && handleContinue()}
                autoFocus
              />
              <button onClick={handleContinue} className="w-full bg-blue-600 text-white p-3 rounded-2xl font-black shadow transition-all transform active:scale-95">下一步</button>
            </div>
          </>
        )}

        {step === 'password' && (
          <>
            <div className="text-[10px] text-gray-400 font-bold mb-6">員編：{id}</div>
            <div className="space-y-4">
              <div className="relative">
                <input
                  className="w-full border-2 p-3 rounded-2xl outline-none text-center"
                  type={showPwd ? "text" : "password"} placeholder="密碼" value={pwd}
                  autoComplete="current-password"
                  onChange={e => setPwd(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmitPassword()}
                  autoFocus
                />
                <button onClick={() => setShowPwd(!showPwd)} className="absolute right-4 top-4 text-gray-400">{showPwd ? <Eye size={18}/> : <EyeOff size={18}/>}</button>
              </div>
              <button onClick={handleSubmitPassword} className="w-full bg-blue-600 text-white p-3 rounded-2xl font-black shadow transition-all transform active:scale-95">進入系統</button>
              <button onClick={resetToIdStep} className="w-full text-xs font-bold text-gray-400 hover:text-gray-600">重新輸入員編</button>
            </div>
          </>
        )}

        {step === 'setpass' && (
          <>
            <div className="bg-amber-50 border border-amber-200 text-amber-700 text-[11px] font-bold rounded-xl p-3 mb-6 leading-relaxed">
              ⚠️ 偵測到「{id}」尚未設定密碼（可能是新帳號，或密碼已被管理員重設）。<br/>
              請設定一組新密碼，並輸入兩次以確認沒有打錯。<br/>
              <span className="text-amber-500">若是共用裝置，請留意欄位是否被自動填入非您本人輸入的內容。</span>
            </div>
            <div className="space-y-3">
              <div className="relative">
                <input
                  className="w-full border-2 p-3 rounded-2xl outline-none text-center"
                  type={showPwd ? "text" : "password"} placeholder="設定新密碼" value={pwd}
                  autoComplete="new-password"
                  onChange={e => setPwd(e.target.value)}
                  autoFocus
                />
                <button onClick={() => setShowPwd(!showPwd)} className="absolute right-4 top-4 text-gray-400">{showPwd ? <Eye size={18}/> : <EyeOff size={18}/>}</button>
              </div>
              <input
                className="w-full border-2 p-3 rounded-2xl outline-none text-center"
                type={showPwd ? "text" : "password"} placeholder="再次輸入新密碼確認" value={pwd2}
                autoComplete="new-password"
                onChange={e => setPwd2(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmitNewPassword()}
              />
              <button onClick={handleSubmitNewPassword} className="w-full bg-amber-500 text-white p-3 rounded-2xl font-black shadow transition-all transform active:scale-95">設定密碼並登入</button>
              <button onClick={resetToIdStep} className="w-full text-xs font-bold text-gray-400 hover:text-gray-600">重新輸入員編</button>
            </div>
          </>
        )}
      </div>
      <div className="mt-12 text-[11px] text-gray-400 font-bold tracking-wider">© 2026 NTUH Yunlin Pharmacy - V1.10</div>
    </div>
  );
};

export default App;

// 統一管理所有 Firestore 路徑，絕對不會拼錯段落數！
const getMonthlyDocRef = (db, appId, monthStr) => {
  if (!monthStr) return null;
  // 子集合路徑：8段 (偶數) -> 正確！
  return doc(db, 'artifacts', appId, 'public', 'data', 'roster', 'main', 'monthly_schedules', monthStr);
};

const getMainDocRef = (db, appId) => {
  // 主檔案路徑：6段 (偶數) -> 正確！
  return doc(db, 'artifacts', appId, 'public', 'data', 'roster', 'main');
};

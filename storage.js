// storage.js — localStorage 學習紀錄 + 匯入匯出
const STORAGE_KEY = "vocab-learning-v1";

const DEFAULT_RESET_DAYS = {
  "初級": null,      // null = 永不重設
  "中級": 90,
  "中高級": 60,
  "高級": 30,
  "優級": 30,
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    return {
      mastered: s.mastered || {},
      userAdded: s.userAdded || {},
      heatmap: s.heatmap || {},
      resetDays: { ...DEFAULT_RESET_DAYS, ...(s.resetDays || {}) },
      voiceName: s.voiceName || "auto",
    };
  } catch (e) {
    console.error("loadState 失敗", e);
    return defaultState();
  }
}

function defaultState() {
  return {
    mastered: {},        // { word: { at: ISOString } }
    userAdded: {},       // { word: { z, p } }
    heatmap: {},         // { "YYYY-MM-DD": count }（獨立事件記錄，不受重設影響）
    resetDays: { ...DEFAULT_RESET_DAYS },
    voiceName: "auto",   // 發音語音名稱，"auto" = 自動選擇最好的
  };
}

// 本地日期（避免 toISOString 的 UTC 偏差）
function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// 熱力圖記錄一筆學習事件（mastered 或 added）
function recordEvent(state) {
  const today = localDateKey();
  state.heatmap[today] = (state.heatmap[today] || 0) + 1;
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function exportToFile(state) {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    ...state,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `vocab-learning-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        const state = {
          mastered: data.mastered || {},
          userAdded: data.userAdded || {},
          heatmap: data.heatmap || {},
          resetDays: { ...DEFAULT_RESET_DAYS, ...(data.resetDays || {}) },
        };
        resolve(state);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// 判斷單字是否仍算「已背起來」（考慮等級重設）
function isMastered(word, geptDb, state) {
  const record = state.mastered[word];
  if (!record) return false;

  // 取得等級：先從 GEPT 表找，若是用戶自加則沒有等級 → 視為「中高級」處理
  const entry = geptDb[word];
  const level = entry ? entry.l : "中高級";

  const days = state.resetDays[level];
  if (days === null || days === undefined) return true;  // 永不重設

  const elapsed = (Date.now() - new Date(record.at).getTime()) / 86400000;
  return elapsed < days;
}

function markMastered(word, state) {
  state.mastered[word] = { at: new Date().toISOString() };
  recordEvent(state);
  saveState(state);
}

function addUserWord(word, z, p, state) {
  state.userAdded[word] = { z, p };
  saveState(state);
}

window.VocabStorage = {
  loadState, saveState,
  exportToFile, importFromFile,
  isMastered, markMastered, addUserWord, recordEvent, localDateKey,
  DEFAULT_RESET_DAYS,
};

// storage.js — localStorage 學習紀錄 + 匯入匯出
const STORAGE_KEY = "vocab-learning-v1";

const DEFAULT_RESET_DAYS = {
  "初級": null,      // null = 永不重設
  "中級": 90,
  "中高級": 60,
  "高級": 30,
  "優級": 30,
};

// AI 指令範本：{word} 會被替換成當前單字
// 用於「複習字卡」：有正解可參考，重點是給例句、字根、歷史
const DEFAULT_AI_PROMPT =
  "請針對英文單字「{word}」提供：① 針對正解字義與正解詞性提供實用例句（附中譯）② 字根／字首／字尾拆解 ③ 此字的單字歷史(如能具體到年份範圍也請提供)";

// 用於「新單字加入」：沒有正解，要 AI 幫忙判斷詞性/字義/例句/等級
const DEFAULT_AI_PROMPT_NEW =
  "請針對英文單字「{word}」依下列要求作答：① 主要詞性（從 noun, verb, adj., adv., prep., conj., pron., art., interj., aux., det., inf., number 中挑選；可多個）② 對應每個詞性給中文字義；多詞性時用「／」分隔每組，同詞性內多義用「、」分隔。範例：verb → 拋棄、捨棄、中止；noun → 盡情、放縱 ③ 建議此單字應歸屬的 GEPT 等級（從 初級, 中級, 中高級, 高級, 優級 擇一，並簡短說明依據）④ 對每個詞性各舉一句例句（附中譯）⑤ 字根／字首／字尾拆解 ⑥ 此字的單字歷史（如能具體到年份範圍也請提供）";

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
      aiPrompt: s.aiPrompt || DEFAULT_AI_PROMPT,
      aiPromptNew: s.aiPromptNew || DEFAULT_AI_PROMPT_NEW,
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
    aiPrompt: DEFAULT_AI_PROMPT,        // 複習字卡用
    aiPromptNew: DEFAULT_AI_PROMPT_NEW, // 新單字加入用
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
          voiceName: data.voiceName || "auto",
          aiPrompt: data.aiPrompt || DEFAULT_AI_PROMPT,
          aiPromptNew: data.aiPromptNew || DEFAULT_AI_PROMPT_NEW,
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

  // 取得等級：先從 GEPT 表找；自加單字看 userAdded.l；都沒 → 預設「中高級」
  const entry = geptDb[word];
  const userEntry = state.userAdded[word];
  const level = (entry && entry.l) || (userEntry && userEntry.l) || "中高級";

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

function addUserWord(word, z, p, l, state) {
  state.userAdded[word] = { z, p, l: l || "" };
  saveState(state);
}

window.VocabStorage = {
  loadState, saveState,
  exportToFile, importFromFile,
  isMastered, markMastered, addUserWord, recordEvent, localDateKey,
  DEFAULT_RESET_DAYS, DEFAULT_AI_PROMPT, DEFAULT_AI_PROMPT_NEW,
};

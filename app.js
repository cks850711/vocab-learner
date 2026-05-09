// app.js — 主邏輯：載入 GEPT、處理使用者操作、字卡流程

// 完整覆蓋 GEPT 表規範化後出現的所有詞性
const POS_OPTIONS = [
  "noun", "verb", "adj.", "adv.", "prep.", "conj.",
  "pron.", "art.", "interj.", "aux.", "det.",
  "inf.", "number",
];

let GEPT_DB = {};   // { word: {w, p[], z, l, a, n} }
let STATE = null;   // localStorage 狀態
let queue = [];     // 待複習單字佇列（含 known + unknown）
let queueIdx = 0;
let currentMode = null;  // "known" | "unknown"

// ============== 啟動 ==============
async function init() {
  STATE = window.VocabStorage.loadState();
  setStatus("載入 GEPT 字典中…");
  try {
    const res = await fetch("./gept.json");
    const raw = await res.json();
    GEPT_DB = window.VocabParser.buildGeptDb(raw);
    setStatus(`已載入 ${Object.keys(GEPT_DB).length} 個單字（${raw.length} 條目合併）`);
  } catch (e) {
    setStatus("載入 gept.json 失敗：" + e.message);
    return;
  }
  bindEvents();
  initVoices();
  refreshStats();
  showHome();
}

// ============== 首頁：等級進度 ==============
function showHome() {
  // 統計每個等級的總數和已背數
  const levelTotal = {};   // GEPT 表中各等級單字數
  const levelMastered = {}; // mastered 中各等級的數量
  for (const [w, entry] of Object.entries(GEPT_DB)) {
    const l = entry.l || "未分級";
    levelTotal[l] = (levelTotal[l] || 0) + 1;
    if (STATE.mastered[w]) levelMastered[l] = (levelMastered[l] || 0) + 1;
  }
  const userTotal = Object.keys(STATE.userAdded).length;
  let userMastered = 0;
  for (const w of Object.keys(STATE.userAdded)) {
    if (STATE.mastered[w]) userMastered++;
  }

  const orderedLevels = ["初級", "中級", "中高級", "高級", "優級"];
  const rows = orderedLevels
    .filter(l => levelTotal[l] > 0)
    .map(l => renderProgressRow(l, levelMastered[l] || 0, levelTotal[l]))
    .join("");

  const userRow = userTotal > 0
    ? renderProgressRow("自加", userMastered, userTotal, "user")
    : "";

  document.getElementById("card-area").innerHTML = `
    <div class="home">
      <h2 class="home-title">學習進度</h2>
      ${rows}
      ${userRow || `<div class="home-empty-user">尚無自加單字</div>`}
      ${renderHeatmap()}
    </div>
  `;

  // 清除佇列狀態
  queue = [];
  queueIdx = 0;
}

// 熱力圖：最近 13 週的學習活動（最右欄 = 今天所在週）
function renderHeatmap() {
  const WEEKS = 13;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayOfWeek = today.getDay();  // 0=週日, 6=週六

  // 計算最右欄的最後一格（本週週六）和最左欄的第一格
  const endDate = new Date(today);
  endDate.setDate(today.getDate() + (6 - dayOfWeek));   // 本週週六
  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - (WEEKS * 7 - 1));  // 91 天前

  let totalEvents = 0;
  const levelOf = (c) => c === 0 ? 0 : c <= 2 ? 1 : c <= 5 ? 2 : c <= 10 ? 3 : 4;

  let cellsHtml = "";
  for (let w = 0; w < WEEKS; w++) {
    let week = `<div class="heatmap-week">`;
    for (let d = 0; d < 7; d++) {
      const cur = new Date(startDate);
      cur.setDate(startDate.getDate() + w * 7 + d);
      const isFuture = cur > today;
      const key = window.VocabStorage.localDateKey(cur);
      const c = STATE.heatmap[key] || 0;
      totalEvents += c;
      if (isFuture) {
        week += `<div class="heat-cell" style="visibility:hidden"></div>`;
      } else {
        const lvl = levelOf(c);
        const title = `${key}：${c} 次學習事件`;
        week += `<div class="heat-cell ${lvl > 0 ? "lvl-" + lvl : ""}" title="${title}"></div>`;
      }
    }
    week += `</div>`;
    cellsHtml += week;
  }

  return `
    <div class="heatmap">
      <div class="heatmap-title">
        <span>學習熱力圖</span>
        <small>近 13 週｜共 ${totalEvents} 次學習事件</small>
      </div>
      <div class="heatmap-grid">${cellsHtml}</div>
      <div class="heatmap-legend">
        少
        <div class="heat-cell"></div>
        <div class="heat-cell lvl-1"></div>
        <div class="heat-cell lvl-2"></div>
        <div class="heat-cell lvl-3"></div>
        <div class="heat-cell lvl-4"></div>
        多
      </div>
    </div>
  `;
}

function renderProgressRow(label, done, total, variant) {
  const pct = total > 0 ? (done / total) * 100 : 0;
  const cls = variant === "user" ? "progress-bar progress-user" : "progress-bar";
  return `
    <div class="progress-row">
      <div class="progress-label">${label}</div>
      <div class="progress-track">
        <div class="${cls}" style="width: ${pct.toFixed(1)}%"></div>
      </div>
      <div class="progress-count">${done} / ${total}</div>
    </div>
  `;
}

function bindEvents() {
  document.getElementById("btn-parse").addEventListener("click", onParse);
  document.getElementById("btn-export").addEventListener("click", onExport);
  document.getElementById("btn-home").addEventListener("click", showHome);
  document.getElementById("btn-import").addEventListener("click", () => {
    document.getElementById("file-import").click();
  });
  document.getElementById("file-import").addEventListener("change", onImport);
  document.getElementById("btn-settings").addEventListener("click", openSettings);
  document.getElementById("btn-settings-save").addEventListener("click", saveSettings);
  document.getElementById("btn-settings-cancel").addEventListener("click", closeSettings);
  document.getElementById("btn-test-voice").addEventListener("click", () => {
    const sel = document.getElementById("voice-select").value;
    const voices = getEnglishVoices();
    const tmpVoice = sel === "auto" ? pickBestVoice() : voices.find(v => v.name === sel);
    if (!tmpVoice || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance("Hello, this is a sample voice. The quick brown fox jumps over the lazy dog.");
    u.voice = tmpVoice;
    u.lang = tmpVoice.lang;
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  });
  document.getElementById("btn-reset-mastered").addEventListener("click", () => resetDb("mastered"));
  document.getElementById("btn-reset-userAdded").addEventListener("click", () => resetDb("userAdded"));
  document.getElementById("btn-reset-heatmap").addEventListener("click", () => resetDb("heatmap"));
  document.getElementById("btn-reset-all").addEventListener("click", () => resetDb("all"));

  // 字卡按鈕（事件委派）
  document.getElementById("card-area").addEventListener("click", onCardClick);

  // 設定 modal 點背景關閉
  document.getElementById("settings-modal").addEventListener("click", e => {
    if (e.target.id === "settings-modal") closeSettings();
  });

  // mastered/userAdded 清單按鈕
  document.getElementById("btn-mastered-list").addEventListener("click", openMasteredList);
  document.getElementById("btn-useradded-list").addEventListener("click", openUserAddedList);
  document.getElementById("btn-mastered-close").addEventListener("click", closeMasteredList);
  document.getElementById("btn-useradded-close").addEventListener("click", closeUserAddedList);
  document.getElementById("mastered-modal").addEventListener("click", e => {
    if (e.target.id === "mastered-modal") closeMasteredList();
  });
  document.getElementById("useradded-modal").addEventListener("click", e => {
    if (e.target.id === "useradded-modal") closeUserAddedList();
  });

  // 清單內動作（事件委派）
  document.getElementById("mastered-list-content").addEventListener("click", e => {
    const action = e.target.dataset.action;
    const w = e.target.dataset.word;
    if (action === "unmaster") unmasterWord(w);
  });
  document.getElementById("useradded-list-content").addEventListener("click", e => {
    // POS chip toggle in edit form
    if (e.target.classList?.contains("pos-chip")) {
      e.target.classList.toggle("selected");
      return;
    }
    const action = e.target.dataset.action;
    const w = e.target.dataset.word;
    if (action === "edit-useradded") editUserAdded(w);
    else if (action === "save-edit-useradded") saveEditUserAdded(w);
    else if (action === "cancel-edit-useradded") openUserAddedList();
    else if (action === "delete-useradded") deleteUserAdded(w);
  });
}

// ============== 解析文字 ==============
function onParse() {
  const text = document.getElementById("input-text").value.trim();
  if (!text) {
    setStatus("請先貼上文字");
    return;
  }
  const wordCount = (text.match(/[a-zA-Z]+/g) || []).length;
  if (!confirm(`即將解析這段文字（約 ${wordCount} 個英文詞）。\n\n確定要開始學習？`)) return;
  const { known, masteredSkipped, unknown } = window.VocabParser.parseText(text, GEPT_DB, STATE);

  setStatus(`解析完成：${known.length} 個待複習｜${unknown.length} 個生字｜${masteredSkipped.length} 個已背起來（略過）`);

  // 組成佇列：先 known 後 unknown
  queue = [
    ...known.map(w => ({ word: w, mode: "known" })),
    ...unknown.map(w => ({ word: w, mode: "unknown" })),
  ];
  queueIdx = 0;

  if (queue.length === 0) {
    document.getElementById("card-area").innerHTML = `<div class="empty">沒有需要複習的單字 🎉</div>`;
    return;
  }

  showCurrentCard();
}

// ============== 字卡顯示 ==============
function showCurrentCard() {
  if (queueIdx >= queue.length) {
    document.getElementById("card-area").innerHTML = `
      <div class="empty">
        全部完成 🎉<br>
        <button class="btn-secondary" onclick="document.getElementById('input-text').focus()">繼續下一段</button>
      </div>`;
    refreshStats();
    return;
  }

  const { word, mode } = queue[queueIdx];
  currentMode = mode;
  const progress = `${queueIdx + 1} / ${queue.length}`;

  // 生字（第一次出現）→ 直接進入「輸入字義」表單，不要 OX prompt
  if (mode === "unknown") {
    showUnknownForm(word, progress);
    return;
  }

  // 已知字（含 userAdded）→ OX prompt
  document.getElementById("card-area").innerHTML = `
    <div class="card" data-stage="prompt">
      <div class="card-header">
        <span class="progress">${progress}</span>
        ${renderLevelTag(word)}
      </div>
      ${renderCardWord(word)}
      <div class="card-actions">
        <button class="btn-x" data-action="x">✗</button>
        <button class="btn-o" data-action="o">○</button>
      </div>
    </div>
  `;
}

// ============== 發音 ==============
let _selectedVoice = null;

function getEnglishVoices() {
  if (!("speechSynthesis" in window)) return [];
  return window.speechSynthesis.getVoices()
    .filter(v => v.lang && v.lang.toLowerCase().startsWith("en"));
}

function pickBestVoice() {
  const en = getEnglishVoices();
  if (!en.length) return null;

  // 優先順序：高品質語音（Premium/進階版 > Enhanced > Apple 新世代 > 經典）
  const tiers = [
    /\b(premium|進階)\b/i,                           // 1. macOS 「進階版」
    /\b(enhanced|增強)\b/i,                          // 2. macOS Enhanced
    /natural|neural/i,                                // 3. Microsoft Neural / 其他自然語音
    /^Google /,                                       // 4. Chrome Google 語音
    /^(Eddy|Flo|Reed|Sandy|Shelley|Rocko)\b/,        // 5. Apple Sonoma 新世代表情語音
    /^(Samantha|Ava|Allison|Zoe|Evan|Susan|Tom)\b/,  // 6. 美式經典高品質
    /^(Karen|Daniel|Moira|Tessa)\b/,                 // 7. 英/澳/愛/南非腔高品質
  ];
  for (const re of tiers) {
    const v = en.find(v => re.test(v.name));
    if (v) return v;
  }
  // 退而求其次：避開機械/玩具聲
  const blacklist = /alex|albert|bahh|bells|boing|bubbles|cellos|deranged|fred|hysterical|junior|kathy|organ|princess|ralph|trinoids|whisper|wobble|zarvox|jester|superstar|bad news|good news|grandma|grandpa/i;
  return en.find(v => !blacklist.test(v.name)) || en[0];
}

function getActiveVoice() {
  const pref = STATE?.voiceName || "auto";
  if (pref !== "auto") {
    const v = getEnglishVoices().find(v => v.name === pref);
    if (v) return v;
  }
  return pickBestVoice();
}

function initVoices() {
  if (!("speechSynthesis" in window)) return;
  _selectedVoice = getActiveVoice();
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.addEventListener("voiceschanged", () => {
      _selectedVoice = getActiveVoice();
    });
  }
}

function speakWord(word) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(word);
  utter.lang = _selectedVoice?.lang || "en-US";
  utter.rate = 0.95;
  utter.pitch = 1.0;
  if (_selectedVoice) utter.voice = _selectedVoice;
  window.speechSynthesis.speak(utter);
}

// 字卡標題（單字 + 發音按鈕）
function renderCardWord(word) {
  return `
    <div class="card-word-row">
      <span class="card-word">${word}</span>
      <button class="btn-speak" data-action="speak" data-word="${word}" title="發音" aria-label="發音">🔊</button>
    </div>
  `;
}

// 顯示單字的等級標籤：GEPT 字 → 等級（藍色）；自加 → 「自加」（紫色）
function renderLevelTag(word) {
  const entry = GEPT_DB[word];
  if (entry && entry.l) {
    return `<span class="tag tag-level">${entry.l}</span>`;
  }
  if (STATE.userAdded[word]) {
    return `<span class="tag tag-user">自加</span>`;
  }
  return `<span class="tag">未知</span>`;
}

// 生字第一次：要求輸入字義 + 詞性，送出後加入 userAdded，不進 mastered
function showUnknownForm(word, progress) {
  const posCheckboxes = POS_OPTIONS.map(p => `
    <button type="button" class="pos-chip" data-pos="${p}">${p}</button>
  `).join("");

  document.getElementById("card-area").innerHTML = `
    <div class="card" data-stage="unknown-form">
      <div class="card-header">
        <span class="progress">${progress}</span>
        <span class="tag tag-user">自加</span>
      </div>
      ${renderCardWord(word)}
      <div class="hint">新單字，請輸入字義加入單字庫</div>
      <div class="form-row">
        <label>字義</label>
        <input type="text" id="user-meaning" placeholder="輸入中文字義" autofocus>
      </div>
      <div class="form-row">
        <label>詞性（可多選）</label>
        <div class="pos-grid">${posCheckboxes}</div>
      </div>
      <div class="card-actions">
        <button class="btn-primary" data-action="save-unknown">加入單字庫</button>
      </div>
    </div>
  `;
  const inp = document.getElementById("user-meaning");
  inp.focus();
  inp.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    if (e.isComposing || e.keyCode === 229) return;
    handleSaveUnknown(word);
  });
}

function handleSaveUnknown(word) {
  const userMeaning = document.getElementById("user-meaning").value.trim();
  const userPos = Array.from(document.querySelectorAll(".pos-chip.selected")).map(b => b.dataset.pos);
  // 無條件寫入 userAdded（即使字義為空也寫，避免資料遺失）
  window.VocabStorage.addUserWord(word, userMeaning, userPos, STATE);
  refreshStats();
  queueIdx++;
  showCurrentCard();
}

function onCardClick(e) {
  // POS chip toggle
  if (e.target.classList?.contains("pos-chip")) {
    e.target.classList.toggle("selected");
    return;
  }

  const action = e.target.dataset.action;
  if (!action) return;

  // 發音按鈕：直接讀 dataset.word，不依賴 queue
  if (action === "speak") {
    speakWord(e.target.dataset.word);
    return;
  }

  const { word, mode } = queue[queueIdx];

  if (action === "save-unknown") {
    handleSaveUnknown(word);
  } else if (action === "o") {
    showAnswerForm(word, mode);            // O = 我認識 → 測試輸入
  } else if (action === "x") {
    showAnswerDirect(word, mode);          // X = 我不認識 → 直接看正解
  } else if (action === "submit") {
    showAnswerCompare(word, mode);
  } else if (action === "final-o") {
    handleFinalChoice(word, mode, true);
  } else if (action === "final-x") {
    handleFinalChoice(word, mode, false);
  } else if (action === "next") {
    queueIdx++;
    showCurrentCard();
  }
}

// 第一階段：輸入字義/詞性
function showAnswerForm(word, mode) {
  const posCheckboxes = POS_OPTIONS.map(p => `
    <button type="button" class="pos-chip" data-pos="${p}">${p}</button>
  `).join("");

  document.getElementById("card-area").innerHTML = `
    <div class="card" data-stage="form">
      ${renderCardWord(word)}
      <div class="form-row">
        <label>字義</label>
        <input type="text" id="user-meaning" placeholder="輸入中文字義" autofocus>
      </div>
      <div class="form-row">
        <label>詞性（可多選）</label>
        <div class="pos-grid">${posCheckboxes}</div>
      </div>
      <div class="card-actions">
        <button class="btn-primary" data-action="submit">送出比對</button>
      </div>
    </div>
  `;
  document.getElementById("user-meaning").focus();
  // Enter 鍵送出（避開 IME 組字中的 Enter）
  document.getElementById("user-meaning").addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    if (e.isComposing || e.keyCode === 229) return;  // 中文輸入法組字中
    showAnswerCompare(word, mode);
  });
}

// X 路徑：使用者承認不會 → 直接顯示正解，跳過 form
function showAnswerDirect(word, mode) {
  const entry = GEPT_DB[word] || STATE.userAdded[word];
  const correctZ = entry.z;
  const correctP = entry.p || [];
  const level = entry.l || (STATE.userAdded[word] ? "(自加)" : "");
  const note = entry.n || "";

  document.getElementById("card-area").innerHTML = `
    <div class="card" data-stage="direct">
      ${renderCardWord(word)}
      <div class="meta">等級：${level}${note ? "｜" + note : ""}</div>
      <div class="compare-block">
        <div class="compare-row">
          <span class="label">字義：</span>
          <span class="correct-ans">${correctZ}</span>
        </div>
        <div class="compare-row">
          <span class="label">詞性：</span>
          <span class="correct-ans">${correctP.join(", ")}</span>
        </div>
      </div>
      <div class="hint">看完正解，下次再考</div>
      <div class="card-actions">
        <button class="btn-secondary" data-action="next">下一張</button>
      </div>
    </div>
  `;
}

// 第二階段：顯示正解 + 比對（只用於 known 模式，含 userAdded）
function showAnswerCompare(word, mode) {
  const userMeaning = document.getElementById("user-meaning").value.trim();
  const userPos = Array.from(document.querySelectorAll(".pos-chip.selected")).map(b => b.dataset.pos);

  const entry = GEPT_DB[word] || STATE.userAdded[word];
  const correctZ = entry.z;
  const correctP = entry.p || [];
  const level = entry.l || "(自加)";
  const note = entry.n || "";

  document.getElementById("card-area").innerHTML = `
    <div class="card" data-stage="compare">
      ${renderCardWord(word)}
      <div class="meta">等級：${level}${note ? "｜" + note : ""}</div>
      <div class="compare-block">
        <div class="compare-row">
          <span class="label">你的字義：</span>
          <span class="user-ans">${userMeaning || "<em>未填</em>"}</span>
        </div>
        <div class="compare-row">
          <span class="label">正解字義：</span>
          <span class="correct-ans">${correctZ}</span>
        </div>
        <div class="compare-row">
          <span class="label">你的詞性：</span>
          <span class="user-ans">${userPos.length ? userPos.join(", ") : "<em>未選</em>"}</span>
        </div>
        <div class="compare-row">
          <span class="label">正解詞性：</span>
          <span class="correct-ans">${correctP.join(", ")}</span>
        </div>
      </div>
      <div class="hint">你覺得自己懂了嗎？</div>
      <div class="card-actions">
        <button class="btn-x" data-action="final-x">✗ 沒記住</button>
        <button class="btn-o" data-action="final-o">○ 記住了</button>
      </div>
    </div>
  `;
}

// 最終選擇：O = 標記 mastered；X = 不變
function handleFinalChoice(word, mode, mastered) {
  if (mastered) {
    window.VocabStorage.markMastered(word, STATE);
  }
  refreshStats();
  queueIdx++;
  showCurrentCard();
}

// ============== 設定 ==============
function openSettings() {
  const days = STATE.resetDays;
  document.getElementById("rd-初級").value = days["初級"] === null ? "" : days["初級"];
  document.getElementById("rd-中級").value = days["中級"] ?? "";
  document.getElementById("rd-中高級").value = days["中高級"] ?? "";
  document.getElementById("rd-高級").value = days["高級"] ?? "";
  document.getElementById("rd-優級").value = days["優級"] ?? "";

  // 填入語音選單
  const select = document.getElementById("voice-select");
  const en = getEnglishVoices();
  const auto = pickBestVoice();
  const autoLabel = auto ? `自動（${auto.name}）` : "自動";
  let html = `<option value="auto">${autoLabel}</option>`;
  for (const v of en) {
    html += `<option value="${v.name}">${v.name} (${v.lang})</option>`;
  }
  select.innerHTML = html;
  select.value = STATE.voiceName || "auto";

  document.getElementById("settings-modal").style.display = "flex";
}

function closeSettings() {
  document.getElementById("settings-modal").style.display = "none";
}

function resetDb(scope) {
  const heatmapDays = Object.keys(STATE.heatmap || {}).length;
  const labels = {
    mastered: `已背起來紀錄（${Object.keys(STATE.mastered).length} 字）`,
    userAdded: `自加單字（${Object.keys(STATE.userAdded).length} 字）`,
    heatmap: `熱力圖（${heatmapDays} 天的學習事件記錄）`,
    all: "全部資料（已背起來 + 自加單字 + 熱力圖 + 等級設定）",
  };
  const msg = `⚠️ 危險操作\n\n即將清除：${labels[scope]}\n\n此動作無法復原。建議先「匯出」備份。\n\n確定要重設嗎？`;
  if (!confirm(msg)) return;
  if (scope === "mastered") {
    STATE.mastered = {};
  } else if (scope === "userAdded") {
    STATE.userAdded = {};
  } else if (scope === "heatmap") {
    STATE.heatmap = {};
  } else if (scope === "all") {
    STATE = {
      mastered: {},
      userAdded: {},
      heatmap: {},
      resetDays: { ...window.VocabStorage.DEFAULT_RESET_DAYS },
    };
  }
  window.VocabStorage.saveState(STATE);
  refreshStats();
  closeSettings();
  setStatus(`已重設：${labels[scope]}`);
}

function saveSettings() {
  const parse = id => {
    const v = document.getElementById(id).value.trim();
    if (v === "") return null;  // 空白 = 永不重設
    const n = parseInt(v, 10);
    return isNaN(n) ? null : n;
  };
  STATE.resetDays = {
    "初級": parse("rd-初級"),
    "中級": parse("rd-中級"),
    "中高級": parse("rd-中高級"),
    "高級": parse("rd-高級"),
    "優級": parse("rd-優級"),
  };
  STATE.voiceName = document.getElementById("voice-select").value;
  _selectedVoice = getActiveVoice();
  window.VocabStorage.saveState(STATE);
  closeSettings();
  setStatus("設定已儲存");
}

// ============== 匯入匯出 ==============
function onExport() {
  window.VocabStorage.exportToFile(STATE);
  setStatus("已匯出學習紀錄");
}

async function onImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const newState = await window.VocabStorage.importFromFile(file);
    if (!confirm("匯入會覆蓋目前的學習紀錄，確定？")) return;
    STATE = newState;
    window.VocabStorage.saveState(STATE);
    setStatus(`匯入成功：mastered ${Object.keys(STATE.mastered).length} 字｜自加 ${Object.keys(STATE.userAdded).length} 字`);
    refreshStats();
  } catch (err) {
    setStatus("匯入失敗：" + err.message);
  }
  e.target.value = "";  // reset input
}

// ============== 工具 ==============
function setStatus(msg) {
  document.getElementById("status").textContent = msg;
}

function refreshStats() {
  const m = Object.keys(STATE.mastered).length;
  const u = Object.keys(STATE.userAdded).length;
  document.getElementById("count-mastered").textContent = m;
  document.getElementById("count-useradded").textContent = u;
}

// ============== 已背單字清單 ==============
function openMasteredList() {
  const entries = Object.entries(STATE.mastered);
  let html;
  if (entries.length === 0) {
    html = `<div class="empty">尚無已背起來的單字</div>`;
  } else {
    html = entries
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([w]) => {
        const entry = GEPT_DB[w] || STATE.userAdded[w] || {};
        const z = entry.z || "(無資料)";
        const p = (entry.p || []).join(", ") || "—";
        const l = entry.l || (STATE.userAdded[w] ? "自加" : "?");
        return `
          <div class="list-row">
            <div class="list-info">
              <div class="list-line1">
                <span class="list-word">${w}</span>
                <span class="list-tag">${l}</span>
                <span class="list-pos">${p}</span>
              </div>
              <div class="list-z">${z}</div>
            </div>
            <button class="btn-icon-danger" data-action="unmaster" data-word="${w}" title="從已背清單移除">✕</button>
          </div>
        `;
      }).join("");
  }
  document.getElementById("mastered-list-content").innerHTML = html;
  document.getElementById("mastered-modal").style.display = "flex";
}

function closeMasteredList() {
  document.getElementById("mastered-modal").style.display = "none";
}

function unmasterWord(word) {
  if (!confirm(`從「已背起來」清單中移除「${word}」？\n\n該單字會回到複習狀態。`)) return;
  delete STATE.mastered[word];
  window.VocabStorage.saveState(STATE);
  refreshStats();
  openMasteredList();
}

// ============== 自加單字清單 ==============
function openUserAddedList() {
  const entries = Object.entries(STATE.userAdded);
  let html;
  if (entries.length === 0) {
    html = `<div class="empty">尚無自加單字</div>`;
  } else {
    html = entries
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([w, rec]) => {
        const p = (rec.p || []).join(", ") || "—";
        const z = rec.z || "(無字義)";
        return `
          <div class="list-row" data-word="${w}">
            <div class="list-info">
              <div class="list-line1">
                <span class="list-word">${w}</span>
                <span class="list-pos">${p}</span>
              </div>
              <div class="list-z">${z}</div>
            </div>
            <button class="btn-icon-edit" data-action="edit-useradded" data-word="${w}" title="編輯">✎</button>
            <button class="btn-icon-danger" data-action="delete-useradded" data-word="${w}" title="刪除自加單字">✕</button>
          </div>
        `;
      }).join("");
  }
  document.getElementById("useradded-list-content").innerHTML = html;
  document.getElementById("useradded-modal").style.display = "flex";
}

function closeUserAddedList() {
  document.getElementById("useradded-modal").style.display = "none";
}

function editUserAdded(word) {
  const rec = STATE.userAdded[word];
  const row = document.querySelector(`#useradded-list-content .list-row[data-word="${word}"]`);
  if (!row) return;
  const posCheckboxes = POS_OPTIONS.map(p => `
    <button type="button" class="pos-chip ${rec.p.includes(p) ? "selected" : ""}" data-pos="${p}">${p}</button>
  `).join("");
  row.innerHTML = `
    <div class="list-edit">
      <div class="list-word">${word}</div>
      <div class="form-row">
        <label>字義</label>
        <input type="text" class="edit-z" value="${(rec.z || "").replace(/"/g, "&quot;")}">
      </div>
      <div class="form-row">
        <label>詞性</label>
        <div class="pos-grid">${posCheckboxes}</div>
      </div>
      <div class="edit-actions">
        <button class="btn-secondary" data-action="cancel-edit-useradded">取消</button>
        <button class="btn-primary" data-action="save-edit-useradded" data-word="${word}">儲存</button>
      </div>
    </div>
  `;
  row.querySelector(".edit-z").focus();
}

function saveEditUserAdded(word) {
  const row = document.querySelector(`#useradded-list-content .list-row[data-word="${word}"]`);
  const z = row.querySelector(".edit-z").value.trim();
  const pos = Array.from(row.querySelectorAll(".pos-chip.selected")).map(b => b.dataset.pos);
  STATE.userAdded[word] = { z, p: pos };
  window.VocabStorage.saveState(STATE);
  openUserAddedList();
}

function deleteUserAdded(word) {
  if (!confirm(`刪除自加單字「${word}」？\n\n若此字也在「已背起來」清單中，會一併移除。`)) return;
  delete STATE.userAdded[word];
  delete STATE.mastered[word];
  window.VocabStorage.saveState(STATE);
  refreshStats();
  openUserAddedList();
}

window.addEventListener("DOMContentLoaded", init);

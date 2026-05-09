// parser.js — 文字斷詞 + lemma 還原 + 與 GEPT 表比對

// 高頻功能字（不需考的字）
const STOP_WORDS = new Set([
  "i","me","my","myself","we","our","ours","ourselves","you","your","yours",
  "yourself","yourselves","he","him","his","himself","she","her","hers",
  "herself","it","its","itself","they","them","their","theirs","themselves",
  "what","which","who","whom","this","that","these","those","am","is","are",
  "was","were","be","been","being","have","has","had","having","do","does",
  "did","doing","will","would","shall","should","can","could","may","might",
  "must","ought","a","an","the","and","but","if","or","because","as","of",
  "at","by","for","with","to","from","in","on","off","up","down","out","over",
  "under","again","further","then","once","here","there","when","where","why",
  "how","all","any","both","each","few","more","most","other","some","such",
  "no","nor","not","only","own","same","so","than","too","very","just","s","t",
  "re","ve","ll","d","m","let","yes","no","ok","etc",
]);

// 從文字中抓出英文單字（保留連字號和撇號），轉小寫去重
function tokenize(text) {
  const raw = text.match(/[a-zA-Z][a-zA-Z'\-]*[a-zA-Z]|[a-zA-Z]/g) || [];
  const seen = new Set();
  const result = [];
  for (const w of raw) {
    const norm = w.toLowerCase().replace(/^['\-]+|['\-]+$/g, "");
    if (norm.length < 2) continue;
    if (STOP_WORDS.has(norm)) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    result.push(norm);
  }
  return result;
}

// 用 compromise 做詞形還原 + 規則 fallback
// 接受可選的 dbCheck callback：用來確認還原後的詞是否在資料庫，若是才採用
function lemmatize(word, dbCheck) {
  const tryNlp = () => {
    if (typeof nlp === "undefined") return null;
    try {
      const doc = nlp(word);
      const verbInf = doc.verbs().toInfinitive().out("text").trim().toLowerCase();
      if (verbInf && verbInf !== word) return verbInf;
      const nounSing = doc.nouns().toSingular().out("text").trim().toLowerCase();
      if (nounSing && nounSing !== word) return nounSing;
    } catch (e) {}
    return null;
  };

  const candidates = [];
  const nlpRes = tryNlp();
  if (nlpRes) candidates.push(nlpRes);

  // 規則 fallback（無關 compromise）：常見字尾剝除
  if (word.endsWith("ly") && word.length > 4) {
    candidates.push(word.slice(0, -2));            // happily → happi (壞)
    candidates.push(word.slice(0, -2) + "e");       // truly → true
    if (word.endsWith("ily")) candidates.push(word.slice(0, -3) + "y");  // happily → happy
  }
  if (word.endsWith("ed") && word.length > 3) {
    candidates.push(word.slice(0, -2));             // abandoned → abandon
    candidates.push(word.slice(0, -1));             // hoped → hope
    if (word.endsWith("ied")) candidates.push(word.slice(0, -3) + "y");  // tried → try
  }
  if (word.endsWith("ing") && word.length > 5) {
    candidates.push(word.slice(0, -3));             // running → runn (壞)
    candidates.push(word.slice(0, -3) + "e");       // hoping → hope
    candidates.push(word.slice(0, -4));             // running → runn → run (處理 doubled)
  }
  if (word.endsWith("ies") && word.length > 4) {
    candidates.push(word.slice(0, -3) + "y");       // cities → city
  }
  if (word.endsWith("es") && word.length > 3) {
    candidates.push(word.slice(0, -2));             // boxes → box
  }
  if (word.endsWith("s") && word.length > 2) {
    candidates.push(word.slice(0, -1));             // cats → cat
  }
  if (word.endsWith("er") && word.length > 4) {
    candidates.push(word.slice(0, -2));             // teacher → teach
    candidates.push(word.slice(0, -1));             // larger → large
  }
  if (word.endsWith("est") && word.length > 5) {
    candidates.push(word.slice(0, -3));
    candidates.push(word.slice(0, -2));
  }

  // 若有 dbCheck，回傳第一個命中 DB 的候選；否則回傳第一個 nlp 結果或原字
  if (dbCheck) {
    for (const c of candidates) {
      if (c && c !== word && dbCheck(c)) return c;
    }
    return word;
  }
  return nlpRes || word;
}

// 解析文字 → 分成 known（在 DB 內、未背起來）/ mastered（已背起來，跳過）/ unknown（不在 DB）
function parseText(text, geptDb, state) {
  const words = tokenize(text);
  const known = [];          // 待複習：在 DB 但未 mastered
  const masteredSkipped = [];// 已背起來，跳過
  const unknown = [];        // 不在 DB

  const seenLemma = new Set();

  for (const w of words) {
    // 先看原字是否在 DB
    let lookup = w;
    if (!geptDb[lookup]) {
      // 試試 lemma：傳 dbCheck 讓它選命中 DB 的候選
      const lemma = lemmatize(w, (c) => geptDb[c] || state.userAdded[c]);
      if (geptDb[lemma] || state.userAdded[lemma]) lookup = lemma;
    }

    if (seenLemma.has(lookup)) continue;
    seenLemma.add(lookup);

    if (geptDb[lookup]) {
      if (window.VocabStorage.isMastered(lookup, geptDb, state)) {
        masteredSkipped.push(lookup);
      } else {
        known.push(lookup);
      }
    } else if (state.userAdded[lookup]) {
      // 用戶自加的也算 known
      if (window.VocabStorage.isMastered(lookup, geptDb, state)) {
        masteredSkipped.push(lookup);
      } else {
        known.push(lookup);
      }
    } else {
      unknown.push(lookup);
    }
  }

  return { known, masteredSkipped, unknown };
}

// 將 GEPT 原始陣列合併成 { word: {p[], z, l, a, n} } 字典
function buildGeptDb(rawArray) {
  const db = {};
  for (const item of rawArray) {
    const w = item.w.toLowerCase();
    if (!db[w]) {
      db[w] = {
        w,
        p: [...item.p],
        z: item.z,
        l: item.l,
        a: item.a,
        n: item.n,
      };
    } else {
      // 合併同字多詞性
      for (const pos of item.p) {
        if (!db[w].p.includes(pos)) db[w].p.push(pos);
      }
      db[w].z = db[w].z + " / " + item.z;
      if (item.n && !db[w].n) db[w].n = item.n;
    }
  }
  return db;
}

window.VocabParser = { tokenize, lemmatize, parseText, buildGeptDb, STOP_WORDS };

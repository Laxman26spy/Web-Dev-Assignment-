/* =========================================================
   StudyMind AI – script.js
   Sections:
   1.  Config & state
   2.  Helpers (DOM, toast, storage)
   3.  Theme (dark / light, remembered)
   4.  Settings (provider, model, API key)
   5.  Notes input (character counter)
   6.  Prompt building
   7.  API calls (fetch, POST, headers, body)
   8.  Parsing & validating the AI reply
   9.  Rendering: summary, quiz, flashcards
   10. Summary tools: copy, download, speak
   11. History (localStorage)
   12. Quiz progress tracking
   13. Generate flow (ties everything together)
   14. Init
   ========================================================= */
"use strict";

/* ---------- 1. Config & state ---------- */

const MAX_CHARS = 6000;          // notes longer than this are trimmed
const REQUEST_TIMEOUT_MS = 60000;

const STORAGE = {
  theme: "sm-theme",
  settings: "sm-settings",       // { provider, models: {gemini, groq}, keys: {gemini, groq} }
  history: "sm-history",
  scores: "sm-quiz-scores",
};

// Everything provider-specific lives here, so adding another provider is easy.
const PROVIDERS = {
  gemini: {
    label: "Google Gemini",
    defaultModel: "gemini-2.5-flash",
    keyUrl: "https://aistudio.google.com/app/apikey",
    // Builds the full fetch() request (URL, method, headers, body)
    buildRequest: ({ model, key, prompt }) => ({
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      options: {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.7 },
        }),
      },
    }),
    // Pulls the AI's text out of the provider's JSON envelope
    extractText: (data) => data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "",
  },
  groq: {
    label: "Groq",
    defaultModel: "llama-3.3-70b-versatile",
    keyUrl: "https://console.groq.com/keys",
    buildRequest: ({ model, key, prompt }) => ({
      url: "https://api.groq.com/openai/v1/chat/completions",
      options: {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "You are a study assistant. Reply with valid JSON only." },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.7,
        }),
      },
    }),
    extractText: (data) => data?.choices?.[0]?.message?.content ?? "",
  },
};

// App state (single source of truth for what is on screen)
const state = {
  current: null,        // { id, title, notes, style, difficulty, createdAt, summary, keyPoints, quiz, flashcards }
  quizAnswers: [],      // index of chosen option per question, or null
  cardKnown: [],        // true / false / null per flashcard
  isLoading: false,
  speaking: false,
};

/* ---------- 2. Helpers ---------- */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/** Create an element with optional class and text – safer than innerHTML (no XSS). */
function el(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

let toastTimer;
function toast(message) {
  const t = $("#toast");
  t.textContent = message;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback; // corrupted or blocked storage – never crash
  }
}
function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    toast("⚠️ Could not save to browser storage");
    return false;
  }
}

function showError(message) {
  const box = $("#errorBox");
  box.textContent = "⚠️ " + message;
  box.hidden = false;
  // restart the shake animation
  box.style.animation = "none"; void box.offsetWidth; box.style.animation = "";
}
function clearError() { $("#errorBox").hidden = true; }

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const formatDate = (ts) =>
  new Date(ts).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/* ---------- 3. Theme ---------- */

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  $(".theme-icon").textContent = theme === "dark" ? "☀️" : "🌙";
  try { localStorage.setItem(STORAGE.theme, theme); } catch { /* ignore */ }
}
function toggleTheme() {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(next);
}

/* ---------- 4. Settings ---------- */

function getSettings() {
  const saved = loadJSON(STORAGE.settings, {});
  return {
    provider: saved.provider && PROVIDERS[saved.provider] ? saved.provider : "gemini",
    models: { gemini: PROVIDERS.gemini.defaultModel, groq: PROVIDERS.groq.defaultModel, ...(saved.models || {}) },
    keys: { gemini: "", groq: "", ...(saved.keys || {}) },
  };
}

/** Fill the settings form for whichever provider is selected. */
function refreshSettingsForm(settings = getSettings(), provider = settings.provider) {
  $("#provider").value = provider;
  $("#model").value = settings.models[provider];
  $("#apiKey").value = settings.keys[provider];
  $("#keyLink").href = PROVIDERS[provider].keyUrl;
}

function saveSettings() {
  const settings = getSettings();
  const provider = $("#provider").value;
  settings.provider = provider;
  settings.models[provider] = $("#model").value.trim() || PROVIDERS[provider].defaultModel;
  settings.keys[provider] = $("#apiKey").value.trim();
  saveJSON(STORAGE.settings, settings);
  toast("✅ Settings saved");
  clearError();
}

function removeKey() {
  const settings = getSettings();
  const provider = $("#provider").value;
  settings.keys[provider] = "";
  saveJSON(STORAGE.settings, settings);
  $("#apiKey").value = "";
  toast("🗝️ Key removed");
}

/* ---------- 5. Notes input ---------- */

function updateCounter() {
  const len = $("#notes").value.length;
  $("#charCount").textContent = `${len.toLocaleString()} / ${MAX_CHARS.toLocaleString()}`;
  $("#limitWarn").hidden = len <= MAX_CHARS;
}

/* ---------- 6. Prompt building ---------- */

const STYLE_GUIDE = {
  exam: "Exam-focused: concise, highlight definitions, formulas, dates and likely exam questions.",
  eli10: "Explain like I am 10 years old: simple words, short sentences, friendly analogies.",
  detailed: "Detailed: thorough, well-structured, cover nuances and examples.",
};

function buildPrompt(notes, style, difficulty) {
  return `You are an expert tutor. Read the student's notes (or topic) below and create study material.

Style of answer: ${STYLE_GUIDE[style]}
Quiz difficulty: ${difficulty}

Reply with ONLY valid JSON (no markdown, no code fences, no extra text) in exactly this shape:
{
  "title": "short title, max 6 words",
  "summary": "a clear summary of 3-6 sentences",
  "keyPoints": ["3 to 6 short key points"],
  "quiz": [
    {
      "question": "question text",
      "options": ["option A", "option B", "option C", "option D"],
      "answerIndex": 0,
      "explanation": "one sentence on why this answer is correct"
    }
  ],
  "flashcards": [
    { "front": "question or term", "back": "answer or definition" }
  ]
}

Rules:
- "quiz" must contain EXACTLY 5 questions, each with EXACTLY 4 options.
- "answerIndex" is the zero-based index (0-3) of the correct option.
- "flashcards" must contain 6 to 8 cards.
- Base everything on the student's notes. If the input is only a topic, use accurate general knowledge.

STUDENT NOTES:
"""
${notes}
"""`;
}

/* ---------- 7. API calls ---------- */

/** Custom error so the UI can show a precise, friendly message per failure type. */
class AppError extends Error {
  constructor(message) { super(message); this.name = "AppError"; }
}

function httpErrorMessage(status, providerName) {
  switch (status) {
    case 400: return `The ${providerName} API rejected the request (400). Check the model name in Settings.`;
    case 401:
    case 403: return `Your ${providerName} API key was rejected (${status}). Check that it is correct and active.`;
    case 404: return `Model or endpoint not found (404). Check the model name in Settings.`;
    case 429: return `Rate limit reached (429). You are sending requests too fast or hit the free quota – wait a minute and try again.`;
    default:
      if (status >= 500) return `${providerName} is having problems right now (${status}). Please try again shortly.`;
      return `Unexpected response from ${providerName} (HTTP ${status}).`;
  }
}

/** Sends the prompt to the chosen provider and returns the AI's raw text reply. */
async function callAI(prompt, settings) {
  const provider = PROVIDERS[settings.provider];
  const { url, options } = provider.buildRequest({
    model: settings.models[settings.provider],
    key: settings.keys[settings.provider],
    prompt,
  });

  // Abort the request if it takes too long
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") throw new AppError("The request timed out. Please try again.");
    // fetch() only rejects on network failure (offline, DNS, CORS...)
    throw new AppError("Network error – check your internet connection and try again.");
  } finally {
    clearTimeout(timer);
  }

  // fetch() does NOT throw on 4xx / 5xx, so we must check response.ok ourselves
  if (!response.ok) {
    throw new AppError(httpErrorMessage(response.status, provider.label));
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new AppError("The server sent a reply that is not valid JSON.");
  }

  const text = provider.extractText(data);
  if (!text.trim()) {
    throw new AppError("The AI returned an empty reply (it may have been blocked). Try rewording your notes.");
  }
  return text;
}

/* ---------- 8. Parsing & validating the reply ---------- */

/** Removes ```json fences and any chatter around the JSON object. */
function extractJSON(text) {
  let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first !== -1 && last > first) t = t.slice(first, last + 1);
  return t;
}

const isText = (v) => typeof v === "string" && v.trim().length > 0;

/** Parses + checks the AI reply. Returns clean data or throws AppError. */
function parseAIResponse(rawText) {
  let data;
  try {
    data = JSON.parse(extractJSON(rawText));
  } catch {
    throw new AppError("The AI replied in the wrong format (not valid JSON). Please press Generate again.");
  }

  if (!isText(data.summary)) throw new AppError("The AI reply is missing the summary. Please try again.");

  if (!Array.isArray(data.quiz) || data.quiz.length === 0) {
    throw new AppError("The AI reply is missing quiz questions. Please try again.");
  }
  const quiz = data.quiz.map((q, i) => {
    const valid =
      q && isText(q.question) && Array.isArray(q.options) && q.options.length >= 2 &&
      q.options.every(isText) && Number.isInteger(q.answerIndex) &&
      q.answerIndex >= 0 && q.answerIndex < q.options.length;
    if (!valid) throw new AppError(`Quiz question ${i + 1} from the AI is malformed. Please try again.`);
    return {
      question: q.question.trim(),
      options: q.options.map((o) => o.trim()),
      answerIndex: q.answerIndex,
      explanation: isText(q.explanation) ? q.explanation.trim() : "",
    };
  });

  if (!Array.isArray(data.flashcards) || data.flashcards.length === 0) {
    throw new AppError("The AI reply is missing flashcards. Please try again.");
  }
  const flashcards = data.flashcards.map((c, i) => {
    if (!c || !isText(c.front) || !isText(c.back)) {
      throw new AppError(`Flashcard ${i + 1} from the AI is malformed. Please try again.`);
    }
    return { front: c.front.trim(), back: c.back.trim() };
  });

  return {
    title: isText(data.title) ? data.title.trim() : "Study set",
    summary: data.summary.trim(),
    keyPoints: Array.isArray(data.keyPoints) ? data.keyPoints.filter(isText).map((s) => s.trim()) : [],
    quiz,
    flashcards,
  };
}

/* ---------- 9. Rendering ---------- */

function switchTab(name) {
  $$(".tab").forEach((t) => {
    const active = t.dataset.tab === name;
    t.classList.toggle("active", active);
    t.setAttribute("aria-selected", String(active));
  });
  const hasData = !!state.current;
  $("#emptyState").hidden = hasData;
  $("#panel-summary").hidden = !(hasData && name === "summary");
  $("#panel-quiz").hidden = !(hasData && name === "quiz");
  $("#panel-cards").hidden = !(hasData && name === "cards");
}
const activeTab = () => $(".tab.active").dataset.tab;

/** Shows a full study set on screen and resets quiz / card progress. */
function renderAll(set) {
  state.current = set;
  state.quizAnswers = set.quiz.map(() => null);
  state.cardKnown = set.flashcards.map(() => null);
  stopSpeaking();
  renderSummary();
  renderQuiz();
  renderFlashcards();
  $("#regenBtn").disabled = false;
  switchTab(activeTab());
}

function renderSummary() {
  const set = state.current;
  $("#resultTitle").textContent = set.title;
  $("#summaryText").textContent = set.summary;

  // key points as a list (built with DOM methods, not innerHTML)
  const old = $("#panel-summary .key-points");
  if (old) old.remove();
  if (set.keyPoints.length) {
    const ul = el("ul", "key-points");
    set.keyPoints.forEach((p) => ul.appendChild(el("li", "", p)));
    $("#panel-summary").appendChild(ul);
  }
}

function renderQuiz() {
  const list = $("#quizList");
  list.replaceChildren();
  $("#quizResult").hidden = true;

  state.current.quiz.forEach((q, qi) => {
    const card = el("article", "q-card");
    const title = el("p", "q-text");
    title.append(el("span", "q-num", `Q${qi + 1}.`), document.createTextNode(q.question));
    card.appendChild(title);

    const opts = el("div", "options");
    q.options.forEach((opt, oi) => {
      const btn = el("button", "option");
      btn.type = "button";
      btn.dataset.q = qi;
      btn.dataset.o = oi;
      btn.append(el("span", "letter", String.fromCharCode(65 + oi)), el("span", "", opt));
      opts.appendChild(btn);
    });
    card.appendChild(opts);
    list.appendChild(card);
  });
  updateQuizMeta();
}

/** One listener for all options (event delegation) */
function handleOptionClick(e) {
  const btn = e.target.closest(".option");
  if (!btn || !state.current) return;
  const qi = Number(btn.dataset.q);
  const oi = Number(btn.dataset.o);
  if (state.quizAnswers[qi] !== null) return; // already answered – can't score twice

  state.quizAnswers[qi] = oi;
  const q = state.current.quiz[qi];
  const card = btn.closest(".q-card");

  // lock every option and show right / wrong colours
  card.querySelectorAll(".option").forEach((b, i) => {
    b.disabled = true;
    if (i === q.answerIndex) b.classList.add("correct");
    else if (i === oi) b.classList.add("wrong");
  });

  const correct = oi === q.answerIndex;
  const note = el("div", "explain");
  note.textContent = (correct ? "✅ Correct! " : `❌ Not quite. Correct answer: ${String.fromCharCode(65 + q.answerIndex)}. `) + q.explanation;
  card.appendChild(note);

  updateQuizMeta();
  if (state.quizAnswers.every((a) => a !== null)) finishQuiz();
}

const quizScore = () => state.quizAnswers.filter((a, i) => a === state.current.quiz[i].answerIndex).length;

function updateQuizMeta() {
  const total = state.current.quiz.length;
  const answered = state.quizAnswers.filter((a) => a !== null).length;
  $("#quizProgressText").textContent = `${answered} / ${total} answered`;
  $("#quizScoreText").textContent = `Score ${quizScore()}`;
  $("#quizBar").style.width = `${(answered / total) * 100}%`;
}

function finishQuiz() {
  const total = state.current.quiz.length;
  const score = quizScore();
  const pct = Math.round((score / total) * 100);
  const message =
    pct === 100 ? "🏆 Perfect score!" :
    pct >= 80 ? "🎉 Great job!" :
    pct >= 50 ? "👍 Good effort – review the wrong ones." :
    "📖 Keep studying – you'll get there!";

  const box = $("#quizResult");
  box.replaceChildren(
    el("div", "big-score", `${score} / ${total}`),
    el("p", "", `${pct}% · ${message}`),
  );
  const again = el("button", "btn ghost", "🔁 Retake quiz");
  again.type = "button";
  again.addEventListener("click", () => {
    state.quizAnswers = state.current.quiz.map(() => null);
    renderQuiz();
  });
  box.appendChild(again);
  box.hidden = false;
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });

  recordScore(score, total);
}

function renderFlashcards() {
  const grid = $("#cardGrid");
  grid.replaceChildren();

  state.current.flashcards.forEach((c, i) => {
    const wrap = el("div", "fc");
    wrap.dataset.i = i;

    const flip = el("button", "fc-flip");
    flip.type = "button";
    flip.setAttribute("aria-label", `Flashcard ${i + 1}. Click to flip.`);
    const front = el("div", "fc-face fc-front");
    front.append(el("span", "fc-tag", "Question"), document.createTextNode(c.front));
    const back = el("div", "fc-face fc-back");
    back.append(el("span", "fc-tag", "Answer"), document.createTextNode(c.back));
    flip.append(front, back);

    const actions = el("div", "fc-actions");
    const knownBtn = el("button", "btn ghost sm", "✅ Known");
    const unknownBtn = el("button", "btn ghost sm", "❌ Not yet");
    knownBtn.type = unknownBtn.type = "button";
    knownBtn.dataset.mark = "known";
    unknownBtn.dataset.mark = "unknown";
    actions.append(knownBtn, unknownBtn);

    wrap.append(flip, actions);
    grid.appendChild(wrap);
  });
  updateKnownCount();
}

/** One listener for flip + known/unknown buttons (event delegation) */
function handleCardClick(e) {
  const wrap = e.target.closest(".fc");
  if (!wrap) return;
  const i = Number(wrap.dataset.i);

  const mark = e.target.closest("[data-mark]");
  if (mark) {
    const value = mark.dataset.mark === "known";
    state.cardKnown[i] = state.cardKnown[i] === value ? null : value; // click again to undo
    wrap.classList.toggle("known", state.cardKnown[i] === true);
    wrap.querySelector('[data-mark="known"]').classList.toggle("is-on", state.cardKnown[i] === true);
    wrap.querySelector('[data-mark="unknown"]').classList.toggle("is-off", state.cardKnown[i] === false);
    updateKnownCount();
    return;
  }
  if (e.target.closest(".fc-flip")) wrap.classList.toggle("flipped");
}

function updateKnownCount() {
  const known = state.cardKnown.filter((k) => k === true).length;
  $("#knownCount").textContent = `${known} / ${state.cardKnown.length} known`;
}

/* ---------- 10. Summary tools ---------- */

const summaryAsText = () => {
  const s = state.current;
  const points = s.keyPoints.length ? "\n\nKey points:\n" + s.keyPoints.map((p) => `- ${p}`).join("\n") : "";
  return `${s.title}\n\n${s.summary}${points}\n`;
};

async function copySummary() {
  if (!state.current) return;
  try {
    await navigator.clipboard.writeText(summaryAsText());
    toast("📋 Copied to clipboard");
  } catch {
    // Fallback for browsers / contexts without the Clipboard API
    const ta = el("textarea");
    ta.value = summaryAsText();
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    toast(ok ? "📋 Copied to clipboard" : "⚠️ Copy failed");
  }
}

function downloadSummary() {
  if (!state.current) return;
  const blob = new Blob([summaryAsText()], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = el("a");
  a.href = url;
  a.download = state.current.title.replace(/[^\w]+/g, "-").toLowerCase() + "-summary.txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast("⬇️ Download started");
}

function stopSpeaking() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  state.speaking = false;
  const b = $("#speakBtn");
  if (b) b.textContent = "🔊 Read aloud";
}

function toggleSpeak() {
  if (!("speechSynthesis" in window)) return toast("⚠️ Speech is not supported in this browser");
  if (!state.current) return;
  if (state.speaking) return stopSpeaking();

  const utter = new SpeechSynthesisUtterance(`${state.current.title}. ${state.current.summary}`);
  utter.onend = utter.onerror = stopSpeaking;
  state.speaking = true;
  $("#speakBtn").textContent = "⏹ Stop";
  window.speechSynthesis.speak(utter);
}

/* ---------- 11. History ---------- */

const getHistory = () => loadJSON(STORAGE.history, []);

function addToHistory(set) {
  // keep newest first, cap at 30 items so localStorage never fills up
  const history = [set, ...getHistory()].slice(0, 30);
  saveJSON(STORAGE.history, history);
  renderHistory();
}

function renderHistory() {
  const query = $("#historySearch").value.trim().toLowerCase();
  const items = getHistory().filter((h) =>
    !query || h.title.toLowerCase().includes(query) || h.notes.toLowerCase().includes(query));

  const list = $("#historyList");
  list.replaceChildren();
  $("#historyEmpty").hidden = items.length > 0;
  $("#historyEmpty").textContent = getHistory().length ? "No matches." : "No history yet.";

  items.forEach((h) => {
    const li = el("li", "history-item");
    const open = el("button", "h-open");
    open.type = "button";
    open.dataset.id = h.id;
    open.append(el("span", "h-title", h.title), el("span", "h-date", formatDate(h.createdAt)));
    const del = el("button", "h-del", "🗑");
    del.type = "button";
    del.dataset.del = h.id;
    del.setAttribute("aria-label", `Delete ${h.title}`);
    li.append(open, del);
    list.appendChild(li);
  });
}

function handleHistoryClick(e) {
  const delBtn = e.target.closest("[data-del]");
  if (delBtn) {
    saveJSON(STORAGE.history, getHistory().filter((h) => h.id !== Number(delBtn.dataset.del)));
    renderHistory();
    return;
  }
  const openBtn = e.target.closest(".h-open");
  if (openBtn) {
    const item = getHistory().find((h) => h.id === Number(openBtn.dataset.id));
    if (!item) return;
    $("#notes").value = item.notes;
    $("#style").value = item.style;
    $("#difficulty").value = item.difficulty;
    updateCounter();
    renderAll(item);
    switchTab("summary");
    $(".results").scrollIntoView({ behavior: "smooth", block: "start" });
    toast("📂 Loaded from history");
  }
}

function clearHistory() {
  if (!getHistory().length) return;
  if (confirm("Delete ALL history? This cannot be undone.")) {
    saveJSON(STORAGE.history, []);
    renderHistory();
    toast("🗑 History cleared");
  }
}

/* ---------- 12. Quiz progress tracking ---------- */

function recordScore(score, total) {
  const scores = loadJSON(STORAGE.scores, []);
  scores.push({ score, total, at: Date.now() });
  saveJSON(STORAGE.scores, scores.slice(-20));
  renderProgress();
}

function renderProgress() {
  const scores = loadJSON(STORAGE.scores, []);
  const pcts = scores.map((s) => Math.round((s.score / s.total) * 100));
  $("#statAttempts").textContent = scores.length;
  $("#statAvg").textContent = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) + "%" : "–";
  $("#statBest").textContent = pcts.length ? Math.max(...pcts) + "%" : "–";

  const bars = $("#scoreBars");
  bars.replaceChildren();
  pcts.slice(-10).forEach((p) => {
    const bar = el("div", "bar");
    bar.style.height = `${Math.max(p, 4)}%`;
    bar.title = `${p}%`;
    bars.appendChild(bar);
  });
}

/* ---------- 13. Generate flow ---------- */

function setLoading(on) {
  state.isLoading = on;
  const btn = $("#generateBtn");
  btn.disabled = on;                       // prevents double-clicking while a request runs
  btn.classList.toggle("loading", on);
  $("#regenBtn").disabled = on || !state.current;
  $("#loader").hidden = !on;
  btn.querySelector(".btn-label").textContent = on ? "Generating…" : "✨ Generate Study Material";
}

/**
 * @param {boolean} isRegenerate  true when pressing the Regenerate button
 */
async function generate(isRegenerate = false) {
  if (state.isLoading) return;
  clearError();

  // --- validate input before spending an API call ---
  const settings = getSettings();
  if (!settings.keys[settings.provider]) {
    $("#settingsPanel").hidden = false;
    $("#settingsToggle").setAttribute("aria-expanded", "true");
    refreshSettingsForm(settings);
    $("#apiKey").focus();
    return showError(`No API key found. Paste your ${PROVIDERS[settings.provider].label} key in Settings first.`);
  }

  let notes = $("#notes").value.trim();
  if (!notes) return showError("Your notes are empty. Paste some notes or type a topic first.");
  if (notes.length < 3) return showError("Please enter a little more text for the AI to work with.");
  if (notes.length > MAX_CHARS) notes = notes.slice(0, MAX_CHARS);

  const style = $("#style").value;
  const difficulty = $("#difficulty").value;

  // On regenerate, ask the AI for a different take
  let prompt = buildPrompt(notes, style, difficulty);
  if (isRegenerate) prompt += "\n\nIMPORTANT: Produce a DIFFERENT set of quiz questions and flashcards than before, with fresh wording.";

  setLoading(true);
  try {
    const raw = await callAI(prompt, settings);
    const parsed = parseAIResponse(raw);
    // shuffle answer positions so the correct option isn't always the same letter
    parsed.quiz = parsed.quiz.map((q) => {
      const order = shuffle(q.options.map((_, i) => i));
      return { ...q, options: order.map((i) => q.options[i]), answerIndex: order.indexOf(q.answerIndex) };
    });

    const set = { id: Date.now(), createdAt: Date.now(), notes, style, difficulty, ...parsed };
    renderAll(set);
    addToHistory(set);
    switchTab("summary");
    toast("✨ Study material ready!");
  } catch (err) {
    // AppError messages are already friendly; anything else is a surprise bug
    showError(err instanceof AppError ? err.message : "Something unexpected went wrong. Please try again.");
    if (!(err instanceof AppError)) console.error(err);
  } finally {
    setLoading(false);
  }
}

/* ---------- 14. Init ---------- */

function init() {
  // theme icon matches whatever the <head> script applied
  applyTheme(document.documentElement.getAttribute("data-theme") || "light");

  refreshSettingsForm();
  updateCounter();
  renderHistory();
  renderProgress();
  switchTab("summary");

  // Theme + settings
  $("#themeToggle").addEventListener("click", toggleTheme);
  $("#settingsToggle").addEventListener("click", () => {
    const panel = $("#settingsPanel");
    panel.hidden = !panel.hidden;
    $("#settingsToggle").setAttribute("aria-expanded", String(!panel.hidden));
  });
  $("#provider").addEventListener("change", () => refreshSettingsForm(getSettings(), $("#provider").value));
  $("#saveKey").addEventListener("click", saveSettings);
  $("#removeKey").addEventListener("click", removeKey);
  $("#toggleKey").addEventListener("click", () => {
    const input = $("#apiKey");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    $("#toggleKey").textContent = show ? "Hide" : "Show";
  });

  // Notes + generate
  $("#notes").addEventListener("input", updateCounter);
  $("#generateBtn").addEventListener("click", () => generate(false));
  $("#regenBtn").addEventListener("click", () => generate(true));
  $("#notes").addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") generate(false); // Ctrl/Cmd + Enter shortcut
  });

  // Tabs
  $$(".tab").forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));

  // Delegated listeners for dynamic content
  $("#quizList").addEventListener("click", handleOptionClick);
  $("#cardGrid").addEventListener("click", handleCardClick);
  $("#historyList").addEventListener("click", handleHistoryClick);

  // Summary tools
  $("#copyBtn").addEventListener("click", copySummary);
  $("#downloadBtn").addEventListener("click", downloadSummary);
  $("#speakBtn").addEventListener("click", toggleSpeak);

  // History
  $("#historySearch").addEventListener("input", renderHistory);
  $("#clearHistory").addEventListener("click", clearHistory);

  // Stop speech if the user leaves the page
  window.addEventListener("beforeunload", stopSpeaking);
}

document.addEventListener("DOMContentLoaded", init);
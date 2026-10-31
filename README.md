# 🧠 StudyMind AI – AI Study Assistant

Paste your class notes (or just type a topic) and StudyMind AI turns them into:

- 📄 a **summary** with key points
- ❓ a **5-question quiz** with instant right / wrong feedback and a final score
- 🃏 **flashcards** you can flip and mark as known

It runs entirely in your browser (plain HTML, CSS and JavaScript – no build step, no backend).

![Screenshot](screenshot.png)
<!-- TODO: take a screenshot of your running app and save it as screenshot.png -->

## ✨ Features

**Required**
- Notes text area, Generate button, and a Settings section for your own API key
- `POST` request with `fetch()` + `async / await`
- Summary, Quiz and Flashcards in separate tabs
- Loading spinner; the Generate button is disabled while a request runs
- History saved in `localStorage` (click to reopen, delete one, or clear all)
- Copy to clipboard and Download as `.txt` for the summary
- Error handling for: missing API key, empty input, network failure, 401/403 (bad key), 404, 429 (rate limit), 5xx, request timeout, and an invalid / malformed AI reply
- The AI reply is parsed with `JSON.parse()` inside `try / catch` and **validated** (summary, quiz and flashcards must exist and be well-formed)

**Extra**
- 🌙 Dark / Light mode that is remembered
- 🎯 Answer style: Exam-focused, Explain like I'm 10, Detailed
- 🔊 Read the summary aloud (Speech Synthesis)
- 🔄 Flip animation on flashcards + Known / Not yet buttons with a counter
- 📈 Quiz score tracking with average, best score and a small bar chart
- 🔍 Search inside history, and a 🔄 Regenerate button
- 🔢 Character counter with a long-text warning
- 🎚️ Quiz difficulty selector (easy / medium / hard)

## 🔑 How to get a free API key

You can use either provider (both have a free tier):

**Google Gemini**
1. Go to <https://aistudio.google.com/app/apikey>
2. Sign in with a Google account and click **Create API key**
3. Copy the key

**Groq**
1. Go to <https://console.groq.com/keys>
2. Sign up and click **Create API Key**
3. Copy the key

## ▶️ How to use the app

1. Open the app (live link or open `index.html`).
2. Click the ⚙️ **Settings** button, choose a provider, paste **your own** key and press **Save settings**.
3. Paste notes into the text area (or type a topic like *"Photosynthesis"*).
4. Pick an answer style and quiz difficulty, then press **Generate Study Material**.
5. Browse the **Summary**, **Quiz** and **Flashcards** tabs. Past results appear under **History**.

> Shortcut: press **Ctrl / Cmd + Enter** inside the notes box to generate.

## 🔒 API key safety

- The key is **never written in the code** and is **not in this repository**.
- Each visitor pastes their own key. It is stored only in that visitor's browser (`localStorage`) and is sent only to the AI provider.
- Before pushing, run `git log -p | grep -i "AIza\|gsk_"` to double-check that no key appears in your history.

## 📁 Project structure

```
ai-study-assistant/
├── index.html   # page structure
├── style.css    # design, themes, responsive layout, animations
├── script.js    # all logic (prompt, API, parsing, rendering, history)
└── README.md
```

## 🧩 How the fetch request works (for your viva)

```js
fetch(url, {
  method: "POST",                                  // we SEND data to the API
  headers: { "Content-Type": "application/json",   // body is JSON
             "x-goog-api-key": key },              // authentication (Gemini)
  body: JSON.stringify({ contents: [...] })        // the prompt + notes
});
```

1. `buildPrompt()` creates the instruction and asks for **JSON only** in a fixed shape.
2. `callAI()` sends it with `fetch()`; network failures throw, and `response.ok` catches HTTP errors like 401 and 429.
3. `response.json()` converts the reply, then the provider-specific `extractText()` pulls out the AI's text.
4. `parseAIResponse()` runs `JSON.parse()` in `try / catch` and validates every field.
5. `renderAll()` draws the summary, quiz and flashcards with the DOM (`createElement`, `textContent`).

## 🚀 Deploy

**Netlify:** drag-and-drop the folder at <https://app.netlify.com/drop>.
**Vercel:** `npm i -g vercel` then run `vercel` inside the folder (or import the GitHub repo).

## 🛠️ Tech

HTML5 · CSS3 (Grid, Flexbox, custom properties, 3D transforms) · Vanilla JavaScript (ES6+) · Fetch API · localStorage · Web Speech API

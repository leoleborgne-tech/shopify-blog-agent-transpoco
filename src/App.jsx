import { useState, useRef, useEffect } from "react";
import * as XLSX from "xlsx";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cleanHTML(raw) {
  var h = raw.replace(/```html|```/gi, "");
  h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  h = h.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  h = h.replace(/^[-*] (.+)$/gm, "<li>$1</li>");
  h = h.replace(/(<li>[^<]*<\/li>)/g, "<ul>$1</ul>");
  h = h.replace(/\u2014|\u2013/g, "");
  return h.trim();
}

function pJSON(raw) {
  return JSON.parse(raw.replace(/```json|```/g, "").trim());
}

function insertLink(html, anchor, url) {
  if (!anchor || !url) return html;
  var idx = html.toLowerCase().indexOf(anchor.toLowerCase());
  if (idx === -1) return html;
  return html.slice(0, idx) + '<a href="' + url + '" target="_blank" rel="noopener">' + html.slice(idx, idx + anchor.length) + "</a>" + html.slice(idx + anchor.length);
}

function fillPrompt(template, vars) {
  return Object.entries(vars).reduce(function(t, e) { return t.split(e[0]).join(e[1] || ""); }, template);
}

function apiClaude(prompt, maxTokens) {
  return fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: maxTokens || 1000, messages: [{ role: "user", content: prompt }] }),
  }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.error) throw new Error(d.error.message);
    return d.content.find(function(b) { return b.type === "text"; }).text || "";
  });
}

function apiClaudeRetry(prompt, maxTokens) {
  return apiClaude(prompt, maxTokens).catch(function() {
    return sleep(2000).then(function() { return apiClaude(prompt, maxTokens); });
  });
}

function scrapeUrl(url) {
  return fetch("/api/scrape", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: url })
  }).then(function(r) { return r.json(); })
    .then(function(d) {
      var tmp = document.createElement("div");
      tmp.innerHTML = d.contents || "";
      var headings = [];
      tmp.querySelectorAll("h1,h2,h3").forEach(function(el) {
        headings.push({ tag: el.tagName.toLowerCase(), text: (el.innerText || el.textContent || "").trim() });
      });
      return { url: url, headings: headings, text: (tmp.innerText || tmp.textContent || "").replace(/\s+/g, " ").slice(0, 3000) };
    }).catch(function() { return { url: url, headings: [], text: "" }; });
}

function getFallbackImage(keyword) {
  var seed = 0;
  for (var i = 0; i < keyword.length; i++) seed += keyword.charCodeAt(i);
  return "https://picsum.photos/seed/" + (seed % 1000) + "/1200/600";
}

function getImage(keyword, pKey, uKey) {
  var fallback = getFallbackImage(keyword);
  if (uKey) {
    return fetch("https://api.unsplash.com/search/photos?query=" + encodeURIComponent(keyword) + "&per_page=1&orientation=landscape&client_id=" + uKey)
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(d) {
        var url = d && d.results && d.results[0] && d.results[0].urls && d.results[0].urls.regular;
        if (url) return url;
        return pKey ? tryPexels(keyword, pKey, fallback) : fallback;
      }).catch(function() { return pKey ? tryPexels(keyword, pKey, fallback) : fallback; });
  }
  if (pKey) return tryPexels(keyword, pKey, fallback);
  return Promise.resolve(fallback);
}

function tryPexels(keyword, pKey, fallback) {
  return fetch("https://api.pexels.com/v1/search?query=" + encodeURIComponent(keyword) + "&per_page=1&orientation=landscape", { headers: { "Authorization": pKey } })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(d) { return (d && d.photos && d.photos[0] && (d.photos[0].src.large2x || d.photos[0].src.large)) || fallback; })
    .catch(function() { return fallback; });
}

var DP = {
  titleMeta: "Propose 1 optimized meta description and 1 optimized title tag for the article targeting: \"{{keyword}}\"\n\nContext: Website transpocodirect.com (fleet management, GPS tracker). Brand: {{brand}}. Tone: {{tone}}.\n\nCompetitor headings for context:\n{{competitor_headings}}\n\nMETA DESCRIPTION constraints:\n- Keyword \"{{keyword}}\" must appear (preferably at the beginning)\n- Length: 140-160 characters max\n- Clear, click-worthy, representative of the content\n- Avoid vague sentences, keyword stuffing, overly commercial wording\n\nTITLE TAG constraints:\n- Keyword \"{{keyword}}\" must appear (preferably at the beginning)\n- Max 65 characters\n- Capitalize only important words\n- Click-worthy (promise, benefit, question, number)\n- Avoid generic formulations\n\nSTRICT output: valid JSON only, no markdown, no fences:\n{\"title\": \"...\", \"meta_description\": \"...\", \"focus_angle\": \"one sentence on the unique editorial angle\"}",
  structure: "You are an expert SEO content strategist creating an outline for: \"{{keyword}}\"\n\nContext: transpocodirect.com (fleet management, GPS tracker). Title: \"{{title}}\". Angle: \"{{focus_angle}}\". Target: {{word_count}} words.\n\nCompetitor structures:\n{{competitor_summary}}\n\nExpectations:\n- H2 headings directly answer key questions related to search intent\n- Each H2 must have between 2 and 4 H3 subsections (no more, no less)\n- H3 headings expand each H2 with concrete value (tips, mistakes, comparisons)\n- Each heading is written as a promise of a clear answer\n- Cover content gaps competitors miss\n\nFunnel structure:\n- Beginning: direct answer to the query\n- Middle: useful details (advice, benefits, comparisons)\n- End: secondary info (trends, FAQ, inspirations)\n\nSTRICT structural constraints:\n- Exactly 3 H2 sections in the article body (FAQ is separate and not counted)\n- Each H2 must have 2 to 4 H3 subsections\n- Total article must reach ~{{word_count}} words across all 3 sections (~500 words per H2)\n- Include exactly 5 FAQ questions at the end\n\nSTRICT output: valid JSON only, no markdown, no fences:\n{\n  \"sections\": [\n    {\"h2\": \"...\", \"h3s\": [\"...\", \"...\"], \"writing_brief\": \"one sentence on what to cover\"}\n  ],\n  \"faq_questions\": [\"Q1?\", \"Q2?\", \"Q3?\", \"Q4?\", \"Q5?\"]\n}",
  section: "We will now write the article section by section.\n\nContext: Writing for someone tracking a personal car OR a fleet manager. They want simple, reliable, low-cost solutions. Tone: clear, accessible, professional, educational, inspiring.\n\nArticle title: \"{{title}}\"\nKeyword: \"{{keyword}}\"\nTarget length: ~{{section_word_count}} words\n\nWriting rules:\n- Follow the given H2 and H3 headings strictly\n- Content must be practical, concrete, actionable\n- Bullet lists or tables only if they improve clarity\n- Highlight key points in bold\n- No visual separators, no dashes, no em-dashes\n- NO FAQ content\n- NO links of any kind\n\nCRITICAL HTML rules:\n- Output ONLY valid HTML. Zero markdown, zero asterisks, zero # signs\n- H2 MUST use <h2>...</h2>\n- H3 MUST use <h3>...</h3>\n- Paragraphs MUST use <p>...</p>\n- Bold MUST use <strong>...</strong>\n- Lists MUST use <ul><li>...</li></ul>\n- Return ONLY the HTML, no explanation, no code fences\n\nNow write this section:\nH2: {{h2}}\nH3 subsections: {{h3s}}\nBrief: {{writing_brief}}",
  faq: "Write 3 to 4 relevant question/answer pairs for a blog article about \"{{keyword}}\", targeting Google position zero.\n\nQuestions to choose from:\n{{faq_questions}}\n\nRules:\n- Select the 3-4 most relevant questions\n- Each answer: 2-4 sentences, direct, concise\n- Start each answer directly with the response\n- No visual separators, no dashes\n- NO links of any kind\n\nCRITICAL HTML rules:\n- <h2> for \"FAQ - Frequently Asked Questions\"\n- <h3> for each question\n- <p> for each answer\n- Return ONLY the HTML, no markdown, no fences",
  essential: "Write a summary block to place at the very top of the article about \"{{keyword}}\".\n\nArticle title: \"{{title}}\"\nSections covered: {{sections}}\n\nObjective: Reader immediately finds the answer to their need. Make them want to read more. Naturally integrate the keyword.\n\nStructure:\n- A unique catchy title displayed as H2\n- 1-line intro sentence\n- 3-4 key points in bullet form (key info in bold, one short sentence each)\n- Optional brief concluding sentence\n\nConstraints:\n- 150-200 words max\n- Clear, dynamic, accessible\n- No visual separators, no dashes\n- NO links\n\nCRITICAL HTML rules:\n- Wrap in <div class=\"essentiel-block\">\n- Title MUST use <h2>Key Takeaways - [your catchy title]</h2>\n- <p> for intro and conclusion\n- <ul><li> with <strong> for key points\n- Return ONLY the HTML, no markdown, no fences",
  linking: "You are an SEO specialist. Analyze this article and decide where to insert links.\n\nArticle topic: \"{{keyword}}\"\nArticle title: \"{{title}}\"\n\nArticle text:\n{{article_text}}\n\nAvailable internal articles:\n{{internal_articles}}\n\nRules:\n- 1 external link max: pick an anchor phrase for an authoritative external site. Only if genuinely relevant.\n- 1 to 2 internal links: pick anchor phrases matching a similar topic from internal articles list.\n- Anchors must be natural phrases already present in the text.\n- NEVER pick an anchor from the Key Takeaways block.\n- If no internal article is relevant, return empty array.\n- If no external link is relevant, return null.\n\nSTRICT output: valid JSON only, no markdown, no fences:\n{\n  \"external_link\": {\"anchor\": \"exact phrase from article body only\", \"url\": \"https://...\", \"reason\": \"why relevant\"},\n  \"internal_links\": [{\"anchor\": \"exact phrase\", \"url\": \"https://transpocodirect.com/blogs/news/...\", \"reason\": \"why\"}]\n}",
  table: "You are a content strategist. Create ONE concise HTML comparison table for this article.\n\nArticle topic: \"{{keyword}}\"\nArticle title: \"{{title}}\"\nArticle summary: {{article_summary}}\n\nSTRICT table rules:\n- Choose the most relevant type: comparison, pros/cons, features, steps summary\n- MAX 4 columns, MAX 6 rows\n- Each cell must contain SHORT text only: 1 to 6 words max per cell — absolutely no sentences, no paragraphs, no long text\n- Headers: 1 to 3 words max\n- Add a one-line caption before the table\n- NO nested tags inside cells (no <ul>, no <p>, no <strong> blocks) — plain text only in <td>\n\nCRITICAL HTML rules:\n- Return ONLY the HTML, no markdown, no code fences, no explanation\n- Caption: <p><strong>Your caption here</strong></p>\n- Table: <table style=\"width:100%;border-collapse:collapse;margin:24px 0;\">\n- Headers: <thead><tr><th style=\"background:#f0f7ff;padding:10px 12px;text-align:left;border:1px solid #cbd5e1;font-size:13px;\">Header</th></tr></thead>\n- Rows: <tbody><tr><td style=\"padding:9px 12px;border:1px solid #e2e8f0;font-size:13px;\">Short text</td></tr></tbody>\n- Even rows: add background:#f8fafc; to the <tr style=>\n- NOTHING outside the <p> caption and <table> tags"
};

var PM = [
  { key: "titleMeta", label: "1 - Title & Meta",       icon: "✍️", vars: ["{{keyword}}","{{tone}}","{{brand}}","{{competitor_headings}}"] },
  { key: "structure", label: "2 - Structure H2/H3",    icon: "🏗️", vars: ["{{keyword}}","{{title}}","{{focus_angle}}","{{word_count}}","{{competitor_summary}}"] },
  { key: "section",   label: "3 - Section Redaction",  icon: "📝", vars: ["{{title}}","{{keyword}}","{{h2}}","{{h3s}}","{{writing_brief}}","{{section_word_count}}"] },
  { key: "faq",       label: "4 - FAQ",                icon: "❓", vars: ["{{keyword}}","{{faq_questions}}"] },
  { key: "essential", label: "5 - Key Takeaways",      icon: "⭐", vars: ["{{title}}","{{keyword}}","{{sections}}"] },
  { key: "linking",   label: "6 - Linking & Maillage", icon: "🔗", vars: ["{{keyword}}","{{title}}","{{article_text}}","{{internal_articles}}"] },
  { key: "table",     label: "7 - Comparison Table",   icon: "📊", vars: ["{{keyword}}","{{title}}","{{article_summary}}"] }
];

var TABS = [
  { id: "prompts",  label: "✏️ Prompts"  },
  { id: "config",   label: "⚙️ Config"   },
  { id: "keywords", label: "📊 Keywords" },
  { id: "pipeline", label: "🔄 Pipeline" },
  { id: "preview",  label: "📄 Preview"  },
  { id: "links",    label: "🔗 Maillage" },
  { id: "logs",     label: "📜 Logs"     }
];

var STEPS = [
  "📥 Pick keyword", "🔍 Scrape competitors", "✍️ Title + Meta",
  "🏗️ Article structure", "📝 Write sections", "❓ FAQ",
  "⭐ Key Takeaways", "📊 Generate table", "🖼️ Images", "🔗 Links & maillage",
  "🔧 Assemble HTML", "🚀 Send to Make"
];

var SIC = { pending: "⬜", running: "⏳", done: "✅", error: "❌" };
var SCC = { pending: "#475569", running: "#f59e0b", done: "#22c55e", error: "#ef4444" };

export default function App() {
  const [cfg, setCfg] = useState(() => { try { return JSON.parse(localStorage.getItem("sbav3_cfg") || "{}"); } catch(e) { return {}; } });
  const [prompts, setPrompts] = useState(() => { try { return Object.assign({}, DP, JSON.parse(localStorage.getItem("sbav3_prompts") || "{}")); } catch(e) { return Object.assign({}, DP); } });
  const [activePrompt, setActivePrompt] = useState("titleMeta");
  const [tab, setTab] = useState("prompts");
  const [keywords, setKeywords] = useState(() => { try { return JSON.parse(localStorage.getItem("sbav3_keywords") || "[]"); } catch(e) { return []; } });
  const [published, setPublished] = useState(() => { try { return JSON.parse(localStorage.getItem("sbav3_published") || "[]"); } catch(e) { return []; } });
  const [authed, setAuthed] = useState(false);
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState(false);
  const [testMode, setTestMode] = useState(true);
  const [pipeline, setPipeline] = useState([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [logs, setLogs] = useState([]);
  const timerRef = useRef(null);

  const saveCfg = (p) => { const n = Object.assign({}, cfg, p); setCfg(n); try { localStorage.setItem("sbav3_cfg", JSON.stringify(n)); } catch(e) {} };
  const savePrompt = (k, v) => { const n = Object.assign({}, prompts); n[k] = v; setPrompts(n); try { localStorage.setItem("sbav3_prompts", JSON.stringify(n)); } catch(e) {} };
  const resetAll = () => { try { localStorage.removeItem("sbav3_prompts"); } catch(e) {} setPrompts(Object.assign({}, DP)); setActivePrompt("titleMeta"); };
  const addLog = (msg, type) => setLogs((p) => [{ msg, type: type || "info", t: new Date().toLocaleTimeString("en-GB") }, ...p].slice(0, 200));
  const setStep = (i, status, detail) => setPipeline((p) => p.map((s, idx) => idx === i ? Object.assign({}, s, { status, detail: detail || "" }) : s));

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!cfg.autoSchedule) return;
    timerRef.current = setInterval(() => {
      const now = new Date();
      const hhmm = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
      if (hhmm === (cfg.scheduleTime || "10:00")) runPipeline();
    }, 60000);
    if (!authed) {
    return (
      <div style={{ fontFamily: "Inter,sans-serif", minHeight: "100vh", background: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ background: "#1e293b", borderRadius: 16, padding: 40, border: "1px solid #334155", width: 340 }}>
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <span style={{ fontSize: 40 }}>🤖</span>
            <h1 style={{ margin: "12px 0 4px", fontSize: 20, fontWeight: 700, color: "#fff" }}>Shopify Blog Agent</h1>
            <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>Accès restreint — entrez le mot de passe</p>
          </div>
          <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input
              type="password"
              placeholder="Mot de passe"
              value={pwInput}
              onChange={(e) => setPwInput(e.target.value)}
              style={{ width: "100%", background: "#0f172a", border: "1px solid " + (pwError ? "#ef4444" : "#334155"), borderRadius: 8, padding: "10px 14px", color: "#e2e8f0", fontSize: 14, outline: "none", boxSizing: "border-box" }}
            />
            {pwError && <p style={{ margin: 0, fontSize: 12, color: "#ef4444" }}>Mot de passe incorrect</p>}
            <button type="submit" style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)", color: "#fff", border: "none", borderRadius: 8, padding: "10px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
              Se connecter
            </button>
          </form>
        </div>
      </div>
    );
  }

  return () => clearInterval(timerRef.current);
  }, [cfg.autoSchedule, cfg.scheduleTime]);

  const onExcel = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const wb = XLSX.read(ev.target.result, { type: "array" });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      const existing = JSON.parse(localStorage.getItem("sbav3_keywords") || "[]");
      const parsed = rows.slice(1).map((r) => {
        const kw = r[0] || "";
        const prev = existing.find((x) => x.keyword === kw);
        return { keyword: kw, url1: r[1] || "", url2: r[2] || "", url3: r[3] || "", used: prev ? prev.used : false };
      }).filter((r) => r.keyword);
      setKeywords(parsed);
      try { localStorage.setItem("sbav3_keywords", JSON.stringify(parsed)); } catch(e) {}
      addLog("Imported " + parsed.length + " keywords", "success");
    };
    reader.readAsArrayBuffer(file);
  };

  const pickKw = () => keywords.find((k) => !k.used) || keywords[0] || null;
  const markUsed = (kw) => {
    const u = keywords.map((k) => k.keyword === kw ? Object.assign({}, k, { used: true }) : k);
    setKeywords(u); try { localStorage.setItem("sbav3_keywords", JSON.stringify(u)); } catch(e) {}
  };
  const savePub = (title, keyword, handle) => {
    const slug = handle || title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const entry = { title, keyword, url: "https://transpocodirect.com/blogs/news/" + slug, date: new Date().toLocaleDateString("fr-FR") };
    const u = [entry, ...published]; setPublished(u);
    try { localStorage.setItem("sbav3_published", JSON.stringify(u)); } catch(e) {}
  };

  const runPipeline = async () => {
    if (running) return;
    setRunning(true); setResult(null);
    setPipeline(STEPS.map((label) => ({ label, status: "pending", detail: "" })));
    setTab("pipeline");
    if (testMode) addLog("TEST MODE - Shopify publish skipped", "warn");

    try {
      setStep(0, "running");
      const kw = pickKw();
      if (!kw) throw new Error("No keywords loaded.");
      addLog("Keyword: " + kw.keyword, "info");
      setStep(0, "done", kw.keyword); await sleep(300);

      setStep(1, "running");
      const urls = [kw.url1, kw.url2, kw.url3].filter(Boolean);
      let cH = "No competitor data available.";
      let cS = "No competitor data available.";
      if (urls.length > 0) {
        const scraped = await Promise.all(urls.map(scrapeUrl));
        cH = scraped.map((s, i) => "Competitor " + (i+1) + ": " + s.headings.slice(0,8).map((h) => h.text).join(", ")).join("\n");
        cS = scraped.map((s, i) => "Competitor " + (i+1) + ":\nHeadings: " + s.headings.slice(0,8).map((h) => "[" + h.tag + "] " + h.text).join(" | ") + "\nContent: " + s.text.slice(0,500)).join("\n\n");
        addLog("Scraped " + scraped.length + " pages", "success");
      } else {
        addLog("No competitor URLs — skipping scrape", "warn");
      }
      setStep(1, "done", urls.length > 0 ? urls.length + " pages" : "skipped"); await sleep(300);

      setStep(2, "running");
      const tRaw = await apiClaudeRetry(fillPrompt(prompts.titleMeta, { "{{keyword}}": kw.keyword, "{{tone}}": cfg.tone || "professional", "{{brand}}": cfg.brand || "transpocodirect.com", "{{competitor_headings}}": cH }), 600);
      const tData = pJSON(tRaw);
      addLog("Title: " + tData.title, "success");
      setStep(2, "done", tData.title); await sleep(300);

      setStep(3, "running");
      const sRaw = await apiClaudeRetry(fillPrompt(prompts.structure, { "{{keyword}}": kw.keyword, "{{title}}": tData.title, "{{focus_angle}}": tData.focus_angle, "{{word_count}}": cfg.wordCount || "1500", "{{competitor_summary}}": cS }), 2000);
      let struct;
      try { struct = pJSON(sRaw); struct.sections = struct.sections.slice(0, 3); }
      catch(e) { throw new Error("Structure parse failed: " + sRaw.slice(0, 200)); }
      addLog("Structure: " + struct.sections.length + " sections", "success");
      setStep(3, "done", struct.sections.length + " sections"); await sleep(300);

      setStep(4, "running");
      const swc = Math.round((parseInt(cfg.wordCount) || 1500) / 3);
      const secHtmls = [];
      for (let si = 0; si < struct.sections.length; si++) {
        const sec = struct.sections[si];
        const sh = await apiClaudeRetry(fillPrompt(prompts.section, { "{{title}}": tData.title, "{{keyword}}": kw.keyword, "{{h2}}": sec.h2, "{{h3s}}": (sec.h3s || []).join(", "), "{{writing_brief}}": sec.writing_brief, "{{section_word_count}}": swc }), 1000);
        secHtmls.push(cleanHTML(sh));
        addLog("Section " + (si+1) + "/" + struct.sections.length + ": " + sec.h2, "success");
        await sleep(400);
      }
      setStep(4, "done", secHtmls.length + " sections");

      setStep(5, "running");
      const fHtml = cleanHTML(await apiClaudeRetry(fillPrompt(prompts.faq, { "{{keyword}}": kw.keyword, "{{faq_questions}}": struct.faq_questions.map((q, qi) => (qi+1) + ". " + q).join("\n") }), 1000));
      addLog("FAQ generated", "success"); setStep(5, "done"); await sleep(300);

      setStep(6, "running");
      const eHtml = cleanHTML(await apiClaudeRetry(fillPrompt(prompts.essential, { "{{title}}": tData.title, "{{keyword}}": kw.keyword, "{{sections}}": struct.sections.map((s) => s.h2).join(", ") }), 600));
      addLog("Key Takeaways written", "success"); setStep(6, "done"); await sleep(300);

      setStep(7, "running");
      const articleSummary = secHtmls.map((h) => h.replace(/<[^>]+>/g, " ")).join(" ").replace(/\s+/g, " ").slice(0, 1500);
      const tableRaw = await apiClaudeRetry(fillPrompt(prompts.table, { "{{keyword}}": kw.keyword, "{{title}}": tData.title, "{{article_summary}}": articleSummary }), 1000);
      let tableHtml = tableRaw.replace(/```html|```/gi, "").trim();
      // Force close table tag and cut anything after </table>
      const tableEnd = tableHtml.lastIndexOf("</table>");
      if (tableEnd !== -1) tableHtml = tableHtml.slice(0, tableEnd + 8);
      else tableHtml = "";
      addLog("Comparison table generated", "success"); setStep(7, "done"); await sleep(300);

      setStep(8, "running");
      const imgMap = {};
      const pKey = cfg.pexelsKey ? cfg.pexelsKey.trim() : null;
      const uKey = cfg.unsplashKey ? cfg.unsplashKey.trim() : null;
      const featImg = await getImage(kw.keyword, pKey, uKey);
      addLog("Featured image: ready", "success"); await sleep(400);
      for (let ji = 0; ji < Math.min(struct.sections.length, 3); ji++) {
        imgMap[ji] = await getImage(kw.keyword + " " + struct.sections[ji].h2, pKey, uKey);
        addLog("Image " + (ji+1) + ": ready", "success"); await sleep(400);
      }
      setStep(8, "done", "done");

      const css = "<style>.essentiel-block{background:#f0f7ff;border-left:4px solid #2563eb;padding:16px 20px;border-radius:0 8px 8px 0;margin-bottom:28px;} h2{margin-top:72px;margin-bottom:24px;} h3{margin-top:40px;margin-bottom:16px;} p{margin-bottom:14px;} ul{margin-bottom:14px;} table{width:100%;border-collapse:collapse;margin:24px 0;} th{background:#f0f7ff;padding:10px 12px;text-align:left;border:1px solid #cbd5e1;} td{padding:9px 12px;border:1px solid #e2e8f0;}</style>";
      const parts = [css, eHtml];
      secHtmls.forEach((h, pi) => {
        parts.push(h);
        // Insert table after first section for maximum visibility
        if (pi === 0 && tableHtml) parts.push(tableHtml);
        if (imgMap[pi]) parts.push('<img src="' + imgMap[pi] + '" alt="' + struct.sections[pi].h2 + '" style="width:60%;max-width:600px;display:block;margin:16px auto;border-radius:8px;" loading="lazy"/>');
      });
      parts.push(fHtml);
      const preLinkHTML = parts.join("\n\n");
      const stripped = preLinkHTML.replace(/<a\s[^>]*>(.*?)<\/a>/gi, "$1");

      setStep(8, "running");
      const intArts = published.slice(0, 15).map((a) => '- "' + a.keyword + '" | ' + a.title + ' | ' + a.url).join("\n") || "No internal articles yet.";
      const artText = stripped.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 3000);
      let finalHTML = stripped;
      try {
        const lRaw = await apiClaudeRetry(fillPrompt(prompts.linking, { "{{keyword}}": kw.keyword, "{{title}}": tData.title, "{{article_text}}": artText, "{{internal_articles}}": intArts }), 800);
        const lData = pJSON(lRaw);
        if (lData.external_link && lData.external_link.anchor && lData.external_link.url) {
          if (eHtml.toLowerCase().indexOf(lData.external_link.anchor.toLowerCase()) === -1) {
            finalHTML = insertLink(finalHTML, lData.external_link.anchor, lData.external_link.url);
            addLog("External link inserted", "success");
          } else addLog("External link skipped (Key Takeaways)", "warn");
        }
        if (lData.internal_links && lData.internal_links.length > 0) {
          lData.internal_links.slice(0, 2).forEach((l) => {
            if (eHtml.toLowerCase().indexOf(l.anchor.toLowerCase()) === -1) {
              finalHTML = insertLink(finalHTML, l.anchor, l.url);
              addLog("Internal link: " + l.url, "success");
            } else addLog("Internal link skipped (Key Takeaways)", "warn");
          });
        }
      } catch(le) { addLog("Linking skipped: " + le.message, "warn"); }
      setStep(8, "done");

      setStep(9, "running");
      setResult({ title: tData.title, meta: tData.meta_description, html: finalHTML, featuredImage: featImg });
      addLog("HTML assembled (" + finalHTML.length + " chars)", "success");
      setStep(9, "done"); await sleep(300);

      setStep(10, "running");
      if (testMode) {
        addLog("TEST MODE - see Preview tab", "warn");
        setStep(10, "done", "Test mode"); setTab("preview");
      } else {
        if (!cfg.makeWebhook) throw new Error("Make Webhook URL missing in Config.");
        const makePayload = {
          title: tData.title,
          meta_description: tData.meta_description,
          author: cfg.authorName || "Admin",
          tags: kw.keyword,
          featured_image_url: featImg || "",
          body_html: finalHTML,
          keyword: kw.keyword,
          published: true,
          published_at: new Date().toISOString()
        };
        const makeRes = await fetch(cfg.makeWebhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(makePayload)
        });
        if (!makeRes.ok) throw new Error("Make webhook error: " + makeRes.status);
        markUsed(kw.keyword);
        savePub(tData.title, kw.keyword, tData.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
        addLog("Sent to Make successfully!", "success");
        setStep(10, "done", "Sent to Make");
      }

    } catch(err) {
      addLog(err.message, "error");
      setPipeline((p) => p.map((s) => s.status === "running" ? Object.assign({}, s, { status: "error", detail: err.message }) : s));
    } finally { setRunning(false); }
  };

  const inp = { width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "8px 12px", color: "#e2e8f0", fontSize: 13, outline: "none", boxSizing: "border-box" };
  const lbl = { display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" };
  const aMeta = PM.find((p) => p.key === activePrompt);

  return (
    <div style={{ fontFamily: "Inter,sans-serif", minHeight: "100vh", background: "#0f172a", color: "#e2e8f0" }}>

      <div style={{ background: "linear-gradient(135deg,#1e3a8a,#0f172a)", padding: "18px 24px", borderBottom: "1px solid #1e293b", display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 26 }}>🤖</span>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#fff" }}>Shopify SEO Blog Agent</h1>
          <p style={{ margin: 0, fontSize: 11, color: "#94a3b8" }}>Full pipeline · Excel keywords · Competitor analysis · Make integration</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {cfg.autoSchedule && <span style={{ background: "#16a34a22", color: "#4ade80", border: "1px solid #16a34a44", borderRadius: 20, padding: "2px 10px", fontSize: 11 }}>⏰ {cfg.scheduleTime || "10:00"}</span>}
          <button onClick={() => setTestMode((v) => !v)} style={{ background: testMode ? "#78350f" : "#14532d", color: testMode ? "#fbbf24" : "#4ade80", border: "1px solid " + (testMode ? "#92400e" : "#166534"), borderRadius: 20, padding: "4px 14px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
            {testMode ? "🧪 Test mode" : "🚀 Live mode"}
          </button>
          <button onClick={runPipeline} disabled={running} style={{ background: running ? "#334155" : "linear-gradient(135deg,#3b82f6,#6366f1)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 20px", fontWeight: 700, fontSize: 13, cursor: running ? "not-allowed" : "pointer" }}>
            {running ? "⏳ Running…" : "▶ Run Now"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 3, padding: "14px 24px 0", flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ background: tab === t.id ? "#1d4ed8" : "#1e293b", color: tab === t.id ? "#fff" : "#94a3b8", border: "none", borderRadius: "7px 7px 0 0", padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ margin: "0 24px 24px", background: "#1e293b", borderRadius: "0 8px 8px 8px", padding: 20, border: "1px solid #334155", minHeight: 320 }}>

        {tab === "prompts" && (
          <div style={{ display: "flex", gap: 16 }}>
            <div style={{ width: 210, flexShrink: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Prompts</span>
                <button onClick={resetAll} style={{ background: "#7f1d1d", color: "#fca5a5", border: "none", borderRadius: 6, padding: "3px 8px", fontSize: 10, cursor: "pointer" }}>↺ Reset all</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {PM.map((pm) => (
                  <button key={pm.key} onClick={() => setActivePrompt(pm.key)} style={{ background: activePrompt === pm.key ? "#1d4ed8" : "#0f172a", color: activePrompt === pm.key ? "#fff" : "#94a3b8", border: "1px solid " + (activePrompt === pm.key ? "#3b82f6" : "#334155"), borderRadius: 8, padding: "9px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", textAlign: "left" }}>
                    {pm.icon} {pm.label}
                  </button>
                ))}
              </div>
              <div style={{ marginTop: 14, background: "#0f172a", borderRadius: 8, padding: 12, border: "1px solid #334155" }}>
                <p style={{ margin: "0 0 6px", fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>Variables</p>
                {aMeta && aMeta.vars.map((v) => (
                  <div key={v} style={{ fontFamily: "monospace", fontSize: 11, color: "#f59e0b", background: "#1e293b", borderRadius: 4, padding: "2px 6px", margin: "3px 0" }}>{v}</div>
                ))}
              </div>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{aMeta && aMeta.icon} {aMeta && aMeta.label}</span>
                <button onClick={() => savePrompt(activePrompt, DP[activePrompt])} style={{ background: "#334155", color: "#94a3b8", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 11, cursor: "pointer" }}>↺ Reset this</button>
              </div>
              <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>Use <span style={{ color: "#f59e0b", fontFamily: "monospace" }}>{"{{variables}}"}</span> — replaced automatically at runtime.</p>
              <textarea value={prompts[activePrompt] || ""} onChange={(e) => savePrompt(activePrompt, e.target.value)} style={Object.assign({}, inp, { minHeight: 360, fontFamily: "monospace", fontSize: 12, lineHeight: 1.6, resize: "vertical" })} />
            </div>
          </div>
        )}

        {tab === "config" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {[
              { label: "Make Webhook URL", key: "makeWebhook", placeholder: "https://hook.eu1.make.com/xxxxx" },
              { label: "Author Name", key: "authorName", placeholder: "Admin" },
              { label: "Pexels API Key", key: "pexelsKey", placeholder: "Free at pexels.com/api", type: "password" },
              { label: "Unsplash API Key", key: "unsplashKey", placeholder: "Free at unsplash.com/developers", type: "password" },
              { label: "Brand / Context", key: "brand", placeholder: "transpocodirect.com" },
            ].map((f) => (
              <div key={f.key}>
                <span style={lbl}>{f.label}</span>
                <input style={inp} type={f.type || "text"} placeholder={f.placeholder} value={cfg[f.key] || ""} onChange={(e) => saveCfg({ [f.key]: e.target.value })} />
              </div>
            ))}
            <div>
              <span style={lbl}>Tone</span>
              <select style={inp} value={cfg.tone || "professional"} onChange={(e) => saveCfg({ tone: e.target.value })}>
                {["professional","friendly","informative","persuasive","expert"].map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <span style={lbl}>Target Word Count</span>
              <select style={inp} value={cfg.wordCount || "1500"} onChange={(e) => saveCfg({ wordCount: e.target.value })}>
                {["800","1000","1200","1500","1800","2000"].map((n) => <option key={n}>{n}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: "1/-1", background: "#0f172a", borderRadius: 10, padding: 14, border: "1px solid #334155" }}>
              <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 600, color: "#94a3b8" }}>⏰ Daily Scheduler</p>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!cfg.autoSchedule} onChange={(e) => saveCfg({ autoSchedule: e.target.checked })} />
                  Auto-publish daily at
                </label>
                <input type="time" style={Object.assign({}, inp, { width: 110 })} value={cfg.scheduleTime || "10:00"} onChange={(e) => saveCfg({ scheduleTime: e.target.value })} />
              </div>
              <p style={{ margin: "8px 0 0", fontSize: 11, color: "#475569" }}>⚠️ Keep this tab open for the scheduler to trigger.</p>
            </div>
          </div>
        )}

        {tab === "keywords" && (
          <div>
            <div style={{ background: "#0f172a", borderRadius: 10, padding: 16, marginBottom: 16, border: "1px solid #334155" }}>
              <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 600 }}>📎 Import Excel file</p>
              <p style={{ margin: "0 0 10px", fontSize: 12, color: "#64748b" }}>Columns: <strong>A: keyword · B: URL 1 · C: URL 2 · D: URL 3</strong></p>
              <input type="file" accept=".xlsx,.xls" onChange={onExcel} style={{ fontSize: 12, color: "#94a3b8", background: "#1e293b", border: "1px solid #334155", borderRadius: 6, padding: "6px 10px", cursor: "pointer" }} />
            </div>
            {keywords.length > 0 ? (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "#0f172a" }}>
                      {["#","Keyword","URL 1","URL 2","URL 3","Status"].map((h) => (
                        <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "#94a3b8", fontWeight: 600, borderBottom: "1px solid #334155" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {keywords.map((k, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #1e293b" }}>
                        <td style={{ padding: "7px 10px", color: "#475569" }}>{i+1}</td>
                        <td style={{ padding: "7px 10px", fontWeight: 600, color: k.used ? "#475569" : "#e2e8f0" }}>{k.keyword}</td>
                        {[k.url1,k.url2,k.url3].map((u, j) => (
                          <td key={j} style={{ padding: "7px 10px", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {u ? <a href={u} target="_blank" rel="noreferrer" style={{ color: "#3b82f6" }}>{u}</a> : <span style={{ color: "#334155" }}>—</span>}
                          </td>
                        ))}
                        <td style={{ padding: "7px 10px" }}>
                          <span style={{ background: k.used ? "#1e293b" : "#16a34a22", color: k.used ? "#475569" : "#4ade80", border: "1px solid " + (k.used ? "#334155" : "#16a34a44"), borderRadius: 20, padding: "2px 8px", fontSize: 10 }}>
                            {k.used ? "✅ Used" : "🔜 Next"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: 40, color: "#475569" }}>
                <p style={{ fontSize: 28 }}>📊</p><p>Import an Excel file to get started.</p>
              </div>
            )}
          </div>
        )}

        {tab === "pipeline" && (
          <div>
            <p style={{ margin: "0 0 14px", fontSize: 13, fontWeight: 600, color: "#94a3b8" }}>Pipeline Status</p>
            {pipeline.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "#475569" }}>
                <p style={{ fontSize: 28 }}>🔄</p><p>Click "Run Now" to start.</p>
              </div>
            ) : pipeline.map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, background: "#0f172a", borderRadius: 8, padding: "10px 14px", marginBottom: 6, border: "1px solid " + (s.status === "done" ? "#16a34a44" : s.status === "error" ? "#dc262644" : "#334155") }}>
                <span>{SIC[s.status]}</span>
                <span style={{ flex: 1, fontSize: 13, color: s.status === "pending" ? "#475569" : "#e2e8f0" }}>{s.label}</span>
                {s.detail && <span style={{ fontSize: 11, color: SCC[s.status], background: "#1e293b", borderRadius: 6, padding: "2px 8px" }}>{s.detail}</span>}
                {s.status === "running" && <span style={{ fontSize: 11, color: "#f59e0b" }}>processing…</span>}
              </div>
            ))}
          </div>
        )}

        {tab === "preview" && (
          result ? (
            <div>
              <div style={{ marginBottom: 16, padding: 14, background: "#0f172a", borderRadius: 8, border: "1px solid #334155" }}>
                <span style={lbl}>Title</span>
                <p style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 700, color: "#fff" }}>{result.title}</p>
                <span style={lbl}>Meta</span>
                <p style={{ margin: "0 0 12px", fontSize: 13, color: "#94a3b8" }}>{result.meta}</p>
                {result.featuredImage && (
                  <div>
                    <span style={lbl}>Featured Image</span>
                    <img src={result.featuredImage} alt={result.title} style={{ width: "100%", borderRadius: 8, marginTop: 6 }} />
                  </div>
                )}
              </div>
              <div style={{ background: "#fff", borderRadius: 8, padding: "24px 28px", color: "#1e293b", lineHeight: 1.8, fontSize: 15 }} dangerouslySetInnerHTML={{ __html: result.html }} />
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: 40, color: "#475569" }}>
              <p style={{ fontSize: 28 }}>📄</p><p>No article yet. Run the pipeline first.</p>
            </div>
          )
        )}

        {tab === "links" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <p style={{ margin: "0 0 2px", fontSize: 14, fontWeight: 700, color: "#fff" }}>🔗 Articles publiés</p>
                <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>Ces URLs sont proposées comme liens internes dans les prochains articles.</p>
              </div>
              <button onClick={() => { if (window.confirm("Vider l'historique ?")) { setPublished([]); try { localStorage.removeItem("sbav3_published"); } catch(e) {} }}} style={{ background: "#7f1d1d", color: "#fca5a5", border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 11, cursor: "pointer" }}>🗑 Vider</button>
            </div>
            {published.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "#475569" }}>
                <p style={{ fontSize: 28 }}>🔗</p><p>Aucun article publié pour l'instant.</p>
              </div>
            ) : published.map((a, i) => (
              <div key={i} style={{ background: "#0f172a", borderRadius: 8, padding: "10px 14px", border: "1px solid #334155", display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: "0 0 2px", fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{a.title}</p>
                  <a href={a.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#3b82f6" }}>{a.url}</a>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: "#f59e0b", background: "#1e293b", borderRadius: 6, padding: "2px 8px", display: "block", marginBottom: 4 }}>{a.keyword}</span>
                  <span style={{ fontSize: 10, color: "#475569" }}>{a.date}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "logs" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Logs ({logs.length})</span>
              <button onClick={() => setLogs([])} style={{ background: "#334155", color: "#94a3b8", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer" }}>Clear</button>
            </div>
            {logs.length === 0 ? <p style={{ color: "#475569", fontSize: 13 }}>No logs yet.</p> :
              logs.map((l, i) => (
                <div key={i} style={{ fontFamily: "monospace", fontSize: 12, display: "flex", gap: 10, marginBottom: 3 }}>
                  <span style={{ color: "#475569", minWidth: 65 }}>{l.t}</span>
                  <span style={{ color: l.type === "success" ? "#4ade80" : l.type === "error" ? "#f87171" : l.type === "warn" ? "#fbbf24" : "#cbd5e1" }}>{l.msg}</span>
                </div>
              ))
            }
          </div>
        )}

      </div>
    </div>
  );
}

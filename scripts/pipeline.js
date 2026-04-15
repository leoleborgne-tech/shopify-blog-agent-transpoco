// scripts/pipeline.js
// Pipeline complet — identique au bouton Run de l'app Vercel

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;
const PEXELS_KEY = process.env.PEXELS_KEY || null;
const UNSPLASH_KEY = process.env.UNSPLASH_KEY || null;

const SHEET_ID = "1D3unbXti5EXGfk8_843jFluCHwDCJa2Hq-j9qGNRt5Y";
const BRAND = "transpocodirect.com";
const TONE = "professional";
const WORD_COUNT = 1500;

// ─── Prompts (identiques à l'app) ────────────────────────────────────────────

const PROMPTS = {
  titleMeta: `Propose 1 optimized meta description and 1 optimized title tag for the article targeting: "{{keyword}}"

Context: Website transpocodirect.com (fleet management, GPS tracker). Brand: {{brand}}. Tone: {{tone}}.

Competitor headings for context:
{{competitor_headings}}

META DESCRIPTION constraints:
- Keyword "{{keyword}}" must appear (preferably at the beginning)
- Length: 140-160 characters max
- Clear, click-worthy, representative of the content
- Avoid vague sentences, keyword stuffing, overly commercial wording

TITLE TAG constraints:
- Keyword "{{keyword}}" must appear (preferably at the beginning)
- Max 65 characters
- Capitalize only important words
- Click-worthy (promise, benefit, question, number)
- Avoid generic formulations

STRICT output: valid JSON only, no markdown, no fences:
{"title": "...", "meta_description": "...", "focus_angle": "one sentence on the unique editorial angle"}`,

  structure: `You are an expert SEO content strategist creating an outline for: "{{keyword}}"

Context: transpocodirect.com (fleet management, GPS tracker). Title: "{{title}}". Angle: "{{focus_angle}}". Target: {{word_count}} words.

Competitor structures:
{{competitor_summary}}

Expectations:
- H2 headings directly answer key questions related to search intent
- Each H2 must have between 2 and 4 H3 subsections (no more, no less)
- H3 headings expand each H2 with concrete value (tips, mistakes, comparisons)
- Each heading is written as a promise of a clear answer
- Cover content gaps competitors miss

Funnel structure:
- Beginning: direct answer to the query
- Middle: useful details (advice, benefits, comparisons)
- End: secondary info (trends, FAQ, inspirations)

STRICT structural constraints:
- Exactly 3 H2 sections in the article body (FAQ is separate and not counted)
- Each H2 must have 2 to 4 H3 subsections
- Total article must reach ~{{word_count}} words across all 3 sections (~500 words per H2)
- Include exactly 5 FAQ questions at the end

STRICT output: valid JSON only, no markdown, no fences:
{
  "sections": [
    {"h2": "...", "h3s": ["...", "..."], "writing_brief": "one sentence on what to cover"}
  ],
  "faq_questions": ["Q1?", "Q2?", "Q3?", "Q4?", "Q5?"]
}`,

  section: `We will now write the article section by section.

Context: Writing for someone tracking a personal car OR a fleet manager. They want simple, reliable, low-cost solutions. Tone: clear, accessible, professional, educational, inspiring.

Article title: "{{title}}"
Keyword: "{{keyword}}"
Target length: ~{{section_word_count}} words

Writing rules:
- Follow the given H2 and H3 headings strictly
- Content must be practical, concrete, actionable
- Bullet lists or tables only if they improve clarity
- Highlight key points in bold
- No visual separators, no dashes, no em-dashes
- NO FAQ content
- NO links of any kind

CRITICAL HTML rules:
- Output ONLY valid HTML. Zero markdown, zero asterisks, zero # signs
- H2 MUST use <h2>...</h2>
- H3 MUST use <h3>...</h3>
- Paragraphs MUST use <p>...</p>
- Bold MUST use <strong>...</strong>
- Lists MUST use <ul><li>...</li></ul>
- Return ONLY the HTML, no explanation, no code fences

Now write this section:
H2: {{h2}}
H3 subsections: {{h3s}}
Brief: {{writing_brief}}`,

  faq: `Write 3 to 4 relevant question/answer pairs for a blog article about "{{keyword}}", targeting Google position zero.

Questions to choose from:
{{faq_questions}}

Rules:
- Select the 3-4 most relevant questions
- Each answer: 2-4 sentences, direct, concise
- Start each answer directly with the response
- No visual separators, no dashes
- NO links of any kind

CRITICAL HTML rules:
- <h2> for "FAQ - Frequently Asked Questions"
- <h3> for each question
- <p> for each answer
- Return ONLY the HTML, no markdown, no fences`,

  essential: `Write a summary block to place at the very top of the article about "{{keyword}}".

Article title: "{{title}}"
Sections covered: {{sections}}

Objective: Reader immediately finds the answer to their need. Make them want to read more. Naturally integrate the keyword.

Structure:
- A unique catchy title displayed as H2
- 1-line intro sentence
- 3-4 key points in bullet form (key info in bold, one short sentence each)
- Optional brief concluding sentence

Constraints:
- 150-200 words max
- Clear, dynamic, accessible
- No visual separators, no dashes
- NO links

CRITICAL HTML rules:
- Wrap in <div class="essentiel-block">
- Title MUST use <h2>Key Takeaways - [your catchy title]</h2>
- <p> for intro and conclusion
- <ul><li> with <strong> for key points
- Return ONLY the HTML, no markdown, no fences`,

  table: `You are a content strategist. Create ONE concise HTML comparison table for this article.

Article topic: "{{keyword}}"
Article title: "{{title}}"
Article summary: {{article_summary}}

STRICT table rules:
- Choose the most relevant type: comparison, pros/cons, features, steps summary
- MAX 4 columns, MAX 6 rows
- Each cell must contain SHORT text only: 1 to 6 words max per cell
- Headers: 1 to 3 words max
- Add a one-line caption before the table
- NO nested tags inside cells

CRITICAL HTML rules:
- Return ONLY the HTML, no markdown, no code fences, no explanation
- Caption: <p><strong>Your caption here</strong></p>
- Table: <table style="width:100%;border-collapse:collapse;margin:24px 0;">
- Headers: <thead><tr><th style="background:#f0f7ff;padding:10px 12px;text-align:left;border:1px solid #cbd5e1;font-size:13px;">Header</th></tr></thead>
- Rows: <tbody><tr><td style="padding:9px 12px;border:1px solid #e2e8f0;font-size:13px;">Short text</td></tr></tbody>
- Even rows: add background:#f8fafc; to the <tr style=>
- NOTHING outside the <p> caption and <table> tags`
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fillPrompt(template, vars) {
  return Object.entries(vars).reduce((t, [k, v]) => t.split(k).join(v || ""), template);
}

function cleanHTML(raw) {
  return raw.replace(/```html|```/gi, "").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\u2014|\u2013/g, "").trim();
}

function pJSON(raw) {
  return JSON.parse(raw.replace(/```json|```/g, "").trim());
}

function insertLink(html, anchor, url) {
  if (!anchor || !url) return html;
  const idx = html.toLowerCase().indexOf(anchor.toLowerCase());
  if (idx === -1) return html;
  return html.slice(0, idx) + `<a href="${url}" target="_blank" rel="noopener">${html.slice(idx, idx + anchor.length)}</a>` + html.slice(idx + anchor.length);
}

function getFallbackImage(keyword) {
  let seed = 0;
  for (let i = 0; i < keyword.length; i++) seed += keyword.charCodeAt(i);
  return `https://picsum.photos/seed/${seed % 1000}/1200/600`;
}

async function getImage(keyword, index = 0) {
  const fallback = getFallbackImage(keyword + index);
  const page = index + 1;

  if (index % 2 === 0 && UNSPLASH_KEY) {
    try {
      const r = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(keyword)}&per_page=1&page=${page}&orientation=landscape&client_id=${UNSPLASH_KEY}`);
      const d = r.ok ? await r.json() : null;
      const url = d?.results?.[0]?.urls?.regular;
      if (url) return url;
    } catch {}
  }

  if (PEXELS_KEY) {
    try {
      const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(keyword)}&per_page=1&page=${page}&orientation=landscape`, { headers: { Authorization: PEXELS_KEY } });
      const d = r.ok ? await r.json() : null;
      const url = d?.photos?.[0]?.src?.large2x || d?.photos?.[0]?.src?.large;
      if (url) return url;
    } catch {}
  }

  if (UNSPLASH_KEY) {
    try {
      const r = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(keyword)}&per_page=1&page=${page}&orientation=landscape&client_id=${UNSPLASH_KEY}`);
      const d = r.ok ? await r.json() : null;
      const url = d?.results?.[0]?.urls?.regular;
      if (url) return url;
    } catch {}
  }

  return fallback;
}

async function callClaude(prompt, maxTokens = 1000, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: maxTokens,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      return data.content.find((b) => b.type === "text").text || "";
    } catch (err) {
      if (attempt === retries) throw err;
      console.log(`  ↺ Retry ${attempt + 1}/${retries}...`);
      await sleep(2000);
    }
  }
}

async function scrapeUrl(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) });
    const html = await r.text();
    const headings = [...html.matchAll(/<h[123][^>]*>(.*?)<\/h[123]>/gi)]
      .map((m) => ({ tag: m[0].match(/<(h[123])/i)[1], text: m[1].replace(/<[^>]+>/g, "").trim() }))
      .slice(0, 8);
    return { url, headings, text: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 3000) };
  } catch {
    return { url, headings: [], text: "" };
  }
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

async function run() {
  console.log("🚀 Starting pipeline...");

  // ── 0. Check env vars ──
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  if (!MAKE_WEBHOOK_URL) throw new Error("MAKE_WEBHOOK_URL not set");

  // ── 1. Read keyword from Google Sheet ──
  console.log("\n📥 Step 1 — Reading keyword from Google Sheet...");
  const csvUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=1298400966`;
  const csvRes = await fetch(csvUrl);
  const csvText = await csvRes.text();
  const rows = csvText.split("\n").slice(1).map((row) => {
    const cols = row.split(",").map((c) => c.replace(/^"|"$/g, "").trim());
    return { keyword: cols[0], url1: cols[1] || "", url2: cols[2] || "", url3: cols[3] || "" };
  }).filter((r) => r.keyword && r.keyword.length > 0);

  if (rows.length === 0) throw new Error("No keywords found in Google Sheet");
  const dayIndex = new Date().getDate() % rows.length;
  const kw = rows[dayIndex];
  console.log(`  ✅ Keyword: "${kw.keyword}" (index ${dayIndex}/${rows.length})`);

  // ── 2. Scrape competitors ──
  console.log("\n🔍 Step 2 — Scraping competitors...");
  const urls = [kw.url1, kw.url2, kw.url3].filter(Boolean);
  let cH = "No competitor data available.";
  let cS = "No competitor data available.";
  if (urls.length > 0) {
    const scraped = await Promise.all(urls.map(scrapeUrl));
    cH = scraped.map((s, i) => `Competitor ${i+1}: ${s.headings.map(h => h.text).slice(0, 8).join(", ")}`).join("\n");
    cS = scraped.map((s, i) => `Competitor ${i+1}:\nHeadings: ${s.headings.map(h => `[${h.tag}] ${h.text}`).join(" | ")}\nContent: ${s.text.slice(0, 500)}`).join("\n\n");
    console.log(`  ✅ Scraped ${scraped.length} pages`);
  } else {
    console.log("  ⚠️  No competitor URLs — skipping");
  }

  // ── 3. Title + Meta ──
  console.log("\n✍️  Step 3 — Title & Meta...");
  const tRaw = await callClaude(fillPrompt(PROMPTS.titleMeta, {
    "{{keyword}}": kw.keyword, "{{tone}}": TONE, "{{brand}}": BRAND, "{{competitor_headings}}": cH
  }), 600);
  const tData = pJSON(tRaw);
  console.log(`  ✅ Title: "${tData.title}"`);

  // ── 4. Structure ──
  console.log("\n🏗️  Step 4 — Structure H2/H3...");
  const sRaw = await callClaude(fillPrompt(PROMPTS.structure, {
    "{{keyword}}": kw.keyword, "{{title}}": tData.title, "{{focus_angle}}": tData.focus_angle,
    "{{word_count}}": String(WORD_COUNT), "{{competitor_summary}}": cS
  }), 2000);
  const struct = pJSON(sRaw);
  struct.sections = struct.sections.slice(0, 3);
  console.log(`  ✅ Structure: ${struct.sections.length} sections`);

  // ── 5. Write sections ──
  console.log("\n📝 Step 5 — Writing sections...");
  const swc = Math.round(WORD_COUNT / 3);
  const secHtmls = [];
  for (let i = 0; i < struct.sections.length; i++) {
    const sec = struct.sections[i];
    const html = await callClaude(fillPrompt(PROMPTS.section, {
      "{{title}}": tData.title, "{{keyword}}": kw.keyword, "{{h2}}": sec.h2,
      "{{h3s}}": (sec.h3s || []).join(", "), "{{writing_brief}}": sec.writing_brief,
      "{{section_word_count}}": String(swc)
    }), 1000);
    secHtmls.push(cleanHTML(html));
    console.log(`  ✅ Section ${i+1}/${struct.sections.length}: "${sec.h2}"`);
    await sleep(400);
  }

  // ── 6. FAQ ──
  console.log("\n❓ Step 6 — FAQ...");
  const fHtml = cleanHTML(await callClaude(fillPrompt(PROMPTS.faq, {
    "{{keyword}}": kw.keyword,
    "{{faq_questions}}": struct.faq_questions.map((q, i) => `${i+1}. ${q}`).join("\n")
  }), 1000));
  console.log("  ✅ FAQ generated");

  // ── 7. Key Takeaways ──
  console.log("\n⭐ Step 7 — Key Takeaways...");
  const eHtml = cleanHTML(await callClaude(fillPrompt(PROMPTS.essential, {
    "{{title}}": tData.title, "{{keyword}}": kw.keyword,
    "{{sections}}": struct.sections.map((s) => s.h2).join(", ")
  }), 600));
  console.log("  ✅ Key Takeaways written");

  // ── 8. Comparison table ──
  console.log("\n📊 Step 8 — Comparison table...");
  const articleSummary = secHtmls.map((h) => h.replace(/<[^>]+>/g, " ")).join(" ").replace(/\s+/g, " ").slice(0, 1500);
  const tableRaw = await callClaude(fillPrompt(PROMPTS.table, {
    "{{keyword}}": kw.keyword, "{{title}}": tData.title, "{{article_summary}}": articleSummary
  }), 1000);
  let tableHtml = tableRaw.replace(/```html|```/gi, "").trim();
  const tableEnd = tableHtml.lastIndexOf("</table>");
  tableHtml = tableEnd !== -1 ? tableHtml.slice(0, tableEnd + 8) : "";
  console.log("  ✅ Table generated");

  // ── 9. Images ──
  console.log("\n🖼️  Step 9 — Images...");
  const featImg = await getImage(kw.keyword, 0);
  console.log("  ✅ Featured image ready");
  const imgMap = {};
  for (let i = 0; i < Math.min(struct.sections.length, 3); i++) {
    imgMap[i] = await getImage(`${kw.keyword} ${struct.sections[i].h2}`, i + 1);
    console.log(`  ✅ Image ${i+1} ready`);
    await sleep(400);
  }

  // ── 10. Assemble HTML ──
  console.log("\n🔧 Step 10 — Assembling HTML...");
  const css = `<style>.essentiel-block{background:#f0f7ff;border-left:4px solid #2563eb;padding:16px 20px;border-radius:0 8px 8px 0;margin-bottom:28px;} h2{margin-top:72px;margin-bottom:24px;} h3{margin-top:40px;margin-bottom:16px;} p{margin-bottom:14px;} ul{margin-bottom:14px;} table{width:100%;border-collapse:collapse;margin:24px 0;} th{background:#f0f7ff;padding:10px 12px;text-align:left;border:1px solid #cbd5e1;} td{padding:9px 12px;border:1px solid #e2e8f0;}</style>`;
  const parts = [css, eHtml];
  secHtmls.forEach((h, i) => {
    parts.push(h);
    if (i === 0 && tableHtml) parts.push(tableHtml);
    if (imgMap[i]) parts.push(`<img src="${imgMap[i]}" alt="${struct.sections[i].h2}" style="width:60%;max-width:600px;display:block;margin:16px auto;border-radius:8px;" loading="lazy"/>`);
  });
  parts.push(fHtml);
  const finalHTML = parts.join("\n\n");
  console.log(`  ✅ HTML assembled (${finalHTML.length} chars)`);

  // ── 11. Send to Make ──
  console.log("\n🚀 Step 11 — Sending to Make → Shopify...");
  const payload = {
    title: tData.title,
    meta_description: tData.meta_description,
    author: "Admin",
    tags: kw.keyword,
    featured_image_url: featImg,
    body_html: finalHTML,
    keyword: kw.keyword,
    published: true,
    published_at: new Date().toISOString(),
  };
  const makeRes = await fetch(MAKE_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!makeRes.ok) throw new Error(`Make webhook error: ${makeRes.status}`);
  console.log(`\n✅ Done! Article published: "${tData.title}"`);
}

run().catch((err) => {
  console.error("\n❌ Pipeline failed:", err.message);
  process.exit(1);
});

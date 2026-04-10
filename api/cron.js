export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // Read keywords from Google Sheet
    const sheetId = "1D3unbXti5EXGfk8_843jFluCHwDCJa2Hq-j9qGNRt5Y";
    const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=1298400966`;
    const csvRes = await fetch(csvUrl);
    const csvText = await csvRes.text();

    // Parse CSV
    const rows = csvText.split("\n").slice(1).map((row) => {
      const cols = row.split(",").map((c) => c.replace(/^"|"$/g, "").trim());
      return { keyword: cols[0], url1: cols[1] || "", url2: cols[2] || "", url3: cols[3] || "", used: false };
    }).filter((r) => r.keyword);

    // Pick first keyword (rotate based on day of month)
    const dayIndex = new Date().getDate() % rows.length;
    const kw = rows[dayIndex];
    if (!kw) return res.status(200).json({ message: "No keywords available" });

    // Run pipeline
    const result = await runPipeline(kw);
    return res.status(200).json({ success: true, title: result.title, keyword: kw.keyword });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function callClaude(prompt, maxTokens) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.VITE_ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens || 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.content.find((b) => b.type === "text").text || "";
}

async function runPipeline(kw, published) {
  // 1. Scrape competitors (optional)
  const urls = [kw.url1, kw.url2, kw.url3].filter(Boolean);
  let cH = "No competitor data available.";
  let cS = "No competitor data available.";
  
  if (urls.length > 0) {
    const scraped = await Promise.all(urls.map(async (url) => {
      try {
        const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
        const html = await r.text();
        const headings = [...html.matchAll(/<h[123][^>]*>(.*?)<\/h[123]>/gi)]
          .map((m) => m[1].replace(/<[^>]+>/g, "").trim())
          .slice(0, 8);
        return { url, headings, text: html.replace(/<[^>]+>/g, " ").slice(0, 500) };
      } catch { return { url, headings: [], text: "" }; }
    }));
    cH = scraped.map((s, i) => `Competitor ${i+1}: ${s.headings.join(", ")}`).join("\n");
    cS = scraped.map((s, i) => `Competitor ${i+1}:\nHeadings: ${s.headings.join(" | ")}\nContent: ${s.text}`).join("\n\n");
  }

  // 2. Title + Meta
  const tRaw = await callClaude(`Propose 1 optimized title and meta description for: "${kw.keyword}". Brand: transpocodirect.com. Competitor headings:\n${cH}\n\nJSON only: {"title":"...","meta_description":"...","focus_angle":"..."}`, 600);
  const tData = JSON.parse(tRaw.replace(/```json|```/g, "").trim());

  // 3. Structure
  const sRaw = await callClaude(`Create SEO outline for "${kw.keyword}". Title: "${tData.title}". Competitors:\n${cS}\n\nExactly 3 H2s with 2-4 H3s each. JSON only:\n{"sections":[{"h2":"...","h3s":["..."],"writing_brief":"..."}],"faq_questions":["Q1?","Q2?","Q3?","Q4?","Q5?"]}`, 2000);
  const struct = JSON.parse(sRaw.replace(/```json|```/g, "").trim());
  struct.sections = struct.sections.slice(0, 3);

  // 4. Write sections
  const swc = Math.round(1500 / 3);
  const secHtmls = [];
  for (const sec of struct.sections) {
    const html = await callClaude(`Write blog section. Title: "${tData.title}". Keyword: "${kw.keyword}". H2: ${sec.h2}. H3s: ${sec.h3s.join(", ")}. Brief: ${sec.writing_brief}. ~${swc} words. HTML only, no markdown.`, 1000);
    secHtmls.push(html.replace(/```html|```/gi, "").trim());
  }

  // 5. FAQ
  const fHtml = await callClaude(`Write FAQ for "${kw.keyword}". Questions:\n${struct.faq_questions.map((q,i) => `${i+1}. ${q}`).join("\n")}\nHTML only: <h2>FAQ</h2><h3>Q</h3><p>A</p>`, 1000);

  // 6. Key Takeaways
  const eHtml = await callClaude(`Write Key Takeaways block for "${kw.keyword}". Title: "${tData.title}". Sections: ${struct.sections.map(s=>s.h2).join(", ")}. HTML only: <div class="essentiel-block"><h2>Key Takeaways - title</h2><p>intro</p><ul><li><strong>point</strong></li></ul></div>`, 600);

  // 7. Assemble HTML
  const css = "<style>.essentiel-block{background:#f0f7ff;border-left:4px solid #2563eb;padding:16px 20px;border-radius:0 8px 8px 0;margin-bottom:28px;} h2{margin-top:72px;margin-bottom:24px;} h3{margin-top:40px;margin-bottom:16px;}</style>";
  const parts = [css, eHtml, ...secHtmls, fHtml];
  const finalHTML = parts.join("\n\n");

  // 8. Send to Make
  const makeWebhook = process.env.MAKE_WEBHOOK_URL;
  if (!makeWebhook) throw new Error("MAKE_WEBHOOK_URL not set");

  await fetch(makeWebhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: tData.title,
      meta_description: tData.meta_description,
      author: "Admin",
      tags: kw.keyword,
      featured_image_url: "",
      body_html: finalHTML,
      keyword: kw.keyword,
      published: true,
      published_at: new Date().toISOString(),
    }),
  });

  return { title: tData.title };
}

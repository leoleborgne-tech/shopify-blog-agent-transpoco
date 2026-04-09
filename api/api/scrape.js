export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "Missing url" });

    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BlogAgent/1.0)" }
    });
    const html = await response.text();
    return res.status(200).json({ contents: html });
  } catch (error) {
    return res.status(500).json({ error: error.message, contents: "" });
  }
}

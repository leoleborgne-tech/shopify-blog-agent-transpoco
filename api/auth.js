export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { password } = req.body;
  const appPassword = process.env.APP_PASSWORD;

  if (!appPassword) return res.status(500).json({ error: "APP_PASSWORD not configured" });
  if (password === appPassword) return res.status(200).json({ success: true });
  return res.status(401).json({ error: "Invalid password" });
}

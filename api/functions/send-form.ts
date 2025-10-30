// api/functions/send-form.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { queries } = req.body;

    if (!queries || !Array.isArray(queries)) {
      return res.status(400).json({ error: "Invalid request body" });
    }

    // Codificar las queries en base64 (para que GitHub Actions las pueda leer)
    const payload = Buffer.from(JSON.stringify(queries)).toString("base64");

    // Datos del repositorio
    const owner = "NIU1636242";
    const repo = "reCollecTF2";
    const workflow_id = "update-db.yml";
    const token = process.env.GH_TOKEN;

    if (!token) {
      throw new Error("Missing GitHub token in environment variables.");
    }

    // Disparar el workflow en GitHub Actions
    const resp = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow_id}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
        body: JSON.stringify({
          ref: "main",
          inputs: { queries: payload },
        }),
      }
    );

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`GitHub API error: ${text}`);
    }

    return res.status(200).json({ ok: true, message: "Workflow triggered" });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

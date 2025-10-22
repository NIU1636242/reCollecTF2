// /api/mutate.js — Commiteja un patch .sql (no toca el .db)
import { Octokit } from "@octokit/rest";

// petita whitelist (seguretat bàsica)
const isAllowed = (sql = "") =>
  /^\s*(insert|update|delete|replace|create|alter|drop)\b/i.test(sql);

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { sql, params = [] } = req.body || {};
    if (!sql || !isAllowed(sql)) return res.status(400).json({ error: "Only mutation SQL allowed" });

    // substitució simple de paràmetres ? -> valors escapats
    const esc = v =>
      typeof v === "number" ? String(v)
      : `'${String(v).replace(/'/g, "''")}'`;
    let finalSql = sql;
    for (const p of params) finalSql = finalSql.replace(/\?/, esc(p));

    const {
      GH_TOKEN, GH_OWNER, GH_REPO,
      BRANCH = "main",
      PATCH_DIR = "patches", //carpeta on desarem els .sql
      WORKFLOW_FILE = ".github/workflows/update-db.yml",
    } = process.env;

    if (!GH_TOKEN || !GH_OWNER || !GH_REPO)
      return res.status(500).json({ error: "Missing GH env vars" });

    const octokit = new Octokit({ auth: GH_TOKEN });

    // nom únic per al patch
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const path = `${PATCH_DIR}/${ts}.sql`;
    const content = Buffer.from(finalSql + "\n").toString("base64");

    // crea el fitxer .sql amb la mutació
    await octokit.repos.createOrUpdateFileContents({
      owner: GH_OWNER,
      repo: GH_REPO,
      path,
      message: `chore(db): add SQL patch ${ts}`,
      content,
      branch: BRANCH,
    });

    // dispara el workflow perquè apliqui el patch i regeneri el .gz
    await octokit.actions.createWorkflowDispatch({
      owner: GH_OWNER,
      repo: GH_REPO,
      workflow_id: WORKFLOW_FILE,
      ref: BRANCH,
      inputs: { reason: "apply-sql-patches" }
    });

    return res.status(200).json({ ok: true, patch: path });
  } catch (err) {
    console.error("mutate error:", err);
    return res.status(500).json({ error: err.message });
  }
}

// /api/mutate.js
import { Octokit } from "@octokit/rest";
import initSqlJs from "sql.js";

// seguridad básica: solo permitimos sentencias que modifican (no SELECT)
const isMutation = (sql = "") => /^\s*(insert|update|delete|replace|create|alter|drop)\b/i.test(sql);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { sql, params = [] } = req.body || {};
  if (!sql || !isMutation(sql)) return res.status(400).json({ error: "Only mutation SQL allowed" });

  const {
    GH_TOKEN,
    GH_OWNER,
    GH_REPO,
    DB_PATH = "data/CollecTF.db",
    BRANCH = "main",
    WORKFLOW_FILE = ".github/workflows/update-db.yml",
  } = process.env;

  if (!GH_TOKEN || !GH_OWNER || !GH_REPO) {
    return res.status(500).json({ error: "Missing GitHub env vars (GH_TOKEN, GH_OWNER, GH_REPO)" });
  }

  const octokit = new Octokit({ auth: GH_TOKEN });

  try {
    // 1) Descargar el .db actual del repo (contenido base64)
    const { data: file } = await octokit.repos.getContent({
      owner: GH_OWNER,
      repo: GH_REPO,
      path: DB_PATH,
      ref: BRANCH,
    });

    if (!("content" in file)) throw new Error("DB file not found or not a file");
    const dbBytes = Uint8Array.from(Buffer.from(file.content, "base64"));

    // 2) Abrir DB en memoria con sql.js (WASM)
    const SQL = await initSqlJs();
    const db = new SQL.Database(dbBytes);

    // 3) Ejecutar la mutación con parámetros
    //    Usamos prepared statement para bind seguro
    const stmt = db.prepare(sql);
    stmt.bind(params);
    while (stmt.step()) {} // por si afectara varias filas
    stmt.free();

    // 4) Exportar DB (bytes) y subirla con un commit
    const updatedBytes = db.export();
    const updatedBase64 = Buffer.from(updatedBytes).toString("base64");

    await octokit.repos.createOrUpdateFileContents({
      owner: GH_OWNER,
      repo: GH_REPO,
      path: DB_PATH,
      message: `chore(db): apply mutation via API\n\nSQL:\n${sql}\nParams:\n${JSON.stringify(params)}`,
      content: updatedBase64,
      branch: BRANCH,
      sha: file.sha, // necesario para actualizar
    });

    // 5) (Opcional) Disparar workflow para regenerar public/CollecTF.db.gz
    await octokit.actions.createWorkflowDispatch({
      owner: GH_OWNER,
      repo: GH_REPO,
      workflow_id: WORKFLOW_FILE, // ruta al yml
      ref: BRANCH,
      inputs: {
        reason: "db-updated",
      },
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("mutate error:", err);
    return res.status(500).json({ error: err.message });
  }
}

// /api/mutate.js
import { Octokit } from "@octokit/rest";
import initSqlJs from "sql.js";
import zlib from "zlib";

//Seguridad: solo se permiten queries que modifiquen la BD
const isMutation = (sql = "") =>
  /^\s*(insert|update|delete|replace|create|alter|drop)\b/i.test(sql);

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const { sql, params = [] } = req.body || {};
  if (!sql || !isMutation(sql))
    return res.status(400).json({ error: "Only mutation SQL allowed" });

  //Variables de entorno (configuradas en Vercel)
  const {
    GH_TOKEN,
    GH_OWNER,
    GH_REPO,
    DB_PATH = "public/CollecTF.db.gz",
    BRANCH = "main",
    WORKFLOW_FILE = ".github/workflows/update-db.yml",
  } = process.env;

  if (!GH_TOKEN || !GH_OWNER || !GH_REPO) {
    return res
      .status(500)
      .json({ error: "Missing GitHub env vars (GH_TOKEN, GH_OWNER, GH_REPO)" });
  }

  const octokit = new Octokit({ auth: GH_TOKEN });

  try {
    //Descargar el .gz del repositorio
    const { data: file } = await octokit.repos.getContent({
      owner: GH_OWNER,
      repo: GH_REPO,
      path: DB_PATH,
      ref: BRANCH,
    });

    if (!("content" in file))
      throw new Error("DB file not found or not a file");

    //Descomprimir (de base64 → gzip → bytes SQLite)
    const compressedBuffer = Buffer.from(file.content, "base64");
    const dbBuffer = zlib.gunzipSync(compressedBuffer);
    const dbBytes = new Uint8Array(dbBuffer);

    //Abrir DB en memoria y ejecutar la mutación
    const SQL = await initSqlJs();
    const db = new SQL.Database(dbBytes);

    const stmt = db.prepare(sql);
    stmt.bind(params);
    while (stmt.step()) {} // Ejecuta todas las filas afectadas
    stmt.free();

    //Exportar DB → comprimir → codificar base64
    const updatedBytes = db.export();
    const updatedGz = zlib.gzipSync(Buffer.from(updatedBytes));
    const updatedBase64 = updatedGz.toString("base64");

    //Subir el nuevo .gz al repo
    await octokit.repos.createOrUpdateFileContents({
      owner: GH_OWNER,
      repo: GH_REPO,
      path: DB_PATH,
      message: `chore(db): apply mutation via API\n\nSQL:\n${sql}\nParams:\n${JSON.stringify(
        params
      )}`,
      content: updatedBase64,
      branch: BRANCH,
      sha: file.sha,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Mutate error:", err);
    return res.status(500).json({ error: err.message });
  }
}

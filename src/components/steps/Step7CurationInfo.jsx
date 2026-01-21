// src/components/steps/Step7CurationInfo.jsx
import { useMemo, useState } from "react";
import { useCuration } from "../../context/CurationContext";
import { dispatchWorkflow } from "../../utils/serverless";

// --------------------
// Helpers
// --------------------
function esc(str) {
  return String(str ?? "").replace(/'/g, "''");
}

function truthyBool(v) {
  return v ? 1 : 0;
}

// --------------------
// Component
// --------------------
export default function Step7CurationInfo() {
  const { tf } = useCuration();

  const REVISION_REASONS = useMemo(
    () => [
      { value: "None", label: "None" },
      { value: "No comparable genome in NCBI", label: "No comparable genome in NCBI" },
      { value: "Matching genome still in progress", label: "Matching genome still in progress" },
      { value: "No comparable TF protein sequence in NCBI", label: "No comparable TF protein sequence in NCBI" },
      { value: "Other reason (specify in notes)", label: "Other reason (specify in notes)" },
    ],
    []
  );

  // UI state (render igual)
  const [revisionReason, setRevisionReason] = useState("None");
  const [curationComplete, setCurationComplete] = useState(true);
  const [notes, setNotes] = useState("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  // Para esta prueba mínima SOLO necesitamos un TF con nombre
  const canSubmit = useMemo(() => {
    return !!tf?.name && !loading;
  }, [tf, loading]);

  function buildMinimalTFSql() {
    const tfName = String(tf?.name || "").trim();
    if (!tfName) throw new Error("Missing TF name (Step 2).");

    // Intentamos detectar family_id del objeto tf si existe.
    // (Puede venir como family_id, familyId, family, etc.)
    const rawFamilyId =
      tf?.family_id ??
      tf?.familyId ??
      tf?.familyID ??
      tf?.family; // si aquí viene un número, también sirve

    const familyIdNum = Number(rawFamilyId);
    const hasFamilyId = Number.isFinite(familyIdNum) && familyIdNum > 0;

    // Si NO tenemos family_id, creamos una family “segura” con nombre derivado del TF
    // (Esto imita Step2 cuando creabas una familia nueva)
    const familyName = `AutoFamily:${tfName}`;

    const requiresRevision = revisionReason !== "None";
    const revisionText = requiresRevision ? `Revision reason: ${revisionReason}` : "";
    const familyDesc = [revisionText, notes].filter(Boolean).join("\n");

    // Descripción del TF: usamos notes también, por simplicidad
    const tfDesc = notes || "";

    const sql = [];

    sql.push("PRAGMA foreign_keys = ON;");
    sql.push("BEGIN TRANSACTION;");

    if (!hasFamilyId) {
      // 1) Crear family si no existe
      sql.push(`
INSERT OR IGNORE INTO core_tffamily (name, description)
VALUES ('${esc(familyName)}', '${esc(familyDesc)}');
      `.trim());
    }

    // 2) Insertar TF (si ya existe con ese nombre y hay UNIQUE, esto puede fallar;
    // para evitarlo, usamos INSERT OR IGNORE y luego UPDATE para completar campos)
    // Family id: si tenemos uno numérico lo usamos; si no, hacemos SELECT por nombre de family.
    const familyIdExpr = hasFamilyId
      ? `${familyIdNum}`
      : `(SELECT tf_family_id FROM core_tffamily WHERE name='${esc(familyName)}' LIMIT 1)`;

    sql.push(`
INSERT OR IGNORE INTO core_tf (name, family_id, description)
VALUES ('${esc(tfName)}', ${familyIdExpr}, '${esc(tfDesc)}');
    `.trim());

    // 3) Si el TF ya existía, al menos intentamos rellenar family_id/description si están vacíos
    sql.push(`
UPDATE core_tf
SET
  family_id = COALESCE(family_id, ${familyIdExpr}),
  description = CASE
    WHEN description IS NULL OR description='' THEN '${esc(tfDesc)}'
    ELSE description
  END
WHERE lower(name)=lower('${esc(tfName)}');
    `.trim());

    // 4) CHECK (para que el workflow “falle” si no se pudo crear/encontrar family_id)
    sql.push(`
SELECT 1 / CASE
  WHEN (SELECT COUNT(*) FROM core_tf WHERE lower(name)=lower('${esc(tfName)}')) >= 1 THEN 1
  ELSE 0
END;
    `.trim());

    sql.push("COMMIT;");

    return sql.join("\n\n");
  }

  async function handleSubmit() {
    setMsg("");
    setLoading(true);

    try {
      const sqlString = buildMinimalTFSql();

      await dispatchWorkflow({
        inputs: { queries: sqlString },
      });

      setMsg("Sended: se ha intentado añadir TF (+ family si hacía falta) a la base de datos.");
    } catch (e) {
      console.error(e);
      setMsg(`Error: ${e?.message || String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Step 7 – Curation information</h2>

      <div className="bg-surface border border-border rounded p-4 space-y-3">
        <div>
          <label className="block font-medium mb-1">Revision required</label>
          <select
            className="form-control"
            value={revisionReason}
            onChange={(e) => setRevisionReason(e.target.value)}
          >
            {REVISION_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted mt-1">
            Select, if needed, the reason why this curation may require revision.
          </p>
        </div>

        <label className="inline-flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={curationComplete}
            onChange={(e) => setCurationComplete(e.target.checked)}
          />
          <span>
            <div className="font-medium">Curation for this paper is complete</div>
            <div className="text-xs text-muted">
              Check if there are no more curations pending for this paper.
            </div>
          </span>
        </label>

        <div>
          <label className="block font-medium mb-1">Notes</label>
          <textarea
            className="form-control w-full h-40"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any additional notes on the curation process..."
          />
          <p className="text-xs text-muted mt-1">
            Include any relevant notes (e.g., why sites were left out, surrogate genome choice, etc.).
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          className="btn"
          onClick={handleSubmit}
          disabled={!canSubmit}
          title={!canSubmit ? "Need a TF name from Step 2 first." : ""}
        >
          {loading ? "Submitting..." : "Submit curation"}
        </button>
      </div>

      {msg && (
        <div className={`text-sm ${msg.startsWith("Tot correcte") ? "text-green-400" : "text-red-400"}`}>
          {msg}
        </div>
      )}
    </div>
  );
}

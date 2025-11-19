import { useState } from "react";
import { runQuery } from "../../db/queryExecutor";
import { dispatchWorkflow } from "../../utils/serverless";
import { useCuration } from "../../context/CurationContext";

export default function Step3ExperimentalMethods() {
  const { techniques, setTechniques, goToNextStep } = useCuration();

  const [ecoInput, setEcoInput] = useState("");
  const [validatedEco, setValidatedEco] = useState(null);
  const [existsInDB, setExistsInDB] = useState(null);
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  function esc(str) {
    return String(str || "").replace(/'/g, "''");
  }

  async function validateEcoAPI(code) {
    try {
      const res = await fetch(
        `https://www.ebi.ac.uk/QuickGO/services/ontology/eco/terms/${code}`
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  async function handleValidate() {
    const eco = ecoInput.trim().toUpperCase();
    if (!eco.startsWith("ECO:")) {
      setMsg("El codi ECO ha de començar per ECO:");
      return;
    }

    setLoading(true);
    setMsg("");
    setValidatedEco(null);

    try {
      // 1) validar amb QuickGO
      const valid = await validateEcoAPI(eco);
      if (!valid) {
        setMsg("Aquest ECO no existeix a QuickGO.");
        return;
      }

      setValidatedEco(eco);
      setMsg("ECO validat correctament.");

      // 2) mirar si existeix a DB
      const rows = await runQuery(
        `SELECT * FROM ExperimentalTechnique WHERE eco_code = ? LIMIT 1`,
        [eco]
      );

      if (rows.length) {
        setExistsInDB(true);
      } else {
        setExistsInDB(false);
      }
    } catch (err) {
      console.error(err);
      setMsg("Error validant l’ECO.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateEco() {
    if (!category.trim()) {
      setMsg("Cal indicar una categoria.");
      return;
    }

    const sql = `
      INSERT INTO ExperimentalTechnique (eco_code, category, description)
      VALUES ('${esc(validatedEco)}', '${esc(category)}', '${esc(description)}');
    `;

    try {
      await dispatchWorkflow({ inputs: { queries: sql } });
      setMsg("ECO creat. S’actualitzarà la BD després del redeploy.");

      // afegim l’ECO a la llista de tècniques seleccionades
      setTechniques([...techniques, validatedEco]);

      // netejar formulari
      setCategory("");
      setDescription("");
      setValidatedEco(null);
      setEcoInput("");

    } catch (err) {
      console.error(err);
      setMsg("Error enviant consultes.");
    }
  }

  function handleAddExisting() {
    setTechniques([...techniques, validatedEco]);
    setValidatedEco(null);
    setEcoInput("");
    setMsg("ECO afegit.");
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Step 3 – Experimental Methods</h2>

      <div>
        <label className="block font-medium">Introdueix un codi ECO</label>
        <div className="flex gap-2">
          <input
            className="form-control"
            placeholder="ECO:0005667"
            value={ecoInput}
            onChange={(e) => setEcoInput(e.target.value)}
          />
          <button className="btn" onClick={handleValidate} disabled={loading}>
            {loading ? "Validant..." : "Validar"}
          </button>
        </div>
      </div>

      {msg && <p className="text-blue-300">{msg}</p>}

      {validatedEco && existsInDB === true && (
        <div className="p-4 bg-surface border border-border rounded">
          <p>L’ECO existeix a la base de dades.</p>
          <button className="btn mt-2" onClick={handleAddExisting}>
            Afegir a la curació
          </button>
        </div>
      )}

      {validatedEco && existsInDB === false && (
        <div className="p-4 bg-surface border border-border rounded space-y-3">
          <h3 className="text-lg font-semibold">Crear nova tècnica experimental</h3>

          <div>
            <label className="block font-medium">Categoria</label>
            <input
              className="form-control"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Exemple: ChIP-seq"
            />
          </div>

          <div>
            <label className="block font-medium">Descripció</label>
            <textarea
              className="form-control"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descripció breu"
            />
          </div>

          <button className="btn" onClick={handleCreateEco}>
            Desa nova tècnica
          </button>
        </div>
      )}

      <div>
        <h3 className="font-semibold mt-4">Tècniques afegides:</h3>
        {techniques.length === 0 && <p>Encara no n’has afegit cap.</p>}
        <ul className="list-disc pl-6">
          {techniques.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </div>

      {techniques.length > 0 && (
        <button className="btn mt-4" onClick={goToNextStep}>
          Continuar al Step 4
        </button>
      )}
    </div>
  );
}

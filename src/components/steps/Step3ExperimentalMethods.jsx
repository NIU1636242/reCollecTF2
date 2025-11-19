import { useState, useEffect } from "react";
import { runQuery } from "../../db/queryExecutor";
import { dispatchWorkflow } from "../../utils/serverless";
import { useCuration } from "../../context/CurationContext";

export default function Step3ExperimentalMethods() {
  const { techniques, setTechniques, goToNextStep } = useCuration();

  const [ecoInput, setEcoInput] = useState("");
  const [validatedEco, setValidatedEco] = useState(null);
  const [ecoName, setEcoName] = useState(""); // Nombre del ECO desde QuickGO
  const [existsInDB, setExistsInDB] = useState(null);
  const [categories, setCategories] = useState([]);  // lista categorías DB
  const [selectedCategory, setSelectedCategory] = useState("");
  const [techDescription, setTechDescription] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  /** Utility to escape quotes */
  function esc(str) {
    return String(str || "").replace(/'/g, "''");
  }

  /** Cargar todas las categorías de la BD */
  useEffect(() => {
    async function fetchCategories() {
      try {
        const rows = await runQuery(`
          SELECT category_id, name
          FROM core_experimentaltechniquecategory
          ORDER BY name ASC
        `);
        setCategories(rows);
      } catch (e) {
        console.error("Error loading categories:", e);
      }
    }
    fetchCategories();
  }, []);

  /** Validar ECO usando QuickGO API */
  async function validateEcoAPI(code) {
    try {
      const res = await fetch(
        `https://www.ebi.ac.uk/QuickGO/services/ontology/eco/terms/${code}`,
        { headers: { Accept: "application/json" } }
      );

      if (!res.ok) return null;

      const json = await res.json();
      if (json.results?.length > 0)
        return json.results[0];  // retornamos objeto ECO

      return null;
    } catch {
      return null;
    }
  }

  /** Cuando se pulsa VALIDAR */
  async function handleValidate() {
    setMsg("");
    setExistsInDB(null);
    setValidatedEco(null);

    let raw = ecoInput.trim().toUpperCase();

    // Auto-prepend ECO:
    if (!raw.startsWith("ECO:")) {
      raw = "ECO:" + raw;
    }

    setLoading(true);

    try {
      const ecoObj = await validateEcoAPI(raw);
      if (!ecoObj) {
        setMsg("Aquest ECO no existeix a QuickGO.");
        return;
      }

      // Guardamos ECO validat
      setValidatedEco(raw);
      setEcoName(ecoObj.name);
      setMsg("ECO validat correctament.");

      // Comprobar si existe en la BD
      const rows = await runQuery(
        `SELECT * FROM core_experimentaltechnique WHERE EO_term = ?`,
        [raw]
      );

      setExistsInDB(rows.length > 0);
    } catch (err) {
      console.error(err);
      setMsg("Error validant l’ECO.");
    } finally {
      setLoading(false);
    }
  }

  /** Añadir ECO existente */
  function handleAddExisting() {
    if (!validatedEco) return;

    const newList = [...techniques, validatedEco];
    setTechniques(newList);

    setMsg("ECO afegit.");
    setValidatedEco(null);
    setEcoInput("");
  }

  /** Crear ECO nuevo */
  async function handleCreateEco() {
    if (!selectedCategory) {
      setMsg("Cal seleccionar una categoria.");
      return;
    }

    const sql = `
      INSERT INTO core_experimentaltechnique (name, description, preset_function, EO_term)
      VALUES ('${esc(ecoName)}', '${esc(techDescription)}', NULL, '${esc(validatedEco)}');

      INSERT INTO core_experimentaltechnique_categories (experimentaltechnique_id, experimentaltechniquecategory_id)
      VALUES (
        (SELECT technique_id FROM core_experimentaltechnique WHERE EO_term='${esc(validatedEco)}'),
        ${Number(selectedCategory)}
      );
    `;

    try {
      await dispatchWorkflow({ inputs: { queries: sql } });
      setMsg("ECO creat i relacionat amb la categoria. La BD s'actualitzarà després del redeploy.");

      setTechniques([...techniques, validatedEco]);

      // reset
      setValidatedEco(null);
      setEcoInput("");
      setSelectedCategory("");
      setTechDescription("");

    } catch (err) {
      console.error(err);
      setMsg("Error enviant consultes.");
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Step 3 – Experimental Methods</h2>

      {/* INPUT ECO */}
      <div>
        <label className="block font-medium">Introdueix un codi ECO</label>
        <div className="flex gap-2">
          <input
            className="form-control"
            placeholder="Exemple: 0005667"
            value={ecoInput}
            onChange={(e) => setEcoInput(e.target.value)}
          />
          <button className="btn" onClick={handleValidate} disabled={loading}>
            {loading ? "Validant..." : "Validar"}
          </button>
        </div>
      </div>

      {msg && <p className="text-blue-300">{msg}</p>}

      {/* ECO EXISTEIX A BD */}
      {validatedEco && existsInDB === true && (
        <div className="p-4 bg-surface border border-border rounded">
          <p>L’ECO existeix a la base de dades.</p>
          <p><strong>{ecoName}</strong></p>
          <button className="btn mt-2" onClick={handleAddExisting}>
            Afegir a la curació
          </button>
        </div>
      )}

      {/* ECO NO EXISTEIX — CREAR */}
      {validatedEco && existsInDB === false && (
        <div className="p-4 bg-surface border border-border rounded space-y-3">
          <h3 className="text-lg font-semibold">Crear nova tècnica experimental</h3>

          <p><strong>{ecoName}</strong> ({validatedEco})</p>

          <div>
            <label className="block font-medium">Categoria</label>
            <select
              className="form-control"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
            >
              <option value="">Selecciona categoria...</option>
              {categories.map((c) => (
                <option key={c.category_id} value={c.category_id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-medium">Descripció</label>
            <textarea
              className="form-control"
              value={techDescription}
              onChange={(e) => setTechDescription(e.target.value)}
              placeholder="Descripció breu"
            />
          </div>

          <button className="btn" onClick={handleCreateEco}>
            Desa nova tècnica
          </button>
        </div>
      )}

      {/* LLISTA TÈCNIQUES */}
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
          Confirmar i continuar →
        </button>
      )}
    </div>
  );
}

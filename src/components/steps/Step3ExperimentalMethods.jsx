import { useState, useEffect } from "react";
import { runQuery } from "../../db/queryExecutor"; //Executa SQL a la base de dades
import { useCuration } from "../../context/CurationContext"; //Permet llegir o modificar el que està guardat a CurationContext

export default function Step3ExperimentalMethods() {
  const { techniques, setTechniques, goToNextStep } = useCuration();

  const [ecoInput, setEcoInput] = useState(""); 
  const [validatedEco, setValidatedEco] = useState(null);
  const [ecoName, setEcoName] = useState("");
  const [existsInDB, setExistsInDB] = useState(null);

  //Per a crear un nou ECO (categoría i nova descripció)
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [techDescription, setTechDescription] = useState("");

  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]); //Per a la llista d'autocompletat

  function esc(str) { //Evita error als strings amb les cometes simples
    return String(str || "").replace(/'/g, "''");
  }

  // Carregar technique categories
  useEffect(() => {
    async function fetchCategories() { 
      const rows = await runQuery(`
        SELECT category_id, name
        FROM core_experimentaltechniquecategory
        ORDER BY name ASC
      `);
      setCategories(rows);
    }
    fetchCategories();
  }, []);

  //Autocompletar (nom o ECO code)
  async function handleAutocomplete(val) {
    setEcoInput(val);
    setValidatedEco(null);
    setExistsInDB(null);

    if (!val) {
      setSuggestions([]);
      return;
    }

    const rows = await runQuery(
      `
      SELECT EO_term, name
      FROM core_experimentaltechnique
      WHERE LOWER(name) LIKE LOWER(? || '%')
         OR LOWER(EO_term) LIKE LOWER(? || '%')
      ORDER BY name ASC
      `,
      [val, val]
    );

    setSuggestions(rows);
  }

  //QuickGO validation
  async function validateEcoAPI(code) {
    try {
      const res = await fetch(
        `https://www.ebi.ac.uk/QuickGO/services/ontology/eco/terms/${code}`,
        { headers: { Accept: "application/json" } }
      );
      if (!res.ok) return null;

      const json = await res.json(); //Convertim a json la resposta, on s'indica id, nom, definició...
      return json.results?.length > 0 ? json.results[0] : null;
    } catch {
      return null;
    }
  }

  //Botó Validate ECO
  async function handleValidate() {
    setLoading(true);
    setValidatedEco(null);
    setExistsInDB(null);

    let raw = ecoInput.trim().toUpperCase(); //Completem els ECO a majúscules, amb els dos punts i tot el necessari
    if (!raw.startsWith("ECO:")) raw = "ECO:" + raw;

    try {
      const ecoObj = await validateEcoAPI(raw);
      if (!ecoObj) {
        setValidatedEco(null);
        return;
      }

      setValidatedEco(raw);
      setEcoName(ecoObj.name);

      //Veure si ja existeix a la base de dades
      const rows = await runQuery(
        `SELECT * FROM core_experimentaltechnique WHERE EO_term = ?`,
        [raw]
      );
      setExistsInDB(rows.length > 0);

    } finally {
      setLoading(false);
    }
  }

  //Quan es clica a Add to Curation i el ECO ja exisitia a la base de dades
  function handleAddExisting() {
    setTechniques([...techniques, validatedEco]);
    setValidatedEco(null); //Evita crear 2 cops el mateix codi a la DB
    setEcoInput(""); //El input es buida
  }

  //Creem el nou codi ECO per a fer el deploy al step7
  async function handleCreateEco() {
    const sql = `
      INSERT INTO core_experimentaltechnique (name, description, preset_function, EO_term)
      VALUES ('${esc(ecoName)}', '${esc(techDescription)}', NULL, '${esc(validatedEco)}');

      INSERT INTO core_experimentaltechnique_categories (experimentaltechnique_id, experimentaltechniquecategory_id)
      VALUES (
        (SELECT technique_id FROM core_experimentaltechnique WHERE EO_term='${esc(validatedEco)}'),
        ${Number(selectedCategory)}
      );
    `;

    setTechniques([...techniques, validatedEco]);
    setValidatedEco(null);
    setEcoInput("");
    setSelectedCategory("");
    setTechDescription("");
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Step 3 – Experimental Methods</h2>

      {/* INPUT + Validate button */}
      <div>
        <label className="block font-medium">Enter ECO code or name</label>

        <div className="flex gap-2">
          <input
            className="form-control flex-1"
            placeholder="Example: ECO:0005667 or ChIP-Seq"
            value={ecoInput}
            onChange={(e) => handleAutocomplete(e.target.value)}
          />

          <button className="btn" onClick={handleValidate} disabled={loading}>
            {loading ? "..." : "Validate"}
          </button>
        </div>

        {/* Autocompletar */}
        {suggestions.length > 0 && (
          <div className="border border-border p-2 bg-surface rounded mt-1">
            {suggestions.map((s) => (
              <div
                key={s.EO_term}
                className="p-1 hover:bg-muted cursor-pointer"
                onClick={() => {
                  setEcoInput(s.EO_term);
                  setSuggestions([]);
                }}
              >
                {s.name} ({s.EO_term})
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Existing ECO */}
      {validatedEco && existsInDB === true && (
        <div className="p-4 bg-surface border border-border rounded">
          <p><strong>{ecoName}</strong></p>
          <button className="btn mt-2" onClick={handleAddExisting}>
            Add to curation
          </button>
        </div>
      )}

      {/* Crear nou ECO */}
      {validatedEco && existsInDB === false && (
        <div className="p-4 bg-surface border border-border rounded space-y-3">
          <h3 className="text-lg font-semibold">
            Create new experimental technique
          </h3>

          <p><strong>{ecoName}</strong> ({validatedEco})</p>

          <div>
            <label className="block font-medium">Category</label>
            <select
              className="form-control"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
            >
              <option value="">Select a category...</option>
              {categories.map((c) => (
                <option key={c.category_id} value={c.category_id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-medium">Description</label>
            <textarea
              className="form-control"
              value={techDescription}
              onChange={(e) => setTechDescription(e.target.value)}
            />
          </div>

          <button className="btn" onClick={handleCreateEco}>
            Save new technique
          </button>
        </div>
      )}

      {/* Llista */}
      <div>
        <h3 className="font-semibold mt-4">Added techniques:</h3>
        {techniques.length === 0 && <p>None yet.</p>}
        <ul className="list-disc pl-6">
          {techniques.map((t, i) => (
            <li key={i}>
              {typeof t === "string"
                ? t
                : `${t.eco} — ${t.name}`}
            </li>
          ))}
        </ul>
      </div>

      {techniques.length > 0 && (
        <button className="btn mt-4" onClick={goToNextStep}>
          Confirm and continue →
        </button>
      )}
    </div>
  );
}

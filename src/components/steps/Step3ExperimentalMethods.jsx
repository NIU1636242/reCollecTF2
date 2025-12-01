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

  const [error, setError] = useState(""); //Missatges d'error (duplicats, etc.)

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
    setError("");

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

  //QuickGO validation (ara no s'usa directament, però el deixem per si cal més endavant)
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

  //Quan es clica a Add to Curation i el ECO ja exisitia a la base de dades
  function handleAddExisting() {
    if (!validatedEco) return;

    // Evitem duplicats
    if (techniques.includes(validatedEco)) {
      setError("This ECO code is already added to the curation.");
      return;
    }

    setTechniques([...techniques, validatedEco]);
    setValidatedEco(null); //Evita crear 2 cops el mateix codi a la DB
    setEcoInput(""); //El input es buida
    setError("");
  }

  //Creem el nou codi ECO per a fer el deploy al step7
  async function handleCreateEco() {
    if (!validatedEco) return;

    // Evitem duplicats també aquí
    if (techniques.includes(validatedEco)) {
      setError("This ECO code is already added to the curation.");
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

    // Aquí es on al Step7 faràs servir el SQL per al deploy

    setTechniques([...techniques, validatedEco]);
    setValidatedEco(null);
    setEcoInput("");
    setSelectedCategory("");
    setTechDescription("");
    setError("");
  }

  //Nou botó: obrir formulari de nova tècnica directament
  function handleAddTechnique() {
    setError("");

    if (!ecoInput.trim()) {
      setError("Please enter an ECO code before creating a new technique.");
      return;
    }

    let raw = ecoInput.trim().toUpperCase();
    if (!raw.startsWith("ECO:")) raw = "ECO:" + raw;

    // Evitem crear amb un ECO que ja està afegit
    if (techniques.includes(raw)) {
      setError("This ECO code is already added to the curation.");
      return;
    }

    // Obrim el formulari de nova tècnica
    setValidatedEco(raw);
    setEcoName(""); //El nom es pot omplir manualment (a la descripció)
    setExistsInDB(false);
  }

  //Eliminar una tècnica de la llista (icona de paperera)
  function handleRemoveTechnique(index) {
    const updated = techniques.filter((_, i) => i !== index);
    setTechniques(updated);
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Step 3 – Experimental Methods</h2>

      {/* INPUT + Add technique button */}
      <div>
        <label className="block font-medium">Enter ECO code or name</label>

        <div className="flex gap-2">
          <input
            className="form-control flex-1"
            placeholder="Example: ECO:0005667 or ChIP-Seq"
            value={ecoInput}
            onChange={(e) => handleAutocomplete(e.target.value)}
          />

          {/* Botó nou: obrir formulari de nova tècnica */}
          <button className="btn" onClick={handleAddTechnique} disabled={loading}>
            Add technique
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
                  // Quan es selecciona una opció, mostrem directament el bloc d'ECO existent
                  setEcoInput(s.EO_term);
                  setSuggestions([]);
                  setValidatedEco(s.EO_term);
                  setEcoName(s.name);
                  setExistsInDB(true);
                  setError("");
                }}
              >
                {s.name} ({s.EO_term})
              </div>
            ))}
          </div>
        )}

        {/* Missatge d'error general (duplicats, etc.) */}
        {error && (
          <p className="text-red-400 text-sm mt-2">
            {error}
          </p>
        )}
      </div>

      {/* Existing ECO */}
      {validatedEco && existsInDB === true && (
        <div className="p-4 bg-surface border border-border rounded">
          <p><strong>{ecoName}</strong> ({validatedEco})</p>
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

          <p>
            <strong>{ecoName || "New ECO technique"}</strong>
            {" "}
            ({validatedEco})
          </p>

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
            <li key={i} className="flex items-center gap-2">
              {typeof t === "string"
                ? t
                : `${t.eco} — ${t.name}`}

              {/* Icona de paperera per eliminar */}
              <button
                type="button"
                className="text-red-400 hover:text-red-600 text-sm"
                onClick={() => handleRemoveTechnique(i)}
              >
                🗑️
              </button>
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

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

  const [loading] = useState(false);
  const [suggestions, setSuggestions] = useState([]); //Per a la llista d'autocompletat

  const [error, setError] = useState(""); //Missatges d'error (duplicats, etc.)
  const [showCreateForm, setShowCreateForm] = useState(false); //NOU: per obrir el formulari manual

  //Nuevo: ECO para nueva técnica (input independiente)
  const [newEcoCode, setNewEcoCode] = useState("");

  function esc(str) {
    //Evita error als strings amb les cometes simples
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
    setShowCreateForm(false);
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

  //Quan es selecciona un ECO existent (autocomplete)
  function selectExisting(ecoCode, name) {
    setEcoInput(ecoCode);
    setValidatedEco(ecoCode);
    setEcoName(name);
    setExistsInDB(true);
    setShowCreateForm(false);
    setSuggestions([]);
    setError("");
  }

  //Quan es clica a Add to Curation i el ECO ja exisitia a la base de dades
  function handleAddExisting() {
    if (!validatedEco) return;

    if (techniques.includes(validatedEco)) {
      setError("This ECO code is already added to the curation.");
      return;
    }

    setTechniques([...techniques, validatedEco]);
    setValidatedEco(null);
    setEcoInput("");
    setError("");
  }

  //NOU BOTÓ → Obrir formulari manual
  function handleAddTechnique() {
    setError("");
    setShowCreateForm(true);

    //reseteamos por si había datos previos
    setValidatedEco(null);
    setExistsInDB(false);
    setTechDescription("");
    setSelectedCategory("");
    setNewEcoCode(""); //nuevo campo ECO manual
  }

  //Crear la nova tècnica manualment
  async function handleCreateEco() {
    if (!newEcoCode.trim()) {
      setError("Please enter an ECO code.");
      return;
    }

    let raw = newEcoCode.trim().toUpperCase();
    if (!raw.startsWith("ECO:")) raw = "ECO:" + raw;

    //Evitar duplicats
    if (techniques.includes(raw)) {
      setError("This ECO code is already added to the curation.");
      return;
    }

    //PREP per deploy al Step7
    const sql = `
      INSERT INTO core_experimentaltechnique (name, description, preset_function, EO_term)
      VALUES (NULL, '${esc(techDescription)}', NULL, '${esc(raw)}');

      INSERT INTO core_experimentaltechnique_categories (experimentaltechnique_id, experimentaltechniquecategory_id)
      VALUES (
        (SELECT technique_id FROM core_experimentaltechnique WHERE EO_term='${esc(raw)}'),
        ${Number(selectedCategory)}
      );
    `;

    //Afegim a la llista
    setTechniques([...techniques, raw]);

    //reset form
    setShowCreateForm(false);
    setNewEcoCode("");
    setTechDescription("");
    setSelectedCategory("");
    setError("");
  }

  //Eliminar una tècnica de la llista
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

          <button className="btn" onClick={handleAddTechnique}>
            + Add technique
          </button>
        </div>

        {/* Autocompletar */}
        {suggestions.length > 0 && (
          <div className="border border-border p-2 bg-surface rounded mt-1">
            {suggestions.map((s) => (
              <div
                key={s.EO_term}
                className="p-1 hover:bg-muted cursor-pointer"
                onClick={() => selectExisting(s.EO_term, s.name)}
              >
                {s.name} ({s.EO_term})
              </div>
            ))}
          </div>
        )}

        {/* Error message */}
        {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
      </div>

      {/* Existing ECO */}
      {validatedEco && existsInDB === true && (
        <div className="p-4 bg-surface border border-border rounded">
          <p>
            <strong>{ecoName}</strong> ({validatedEco})
          </p>
          <button className="btn mt-2" onClick={handleAddExisting}>
            Add to curation
          </button>
        </div>
      )}

      {/* Formulari MANUAL */}
      {showCreateForm && (
        <div className="p-4 bg-surface border border-border rounded space-y-3">
          <h3 className="text-lg font-semibold">
            Create new experimental technique
          </h3>

          {/* ECO code manual */}
          <div>
            <label className="block font-medium">ECO code</label>
            <input
              className="form-control"
              placeholder="ECO:XXXXXXX"
              value={newEcoCode}
              onChange={(e) => setNewEcoCode(e.target.value)}
            />
          </div>

          {/* Category */}
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

          {/* Description */}
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
          <li key={i} className="list-item">
            <div className="flex items-center gap-2">
            {typeof t === "string" ? t : `${t.eco} — ${t.name}`}

            {/* Icona de paperera */}
            <button
              type="button"
              onClick={() => handleRemoveTechnique(i)}
              className="text-red-400 hover:text-red-300"
            >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.8}
              stroke="currentColor"
              className="w-5 h-5"
             >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 7h12M9 7V4h6v3m-8 4h10l-1 9H8l-1-9z"
            />
            </svg>
            </button>
            </div>
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

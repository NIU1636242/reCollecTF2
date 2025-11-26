import { useState, useEffect } from "react";
import { runQuery } from "../../db/queryExecutor";
import { dispatchWorkflow } from "../../utils/serverless";
import { useCuration } from "../../context/CurationContext";

export default function Step3ExperimentalMethods() {
  const { techniques, setTechniques, goToNextStep } = useCuration();

  const [ecoInput, setEcoInput] = useState("");
  const [validatedEco, setValidatedEco] = useState(null);
  const [ecoName, setEcoName] = useState("");
  const [existsInDB, setExistsInDB] = useState(null);

  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [techDescription, setTechDescription] = useState("");

  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const [suggestions, setSuggestions] = useState([]);   // NEW: autocomplete list

  /** Escape SQL */
  function esc(str) {
    return String(str || "").replace(/'/g, "''");
  }

  /** Restore previous Step3 state */
  useEffect(() => {
    if (!techniques || techniques.length === 0) return;
    // Nothing specific to restore except techniques list.
    // State stays in context.
  }, []);

  /** Load categories */
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

  /** Autocomplete by name or ECO */
  async function handleAutocomplete(val) {
    setEcoInput(val);
    setSuggestions([]);

    if (!val) return;

    const rows = await runQuery(`
      SELECT EO_term, name
      FROM core_experimentaltechnique
      WHERE LOWER(name) LIKE LOWER(? || '%')
         OR LOWER(EO_term) LIKE LOWER(? || '%')
      ORDER BY name ASC
    `, [val, val]);

    setSuggestions(rows);
  }

  /** Validate ECO or Name */
  async function validateEcoAPI(code) {
    try {
      const res = await fetch(
        `https://www.ebi.ac.uk/QuickGO/services/ontology/eco/terms/${code}`,
        { headers: { Accept: "application/json" } }
      );

      if (!res.ok) return null;

      const json = await res.json();
      if (json.results?.length > 0) return json.results[0];

      return null;
    } catch {
      return null;
    }
  }

  /** Validate button */
  async function handleValidate() {
    setMsg("");
    setExistsInDB(null);
    setValidatedEco(null);

    let raw = ecoInput.trim().toUpperCase();

    if (!raw.startsWith("ECO:")) raw = "ECO:" + raw;

    setLoading(true);
    try {
      const ecoObj = await validateEcoAPI(raw);
      if (!ecoObj) {
        setMsg("This ECO does not exist in QuickGO.");
        return;
      }

      setValidatedEco(raw);
      setEcoName(ecoObj.name);
      setMsg("ECO successfully validated.");

      const rows = await runQuery(
        `SELECT * FROM core_experimentaltechnique WHERE EO_term = ?`,
        [raw]
      );
      setExistsInDB(rows.length > 0);

    } catch (err) {
      setMsg("Error validating ECO.");
    } finally {
      setLoading(false);
    }
  }

  /** Add existing ECO */
  function handleAddExisting() {
    const newList = [...techniques, validatedEco];
    setTechniques(newList);

    setMsg("ECO added to curation.");
    setValidatedEco(null);
    setEcoInput("");
  }

  /** Create new ECO */
  async function handleCreateEco() {
    if (!selectedCategory) {
      setMsg("Please select a category.");
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
      await dispatchWorkflow({
        inputs: { queries: sql }
      });

      setMsg("ECO created. Will be written to DB at Step 7 deploy.");
      setTechniques([...techniques, validatedEco]);

      setValidatedEco(null);
      setEcoInput("");
      setSelectedCategory("");
      setTechDescription("");

    } catch {
      setMsg("Error sending queries.");
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Step 3 – Experimental Methods</h2>

      {/* INPUT with autocomplete */}
      <div>
        <label className="block font-medium">Enter ECO code or name</label>
        <input
          className="form-control"
          placeholder="Example: 0005667 or Chromatin binding"
          value={ecoInput}
          onChange={(e) => handleAutocomplete(e.target.value)}
        />

        {/* AUTOCOMPLETE DROPDOWN */}
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

        <button className="btn mt-2" onClick={handleValidate} disabled={loading}>
          {loading ? "Validating..." : "Validate"}
        </button>
      </div>

      {msg && <p className="text-blue-300">{msg}</p>}

      {/* EXISTS IN DB */}
      {validatedEco && existsInDB === true && (
        <div className="p-4 bg-surface border border-border rounded">
          <p>This ECO already exists in the database.</p>
          <p><strong>{ecoName}</strong></p>
          <button className="btn mt-2" onClick={handleAddExisting}>
            Add to curation
          </button>
        </div>
      )}

      {/* CREATE NEW */}
      {validatedEco && existsInDB === false && (
        <div className="p-4 bg-surface border border-border rounded space-y-3">
          <h3 className="text-lg font-semibold">Create new experimental technique</h3>

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

      <div>
        <h3 className="font-semibold mt-4">Added techniques:</h3>
        {techniques.length === 0 && <p>None yet.</p>}
        <ul className="list-disc pl-6">
          {techniques.map((t, i) => (
            <li key={i}>{t}</li>
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

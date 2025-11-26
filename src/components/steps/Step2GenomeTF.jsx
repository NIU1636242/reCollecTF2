import { useState, useEffect } from "react";
import { runQuery } from "../../db/queryExecutor";
import { useCuration } from "../../context/CurationContext";

export default function Step2GenomeTF() {
  const { tf, setTf, goToNextStep } = useCuration();

  // STATES
  const [searchName, setSearchName] = useState("");        // TF search input
  const [suggestions, setSuggestions] = useState([]);      // autocomplete

  const [tfRow, setTfRow] = useState(null);                // existing TF
  const [showCreateForm, setShowCreateForm] = useState(false);

  const [newTFName, setNewTFName] = useState("");          // TF creation field
  const [tfDesc, setTfDesc] = useState("");                // TF desc

  const [families, setFamilies] = useState([]);            // family list
  const [selectedFamily, setSelectedFamily] = useState("");
  const [newFamilyName, setNewFamilyName] = useState("");
  const [newFamilyDesc, setNewFamilyDesc] = useState("");

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // escape SQL
  function esc(str) {
    return String(str || "").replace(/'/g, "''");
  }

  // Restore TF when coming back to Step 2
  useEffect(() => {
    if (!tf) return;

    // Caso 1 → TF existente en la BBDD (tiene ID)
    if (tf.TF_id) {
      setTfRow(tf);                 
      setSearchName(tf.name || ""); // Rellenamos el input de búsqueda
      setShowCreateForm(false);     // No mostrar el formulario de creación
      setNewTfCreated(false);       // No mostrar el confirm button de creación
    return;
    }

    // Caso 2 → TF creado manualmente (no tiene ID)
    setTfRow(null);                  // No mostrar TF, porque no existe en BD
    setShowCreateForm(true);         // Mostrar el formulario de creación
    setNewTFName(tf.name || "");     
    setSelectedFamily(tf.family_id || ""); 
    setTfDesc(tf.description || ""); 
    setNewTfCreated(true);           // Mostrar botón "Confirm and continue"
  }, [tf]);

  // LOAD FAMILY LIST
  useEffect(() => {
    async function loadFamilies() {
      const rows = await runQuery(`
        SELECT tf_family_id, name, description
        FROM core_tffamily
        ORDER BY name ASC;
      `);
      setFamilies(rows);
    }
    loadFamilies();
  }, []);

  // AUTOCOMPLETE ON SEARCH INPUT
  async function handleAutocomplete(value) {
    setSearchName(value);
    setTfRow(null);
    setShowCreateForm(false);

    if (!value || value.length < 1) {
      setSuggestions([]);
      return;
    }

    const rows = await runQuery(
      `
      SELECT tf.TF_id, tf.name, fam.name AS family_name
      FROM core_tf tf
      LEFT JOIN core_tffamily fam ON fam.tf_family_id = tf.family_id
      WHERE LOWER(tf.name) LIKE LOWER(? || '%')
      ORDER BY tf.name ASC;
      `,
      [value]
    );

    setSuggestions(rows);
  }

  // SEARCH BUTTON → EXACT MATCH
  async function handleSearchTF() {
    setMessage("");
    setTfRow(null);
    setShowCreateForm(false);
    setSuggestions([]);

    const name = searchName.trim();
    if (!name) return;

    setLoading(true);
    try {
      const rows = await runQuery(
        `
        SELECT tf.*, 
               fam.name AS family_name,
               fam.description AS family_description
        FROM core_tf tf
        LEFT JOIN core_tffamily fam ON fam.tf_family_id = tf.family_id
        WHERE LOWER(tf.name) = LOWER(?)
        LIMIT 1;
        `,
        [name]
      );

      if (rows.length) {
        setTfRow(rows[0]);
        setMessage("TF found in the database.");
      } else {
        setMessage("TF not found. You can create it.");
        setShowCreateForm(true);
        setNewTFName(searchName);
      }
    } catch (err) {
      console.error(err);
      setMessage("Database error.");
    } finally {
      setLoading(false);
    }
  }

  // CREATE NEW TF (DEPLOY DISABLED)
  async function handleCreateTF() {
    setMessage("");

    if (!newTFName.trim()) {
      setMessage("Please enter a name for the TF.");
      return;
    }

    const queries = [];

    // NEW FAMILY
    if (selectedFamily === "new") {
      if (!newFamilyName.trim()) {
        setMessage("Please provide a name for the new family.");
        return;
      }

      queries.push(`
        INSERT INTO core_tffamily (name, description)
        VALUES ('${esc(newFamilyName)}', '${esc(newFamilyDesc)}');
      `);

      queries.push(`
        INSERT INTO core_tf (name, family_id, description)
        VALUES (
          '${esc(newTFName)}',
          (SELECT tf_family_id FROM core_tffamily WHERE name='${esc(newFamilyName)}'),
          '${esc(tfDesc)}'
        );
      `);

    } else {
      const famId = Number(selectedFamily);
      if (!famId) {
        setMessage("Please select a valid family.");
        return;
      }

      queries.push(`
        INSERT INTO core_tf (name, family_id, description)
        VALUES ('${esc(newTFName)}', ${famId}, '${esc(tfDesc)}');
      `);
    }

    const sqlFinal = queries.join("\n");

    // Deploy is disabled until Step 7 — keep workflow commented for later use:

    // await dispatchWorkflow({inputs: { queries: sqlFinal }});

    // Register TF locally to go to next step
    const famName =
      selectedFamily === "new"
        ? newFamilyName
        : families.find((f) => f.tf_family_id == selectedFamily)?.name;

    setTf({
      name: newTFName,
      family: famName,
      description: tfDesc,
    });

    goToNextStep();
  }

  // RENDER
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Step 2 – Genome & TF</h2>

      {/* TF SEARCH FIELD */}
      <div className="space-y-2">
        <label className="block font-medium">TF Name</label>

        <div className="flex gap-2">
          <input
            className="form-control flex-1"
            value={searchName}
            placeholder="Example: LexA"
            onChange={(e) => handleAutocomplete(e.target.value)}
          />

          <button className="btn" onClick={handleSearchTF} disabled={loading}>
            {loading ? "Searching..." : "Search"}
          </button>

          <button
            className="btn"
            onClick={() => {
              setShowCreateForm(true);
              setTfRow(null);
              setSuggestions([]);
              setNewTFName(searchName);
            }}
          >
            + Add TF
          </button>
        </div>

        {/* AUTOCOMPLETE DROPDOWN */}
        {suggestions.length > 0 && (
          <div className="border border-border rounded bg-surface p-2">
            {suggestions.map((s) => (
              <div
                key={s.TF_id}
                className="p-1 hover:bg-muted cursor-pointer"
                onClick={() => {
                  setSearchName(s.name);
                  setSuggestions([]);

                  // Espera a que React actualice el estado antes de buscar
                  setTimeout(() => {
                  handleSearchTF();
                  }, 0);
                }}
              >
                {s.name} ({s.family_name})
              </div>
            ))}
          </div>
        )}
      </div>

      {message && <p className="text-blue-300">{message}</p>}

      {/*EXISTING TF DISPLAY*/}
      {tfRow && (
        <div className="bg-surface border border-border rounded p-4 space-y-2">
          <h3 className="text-lg font-semibold text-accent">{tfRow.name}</h3>

          <p><strong>ID:</strong> {tfRow.TF_id}</p>
          <p><strong>Family:</strong> {tfRow.family_name}</p>

          <p><strong>TF Description:</strong> {tfRow.description || "—"}</p>
          <p><strong>Family Description:</strong> {tfRow.family_description || "—"}</p>

          <button
            className="btn mt-4"
            onClick={() => {
              setTf(tfRow);
              goToNextStep();
            }}
          >
            Confirm and continue →
          </button>
        </div>
      )}

      {/*CREATE NEW TF FORM*/}
      {showCreateForm && (
        <div className="bg-surface border border-border rounded p-4 space-y-3">
          <h3 className="text-lg font-semibold text-accent">Create New TF</h3>

          <div>
            <label className="block font-medium">TF Name</label>
            <input
              className="form-control"
              value={newTFName}
              onChange={(e) => setNewTFName(e.target.value)}
            />
          </div>

          <div>
            <label className="block font-medium">Existing Family</label>
            <select
              className="form-control"
              value={selectedFamily}
              onChange={(e) => setSelectedFamily(e.target.value)}
            >
              <option value="">Select a family...</option>
              <option value="new">+ New Family</option>

              {families.map((f) => (
                <option key={f.tf_family_id} value={f.tf_family_id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>

          {/* NEW FAMILY FIELDS */}
          {selectedFamily === "new" && (
            <>
              <div>
                <label className="block font-medium">New Family Name</label>
                <input
                  className="form-control"
                  value={newFamilyName}
                  onChange={(e) => setNewFamilyName(e.target.value)}
                />
              </div>

              <div>
                <label className="block font-medium">Family Description</label>
                <textarea
                  className="form-control"
                  value={newFamilyDesc}
                  onChange={(e) => setNewFamilyDesc(e.target.value)}
                />
              </div>
            </>
          )}

          <div>
            <label className="block font-medium">TF Description</label>
            <textarea
              className="form-control"
              value={tfDesc}
              onChange={(e) => setTfDesc(e.target.value)}
            />
          </div>

          <button className="btn" onClick={handleCreateTF}>
            Confirm and continue →
          </button>
        </div>
      )}
    </div>
  );
}

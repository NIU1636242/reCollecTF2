import { useState, useEffect } from "react";
import { runQuery } from "../../db/queryExecutor";
import { dispatchWorkflow } from "../../utils/serverless";
import { useCuration } from "../../context/CurationContext";

export default function Step2GenomeTF() {
  const { setTf, goToNextStep } = useCuration();

  const [tfName, setTfName] = useState("");
  const [tfRow, setTfRow] = useState(null);

  const [families, setFamilies] = useState([]);
  const [selectedFamily, setSelectedFamily] = useState("");
  const [newFamilyName, setNewFamilyName] = useState("");
  const [newFamilyDesc, setNewFamilyDesc] = useState("");
  const [tfDesc, setTfDesc] = useState("");

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [showCreateForm, setShowCreateForm] = useState(false);

  // For autocomplete
  const [suggestions, setSuggestions] = useState([]);

  // Load families
  useEffect(() => {
    async function load() {
      const rows = await runQuery(`
        SELECT tf_family_id, name, description
        FROM core_tffamily
        ORDER BY name ASC
      `);
      setFamilies(rows);
    }
    load();
  }, []);

  // Escape helper
  function esc(str) {
    return String(str || "").replace(/'/g, "''");
  }

  // AUTOCOMPLETE TF SEARCH
  async function handleAutocomplete(name) {
    setTfName(name);

    if (name.length < 1) {
      setSuggestions([]);
      return;
    }

    const rows = await runQuery(
      `
      SELECT tf.TF_id, tf.name, fam.name AS family_name
      FROM core_tf tf
      LEFT JOIN core_tffamily fam ON fam.tf_family_id = tf.family_id
      WHERE LOWER(tf.name) LIKE LOWER(? || '%')
      ORDER BY tf.name ASC
      `,
      [name]
    );

    setSuggestions(rows);
  }

  // SEARCH TF (exact match)
  async function handleSearchTF() {
    setMessage("");
    setTfRow(null);

    const name = tfName.trim();
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
        LIMIT 1
        `,
        [name]
      );

      if (rows.length) {
        setTfRow(rows[0]);
        setShowCreateForm(false);
        setMessage("TF found in the database.");
      } else {
        setTfRow(null);
        setShowCreateForm(true);
        setMessage("TF not found. You can create it.");
      }
    } catch (err) {
      console.error(err);
      setMessage("Database error.");
    } finally {
      setLoading(false);
    }
  }

  // CREATE NEW TF
  async function handleCreateTF() {
    setMessage("");

    if (!tfName.trim()) {
      setMessage("Please enter a TF name.");
      return;
    }

    const queries = [];

    // Create new family if needed
    if (selectedFamily === "new") {
      if (!newFamilyName.trim()) {
        setMessage("Please enter a name for the new family.");
        return;
      }

      queries.push(`
        INSERT INTO core_tffamily (name, description)
        VALUES ('${esc(newFamilyName)}', '${esc(newFamilyDesc)}');
      `);

      queries.push(`
        INSERT INTO core_tf (name, family_id, description)
        VALUES (
          '${esc(tfName)}',
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
        VALUES ('${esc(tfName)}', ${famId}, '${esc(tfDesc)}');
      `);
    }

    const sqlFinal = queries.join("\n");

    try {
      await dispatchWorkflow({ inputs: { queries: sqlFinal } });

      setMessage("Request sent. The database will update after redeploy.");

      // Store TF in context
      const famName =
        selectedFamily === "new"
          ? newFamilyName
          : families.find((f) => f.tf_family_id == selectedFamily)?.name;

      setTf({
        name: tfName,
        family: famName,
        description: tfDesc,
      });

      goToNextStep();
    } catch (err) {
      console.error(err);
      setMessage("Error sending queries.");
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Step 2 – Genome & TF</h2>

      {/* TF INPUT + AUTOCOMPLETE */}
      <div className="space-y-2">
        <label className="block font-medium">TF Name</label>

        <input
          className="form-control"
          value={tfName}
          placeholder="Example: LexA"
          onChange={(e) => handleAutocomplete(e.target.value)}
        />

        {/* AUTOCOMPLETE DROPDOWN */}
        {suggestions.length > 0 && (
          <div className="border border-border rounded bg-surface p-2">
            {suggestions.map((s) => (
              <div
                key={s.TF_id}
                className="p-1 hover:bg-muted cursor-pointer"
                onClick={() => {
                  setTfName(s.name);
                  setSuggestions([]);
                  handleSearchTF();
                }}
              >
                {s.name} ({s.family_name})
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <button className="btn" onClick={handleSearchTF} disabled={loading}>
            {loading ? "Searching..." : "Search"}
          </button>

          <button
            className="btn"
            onClick={() => {
              setShowCreateForm(true);
              setTfRow(null);
            }}
          >
            + Add TF
          </button>
        </div>
      </div>

      {message && <p className="text-blue-300">{message}</p>}

      {/*EXISTING TF FOUND*/}
      {tfRow && (
        <div className="bg-surface border border-border rounded p-4 space-y-2">
          <h3 className="text-lg font-semibold text-accent">{tfRow.name}</h3>

          <p><strong>ID:</strong> {tfRow.TF_id}</p>
          <p><strong>Family:</strong> {tfRow.family_name}</p>

          {/* Show both descriptions */}
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

      {/*CREATE NEW TF*/}
      {showCreateForm && (
        <div className="bg-surface border border-border rounded p-4 space-y-3">
          <h3 className="text-lg font-semibold text-accent">Create New TF</h3>

          <div>
            <label className="block font-medium">TF Name</label>
            <input
              className="form-control"
              value={tfName}
              onChange={(e) => setTfName(e.target.value)}
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
            Create TF
          </button>
        </div>
      )}
    </div>
  );
}

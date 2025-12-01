import { useState, useEffect } from "react";
import { runQuery } from "../../db/queryExecutor";
import { useCuration } from "../../context/CurationContext";

// Proxy i bases per a les APIs externes
const PROXY = "https://corsproxy.io/?";
const ENTREZ_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const UNIPROT_BASE = "https://rest.uniprot.org/uniprotkb";

export default function Step2GenomeTF() {
  const { tf, setTf, goToNextStep } = useCuration();

  // ---------------- TF NAME (el que ja tenies) ----------------
  const [searchName, setSearchName] = useState(""); // TF search input
  const [suggestions, setSuggestions] = useState([]); // autocomplete

  const [tfRow, setTfRow] = useState(null); // existing TF
  const [showCreateForm, setShowCreateForm] = useState(false);

  const [newTFName, setNewTFName] = useState(""); // TF creation field
  const [tfDesc, setTfDesc] = useState(""); // TF desc

  const [families, setFamilies] = useState([]); // family list
  const [selectedFamily, setSelectedFamily] = useState("");
  const [newFamilyName, setNewFamilyName] = useState("");
  const [newFamilyDesc, setNewFamilyDesc] = useState("");

  const [loadingTF, setLoadingTF] = useState(false);
  const [message, setMessage] = useState("");

  // ---------------- GENOME ACCESSIONS ----------------
  const [genomeInput, setGenomeInput] = useState("");
  const [genomeSuggestions, setGenomeSuggestions] = useState([]);
  const [genomeItems, setGenomeItems] = useState([]); // [{accession, description, organism, fromDb}]

  // ---------------- UNIPROT ACCESSIONS ----------------
  const [uniprotInput, setUniprotInput] = useState("");
  const [uniprotSuggestions, setUniprotSuggestions] = useState([]);
  const [uniProtItems, setUniProtItems] = useState([]); // [{accession, description, fromDb}]

  // ---------------- REFSEQ (NCBI PROTEIN) ACCESSIONS ----------------
  const [refseqInput, setRefseqInput] = useState("");
  const [refseqSuggestions, setRefseqSuggestions] = useState([]);
  const [refseqItems, setRefseqItems] = useState([]); // [{accession, description, fromDb}]

  // escape SQL
  function esc(str) {
    return String(str || "").replace(/'/g, "''");
  }

  // ---------------- RESTAURAR TF DEL CONTEXT ----------------
  useEffect(() => {
    if (!tf) return;

    // Caso 1 → TF existent a la BBDD (té ID)
    if (tf.TF_id) {
      setTfRow(tf);
      setSearchName(tf.name || "");
      setShowCreateForm(false);
      return;
    }

    // Caso 2 → TF creat manualment (no té ID)
    setTfRow(null);
    setShowCreateForm(true);
    setNewTFName(tf.name || "");
    setSelectedFamily(tf.family_id || "");
    setTfDesc(tf.description || "");
  }, [tf]);

  // ---------------- CARREGAR FAMÍLIES ----------------
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

  // ====================================================
  // TF NAME: AUTOCOMPLETE + SEARCH + CREATE
  // ====================================================

  // AUTOCOMPLETE ON SEARCH INPUT
  async function handleAutocompleteTF(value) {
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
  async function handleSearchTF(nameOverride) {
    setMessage("");
    setTfRow(null);
    setShowCreateForm(false);
    setSuggestions([]);

    const name = (nameOverride ?? searchName).trim();
    if (!name) return;

    setLoadingTF(true);
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
        setNewTFName(name);
      }
    } catch (err) {
      console.error(err);
      setMessage("Database error.");
    } finally {
      setLoadingTF(false);
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

  // ====================================================
  // GENOME: AUTOCOMPLETE + VALIDACIÓ ENTRES
  // ====================================================

  async function handleAutocompleteGenome(val) {
    setGenomeInput(val);

    if (!val || val.length < 1) {
      setGenomeSuggestions([]);
      return;
    }

    const rows = await runQuery(
      `
      SELECT genome_id, genome_accession, organism
      FROM core_genome
      WHERE genome_accession LIKE ? || '%'
      ORDER BY genome_accession ASC;
    `,
      [val]
    );

    setGenomeSuggestions(rows);
  }

  async function fetchNuccoreSummary(accession) {
    // 1) Buscar UID a NCBI per accession
    const esearchUrl = `${ENTREZ_BASE}/esearch.fcgi?db=nuccore&retmode=json&term=${encodeURIComponent(
      accession
    )}[accn]`;
    const r1 = await fetch(PROXY + encodeURIComponent(esearchUrl));
    const j1 = await r1.json();
    const uid = j1.esearchresult?.idlist?.[0];
    if (!uid) return null;

    // 2) ESummary per obtenir descripció
    const esumUrl = `${ENTREZ_BASE}/esummary.fcgi?db=nuccore&id=${uid}&retmode=json`;
    const r2 = await fetch(PROXY + encodeURIComponent(esumUrl));
    const j2 = await r2.json();
    const rec = j2.result?.[uid];
    if (!rec) return null;

    return {
      title: rec.title,
      organism: rec.organism,
    };
  }

  async function handleAddGenome() {
    const acc = genomeInput.trim();
    if (!acc) return;

    // Evitar duplicats a la llista
    if (genomeItems.some((g) => g.accession === acc)) {
      setGenomeInput("");
      return;
    }

    // Mirem si ja existeix a la BD
    const rows = await runQuery(
      `
      SELECT genome_id, genome_accession, organism
      FROM core_genome
      WHERE genome_accession = ?
      LIMIT 1;
    `,
      [acc]
    );

    if (rows.length) {
      const g = rows[0];
      setGenomeItems([
        ...genomeItems,
        {
          accession: g.genome_accession,
          description: g.organism,
          organism: g.organism,
          fromDb: true,
        },
      ]);
      setGenomeInput("");
      setGenomeSuggestions([]);
      return;
    }

    // Si no existeix a BD → validar amb Entrez
    try {
      const info = await fetchNuccoreSummary(acc);
      if (!info) {
        // no afegim res si no es pot validar
        return;
      }

      setGenomeItems([
        ...genomeItems,
        {
          accession: acc,
          description: info.title,
          organism: info.organism,
          fromDb: false,
        },
      ]);

      setGenomeInput("");
      setGenomeSuggestions([]);
    } catch (err) {
      console.error(err);
    }
  }

  // ====================================================
  // UNIPROT: AUTOCOMPLETE + VALIDACIÓ UNIPROT
  // ====================================================

  async function handleAutocompleteUniprot(val) {
    setUniprotInput(val);

    if (!val || val.length < 1) {
      setUniprotSuggestions([]);
      return;
    }

    const rows = await runQuery(
      `
      SELECT TF_instance_id, uniprot_accession, refseq_accession, description
      FROM core_tfinstance
      WHERE uniprot_accession LIKE ? || '%'
      ORDER BY uniprot_accession ASC;
    `,
      [val]
    );

    setUniprotSuggestions(rows);
  }

  async function fetchUniprotSummary(acc) {
    try {
      const url = `${UNIPROT_BASE}/${encodeURIComponent(acc)}.json`;
      const res = await fetch(PROXY + encodeURIComponent(url));
      if (!res.ok) return null;
      const json = await res.json();

      const recName =
        json.proteinDescription?.recommendedName?.fullName?.value ||
        json.proteinDescription?.submissionNames?.[0]?.fullName?.value ||
        "";
      const organism = json.organism?.scientificName || "";

      return {
        title: recName || json.id || acc,
        organism,
      };
    } catch {
      return null;
    }
  }

  async function handleAddUniprot() {
    const acc = uniprotInput.trim();
    if (!acc) return;

    if (uniProtItems.some((u) => u.accession === acc)) {
      setUniprotInput("");
      return;
    }

    // 1) Mirem si ja existeix a TF_instance
    const rows = await runQuery(
      `
      SELECT TF_instance_id, uniprot_accession, refseq_accession, description
      FROM core_tfinstance
      WHERE uniprot_accession = ?
      LIMIT 1;
    `,
      [acc]
    );

    if (rows.length) {
      const row = rows[0];

      setUniProtItems([
        ...uniProtItems,
        {
          accession: row.uniprot_accession,
          description: row.description || "",
          fromDb: true,
        },
      ]);

      // Si hi ha RefSeq associat, l'afegim automàticament
      if (row.refseq_accession) {
        if (
          !refseqItems.some((r) => r.accession === row.refseq_accession)
        ) {
          setRefseqItems([
            ...refseqItems,
            {
              accession: row.refseq_accession,
              description: row.description || "",
              fromDb: true,
            },
          ]);
        }
        if (!refseqInput) {
          setRefseqInput(row.refseq_accession);
        }
      }

      setUniprotInput("");
      setUniprotSuggestions([]);
      return;
    }

    // 2) Si no és a BD → consultar UniProt
    const info = await fetchUniprotSummary(acc);
    if (!info) return;

    setUniProtItems([
      ...uniProtItems,
      {
        accession: acc,
        description: info.title,
        fromDb: false,
      },
    ]);

    setUniprotInput("");
    setUniprotSuggestions([]);
  }

  // ====================================================
  // REFSEQ PROTEIN: AUTOCOMPLETE + VALIDACIÓ ENTRES
  // ====================================================

  async function handleAutocompleteRefseq(val) {
    setRefseqInput(val);

    if (!val || val.length < 1) {
      setRefseqSuggestions([]);
      return;
    }

    const rows = await runQuery(
      `
      SELECT TF_instance_id, refseq_accession, description
      FROM core_tfinstance
      WHERE refseq_accession LIKE ? || '%'
      ORDER BY refseq_accession ASC;
    `,
      [val]
    );

    setRefseqSuggestions(rows);
  }

  async function fetchProteinSummary(accession) {
    // 1) UID per accession
    const esearchUrl = `${ENTREZ_BASE}/esearch.fcgi?db=protein&retmode=json&term=${encodeURIComponent(
      accession
    )}[accn]`;
    const r1 = await fetch(PROXY + encodeURIComponent(esearchUrl));
    const j1 = await r1.json();
    const uid = j1.esearchresult?.idlist?.[0];
    if (!uid) return null;

    // 2) ESummary
    const esumUrl = `${ENTREZ_BASE}/esummary.fcgi?db=protein&id=${uid}&retmode=json`;
    const r2 = await fetch(PROXY + encodeURIComponent(esumUrl));
    const j2 = await r2.json();
    const rec = j2.result?.[uid];
    if (!rec) return null;

    return {
      title: rec.title,
    };
  }

  async function handleAddRefseq() {
    const acc = refseqInput.trim();
    if (!acc) return;

    if (refseqItems.some((r) => r.accession === acc)) {
      setRefseqInput("");
      return;
    }

    // 1) Mirem si existeix a BD
    const rows = await runQuery(
      `
      SELECT TF_instance_id, refseq_accession, description
      FROM core_tfinstance
      WHERE refseq_accession = ?
      LIMIT 1;
    `,
      [acc]
    );

    if (rows.length) {
      const row = rows[0];
      setRefseqItems([
        ...refseqItems,
        {
          accession: row.refseq_accession,
          description: row.description || "",
          fromDb: true,
        },
      ]);
      setRefseqInput("");
      setRefseqSuggestions([]);
      return;
    }

    // 2) Si no és a BD → Entrez
    const info = await fetchProteinSummary(acc);
    if (!info) return;

    setRefseqItems([
      ...refseqItems,
      {
        accession: acc,
        description: info.title,
        fromDb: false,
      },
    ]);

    setRefseqInput("");
    setRefseqSuggestions([]);
  }

  // ====================================================
  // RENDER
  // ====================================================

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
            onChange={(e) => handleAutocompleteTF(e.target.value)}
          />

          <button className="btn" onClick={handleSearchTF} disabled={loadingTF}>
            {loadingTF ? "Searching..." : "Search"}
          </button>
        </div>

        <button
          className="btn mt-2"
          onClick={() => {
            setShowCreateForm(true);
            setTfRow(null);
            setSuggestions([]);
            setNewTFName(searchName);
          }}
        >
          + Add TF
        </button>

        {/* AUTOCOMPLETE DROPDOWN */}
        {suggestions.length > 0 && (
          <div className="border border-border rounded bg-surface p-2 mt-1">
            {suggestions.map((s) => (
              <div
                key={s.TF_id}
                className="p-1 hover:bg-muted cursor-pointer"
                onClick={() => {
                  const name = s.name;
                  setSearchName(name);
                  setSuggestions([]);
                  handleSearchTF(name);
                }}
              >
                {s.name} ({s.family_name})
              </div>
            ))}
          </div>
        )}
      </div>

      {message && <p className="text-blue-300">{message}</p>}

      {/* EXISTING TF DISPLAY */}
      {tfRow && (
        <div className="bg-surface border border-border rounded p-4 space-y-2">
          <h3 className="text-lg font-semibold text-accent">{tfRow.name}</h3>

          <p>
            <strong>ID:</strong> {tfRow.TF_id}
          </p>
          <p>
            <strong>Family:</strong> {tfRow.family_name}
          </p>

          <p>
            <strong>TF Description:</strong>{" "}
            {tfRow.description || "—"}
          </p>
          <p>
            <strong>Family Description:</strong>{" "}
            {tfRow.family_description || "—"}
          </p>

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

      {/* CREATE NEW TF FORM */}
      {showCreateForm && (
        <div className="bg-surface border border-border rounded p-4 space-y-3">
          <h3 className="text-lg font-semibold text-accent">
            Create New TF
          </h3>

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
                <label className="block font-medium">
                  New Family Name
                </label>
                <input
                  className="form-control"
                  value={newFamilyName}
                  onChange={(e) => setNewFamilyName(e.target.value)}
                />
              </div>

              <div>
                <label className="block font-medium">
                  Family Description
                </label>
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

      {/* ======================== GENOME SECTION ======================== */}
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Genome NCBI accession number</h3>
        <p className="text-sm text-muted">
          You can add more than one genome (e.g. NC_000913.2).
        </p>

        <div className="flex gap-2">
          <input
            className="form-control flex-1"
            placeholder="Example: NC_000913.2"
            value={genomeInput}
            onChange={(e) => handleAutocompleteGenome(e.target.value)}
          />
          <button className="btn" onClick={handleAddGenome}>
            Add genome
          </button>
        </div>

        {genomeSuggestions.length > 0 && (
          <div className="border border-border rounded bg-surface p-2 mt-1">
            {genomeSuggestions.map((g) => (
              <div
                key={g.genome_id}
                className="p-1 hover:bg-muted cursor-pointer"
                onClick={() => {
                  setGenomeInput(g.genome_accession);
                  setGenomeSuggestions([]);
                }}
              >
                {g.genome_accession} — {g.organism}
              </div>
            ))}
          </div>
        )}

        {genomeItems.length > 0 && (
          <ul className="list-disc pl-6 mt-2 text-sm">
            {genomeItems.map((g, i) => (
              <li key={i}>
                <strong>{g.accession}</strong> — {g.description}
                {g.fromDb && " (from DB)"}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ======================== UNIPROT SECTION ======================== */}
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">TF UniProt accession number</h3>
        <p className="text-sm text-muted">
          You can add more than one UniProt accession (e.g. Q87KN2).
        </p>

        <div className="flex gap-2">
          <input
            className="form-control flex-1"
            placeholder="Example: Q87KN2"
            value={uniprotInput}
            onChange={(e) => handleAutocompleteUniprot(e.target.value)}
          />
          <button className="btn" onClick={handleAddUniprot}>
            Add UniProt
          </button>
        </div>

        {uniprotSuggestions.length > 0 && (
          <div className="border border-border rounded bg-surface p-2 mt-1">
            {uniprotSuggestions.map((u) => (
              <div
                key={u.TF_instance_id}
                className="p-1 hover:bg-muted cursor-pointer"
                onClick={() => {
                  setUniprotInput(u.uniprot_accession);
                  setUniprotSuggestions([]);
                }}
              >
                {u.uniprot_accession} — {u.description}
              </div>
            ))}
          </div>
        )}

        {uniProtItems.length > 0 && (
          <ul className="list-disc pl-6 mt-2 text-sm">
            {uniProtItems.map((u, i) => (
              <li key={i}>
                <strong>{u.accession}</strong> — {u.description}
                {u.fromDb && " (from DB)"}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ======================== REFSEQ SECTION ======================== */}
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">
          TF NCBI protein (RefSeq) accession number
        </h3>
        <p className="text-sm text-muted">
          You can add more than one RefSeq accession (e.g. NP_799324).
        </p>

        <div className="flex gap-2">
          <input
            className="form-control flex-1"
            placeholder="Example: NP_799324"
            value={refseqInput}
            onChange={(e) => handleAutocompleteRefseq(e.target.value)}
          />
          <button className="btn" onClick={handleAddRefseq}>
            Add RefSeq
          </button>
        </div>

        {refseqSuggestions.length > 0 && (
          <div className="border border-border rounded bg-surface p-2 mt-1">
            {refseqSuggestions.map((r) => (
              <div
                key={r.TF_instance_id}
                className="p-1 hover:bg-muted cursor-pointer"
                onClick={() => {
                  setRefseqInput(r.refseq_accession);
                  setRefseqSuggestions([]);
                }}
              >
                {r.refseq_accession} — {r.description}
              </div>
            ))}
          </div>
        )}

        {refseqItems.length > 0 && (
          <ul className="list-disc pl-6 mt-2 text-sm">
            {refseqItems.map((r, i) => (
              <li key={i}>
                <strong>{r.accession}</strong> — {r.description}
                {r.fromDb && " (from DB)"}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

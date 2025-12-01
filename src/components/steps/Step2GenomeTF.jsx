/** -------------- STEP 2 – GENOME & TF (VERSIÓN CORREGIDA) ---------------- */

import { useState, useEffect } from "react";
import { runQuery } from "../../db/queryExecutor";
import { useCuration } from "../../context/CurationContext";

// Proxy i bases per a les APIs externes
const PROXY = "https://corsproxy.io/?";
const ENTREZ_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const UNIPROT_BASE = "https://rest.uniprot.org/uniprotkb";

export default function Step2GenomeTF() {
  const {
    tf, setTf,
    promoterInfo, setPromoterInfo,
    expressionInfo, setExpressionInfo,
    goToNextStep
  } = useCuration();

  // ---------------- TF NAME ----------------
  const [searchName, setSearchName] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [tfRow, setTfRow] = useState(null);

  // Create new TF
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTFName, setNewTFName] = useState("");
  const [tfDesc, setTfDesc] = useState("");

  // Families
  const [families, setFamilies] = useState([]);
  const [selectedFamily, setSelectedFamily] = useState("");
  const [showNewFamily, setShowNewFamily] = useState(false);
  const [newFamilyName, setNewFamilyName] = useState("");
  const [newFamilyDesc, setNewFamilyDesc] = useState("");

  // Messages
  const [message, setMessage] = useState("");

  // ---------------- GENOME ACCESSIONS ----------------
  const [genomeInput, setGenomeInput] = useState("");
  const [genomeSuggestions, setGenomeSuggestions] = useState([]);
  const [genomeItems, setGenomeItems] = useState([]);

  // ---------------- UNIPROT ACCESSIONS ----------------
  const [uniprotInput, setUniprotInput] = useState("");
  const [uniprotSuggestions, setUniprotSuggestions] = useState([]);
  const [uniProtItems, setUniProtItems] = useState([]);

  // ---------------- REFSEQ ACCESSIONS ----------------
  const [refseqInput, setRefseqInput] = useState("");
  const [refseqSuggestions, setRefseqSuggestions] = useState([]);
  const [refseqItems, setRefseqItems] = useState([]);

  function esc(str) {
    return String(str || "").replace(/'/g, "''");
  }

  // ---------------- LOAD FAMILIES ----------------
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
  // TF AUTOCOMPLETE (EL SEARCH YA NO EXISTE)
  // ====================================================

  async function handleAutocompleteTF(value) {
    setSearchName(value);
    setTfRow(null);
    setShowCreateForm(false);
    setShowNewFamily(false);

    if (!value) {
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

  // Selección desde el autocomplete
  function selectTF(row) {
    setTfRow(row);
    setShowCreateForm(false);
    setSearchName(row.name);
    setSuggestions([]);

    // Guardar en context
    setTf({
      TF_id: row.TF_id,
      name: row.name,
      family: row.family_name,
    });
  }

  // ====================================================
  // CREATE NEW TF (sin ejecutar SQL)
  // ====================================================

  function handleCreateTF() {
    if (!newTFName.trim()) {
      setMessage("Please enter a TF name.");
      return;
    }

    const familyName =
      showNewFamily ? newFamilyName :
      families.find(f => f.tf_family_id == selectedFamily)?.name;

    setTf({
      name: newTFName,
      description: tfDesc,
      family: familyName,
      newFamilyName: showNewFamily ? newFamilyName : null,
      newFamilyDesc: showNewFamily ? newFamilyDesc : null,
      family_id: showNewFamily ? null : selectedFamily
    });

    // Dejar de mostrar el form TF
    setTfRow({ name: newTFName, family_name: familyName });
    setShowCreateForm(false);
  }

  // ====================================================
  // GENOME VALIDATION (NO SE CAMBIA NADA)
  // ====================================================

  async function handleAutocompleteGenome(val) {
    setGenomeInput(val);

    if (!val) {
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

  async function fetchNuccoreSummary(acc) {
    const url1 = `${ENTREZ_BASE}/esearch.fcgi?db=nuccore&retmode=json&term=${acc}[accn]`;
    const r1 = await fetch(PROXY + encodeURIComponent(url1));
    const j1 = await r1.json();
    const uid = j1.esearchresult?.idlist?.[0];
    if (!uid) return null;

    const url2 = `${ENTREZ_BASE}/esummary.fcgi?db=nuccore&id=${uid}&retmode=json`;
    const r2 = await fetch(PROXY + encodeURIComponent(url2));
    const j2 = await r2.json();
    const rec = j2.result?.[uid];

    return rec ? { title: rec.title, organism: rec.organism } : null;
  }

  async function handleAddGenome() {
    const acc = genomeInput.trim();
    if (!acc || genomeItems.some((i) => i.accession === acc)) return;

    const rows = await runQuery(
      `SELECT genome_accession, organism FROM core_genome WHERE genome_accession = ? LIMIT 1;`,
      [acc]
    );

    if (rows.length) {
      setGenomeItems([...genomeItems, {
        accession: rows[0].genome_accession,
        description: rows[0].organism,
        organism: rows[0].organism,
        fromDb: true
      }]);
      setGenomeInput("");
      return;
    }

    const info = await fetchNuccoreSummary(acc);
    if (!info) return;

    setGenomeItems([
      ...genomeItems,
      {
        accession: acc,
        description: info.title,
        organism: info.organism,
        fromDb: false
      }
    ]);

    setGenomeInput("");
  }

  // ====================================================
  // UNIPROT VALIDATION
  // ====================================================

  async function handleAutocompleteUniprot(val) {
    setUniprotInput(val);
    if (!val) {
      setUniprotSuggestions([]);
      return;
    }

    const rows = await runQuery(
      `
      SELECT TF_instance_id, uniprot_accession, description, refseq_accession
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
      const res = await fetch(PROXY + encodeURIComponent(`${UNIPROT_BASE}/${acc}.json`));
      if (!res.ok) return null;
      const json = await res.json();
      const title =
        json.proteinDescription?.recommendedName?.fullName?.value ||
        json.id ||
        acc;
      const organism = json.organism?.scientificName || "";
      return { title, organism };
    } catch {
      return null;
    }
  }

  async function handleAddUniprot() {
    const acc = uniprotInput.trim();
    if (!acc || uniProtItems.some((u) => u.accession === acc)) return;

    const rows = await runQuery(
      `SELECT uniprot_accession, description, refseq_accession
       FROM core_tfinstance WHERE uniprot_accession = ? LIMIT 1;`,
      [acc]
    );

    if (rows.length) {
      setUniProtItems([
        ...uniProtItems,
        {
          accession: rows[0].uniprot_accession,
          description: rows[0].description,
          fromDb: true
        }
      ]);

      // Auto-add RefSeq if available
      if (rows[0].refseq_accession && !refseqItems.some(r => r.accession === rows[0].refseq_accession)) {
        setRefseqItems([
          ...refseqItems,
          {
            accession: rows[0].refseq_accession,
            description: rows[0].description,
            fromDb: true
          }
        ]);
      }

      setUniprotInput("");
      return;
    }

    const info = await fetchUniprotSummary(acc);
    if (!info) return;

    setUniProtItems([
      ...uniProtItems,
      {
        accession: acc,
        description: info.title,
        fromDb: false
      }
    ]);
    setUniprotInput("");
  }

  // ====================================================
  // REFSEQ VALIDATION
  // ====================================================

  async function handleAutocompleteRefseq(val) {
    setRefseqInput(val);
    if (!val) {
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

  async function fetchProteinSummary(acc) {
    const url1 = `${ENTREZ_BASE}/esearch.fcgi?db=protein&retmode=json&term=${acc}[accn]`;
    const r1 = await fetch(PROXY + encodeURIComponent(url1));
    const j1 = await r1.json();
    const uid = j1.esearchresult?.idlist?.[0];
    if (!uid) return null;

    const url2 = `${ENTREZ_BASE}/esummary.fcgi?db=protein&id=${uid}&retmode=json`;
    const r2 = await fetch(PROXY + encodeURIComponent(url2));
    const j2 = await r2.json();
    const rec = j2.result?.[uid];

    return rec ? { title: rec.title } : null;
  }

  async function handleAddRefseq() {
    const acc = refseqInput.trim();
    if (!acc || refseqItems.some((r) => r.accession === acc)) return;

    const rows = await runQuery(
      `SELECT refseq_accession, description FROM core_tfinstance WHERE refseq_accession = ? LIMIT 1;`,
      [acc]
    );

    if (rows.length) {
      setRefseqItems([
        ...refseqItems,
        {
          accession: rows[0].refseq_accession,
          description: rows[0].description,
          fromDb: true
        }
      ]);
      setRefseqInput("");
      return;
    }

    const info = await fetchProteinSummary(acc);
    if (!info) return;

    setRefseqItems([
      ...refseqItems,
      {
        accession: acc,
        description: info.title,
        fromDb: false
      }
    ]);

    setRefseqInput("");
  }

  // ====================================================
  // READY TO CONTINUE?
  // ====================================================

  const canContinue =
    (tfRow || showCreateForm) &&
    genomeItems.length > 0 &&
    (uniProtItems.length > 0 || refseqItems.length > 0);

  // ====================================================
  // RENDER
  // ====================================================

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold">Step 2 – Genome & TF</h2>

      {/* TF INPUT */}
      <div className="space-y-2">
        <label className="block font-medium">TF Name</label>

        <input
          className="form-control"
          value={searchName}
          placeholder="Example: LexA"
          onChange={(e) => handleAutocompleteTF(e.target.value)}
        />

        {suggestions.length > 0 && (
          <div className="border border-border rounded bg-surface p-2 mt-1">
            {suggestions.map((s) => (
              <div
                key={s.TF_id}
                className="p-1 hover:bg-muted cursor-pointer"
                onClick={() => selectTF(s)}
              >
                {s.name} ({s.family_name})
              </div>
            ))}
          </div>
        )}

        <button
          className="btn mt-2"
          onClick={() => {
            setShowCreateForm(true);
            setTfRow(null);
            setNewTFName(searchName);
          }}
        >
          + Add TF
        </button>
      </div>

      {message && <p className="text-blue-300">{message}</p>}

      {/* EXISTING TF */}
      {tfRow && (
        <div className="bg-surface border border-border rounded p-4 space-y-2">
          <h3 className="text-lg font-semibold text-accent">{tfRow.name}</h3>
          <p><strong>Family:</strong> {tfRow.family_name}</p>
        </div>
      )}

      {/* CREATE NEW TF */}
      {showCreateForm && (
        <div className="bg-surface border border-border rounded p-4 space-y-3">

          <h3 className="text-lg font-semibold text-accent">Create New TF</h3>

          <div>
            <label>TF Name</label>
            <input
              className="form-control"
              value={newTFName}
              onChange={(e) => setNewTFName(e.target.value)}
            />
          </div>

          <div>
            <label>Existing Family</label>
            <select
              className="form-control"
              value={selectedFamily}
              onChange={(e) => {
                setSelectedFamily(e.target.value);
                setShowNewFamily(false);
              }}
            >
              <option value="">Select a family...</option>
              {families.map((f) => (
                <option key={f.tf_family_id} value={f.tf_family_id}>
                  {f.name}
                </option>
              ))}
            </select>

            {/* BOTÓN NUEVA FAMILIA */}
            <button
              className="btn mt-2"
              onClick={() => {
                setShowNewFamily(true);
                setSelectedFamily("");
              }}
            >
              + Add New Family
            </button>
          </div>

          {showNewFamily && (
            <>
              <div>
                <label>New Family Name</label>
                <input
                  className="form-control"
                  value={newFamilyName}
                  onChange={(e) => setNewFamilyName(e.target.value)}
                />
              </div>

              <div>
                <label>Family Description</label>
                <textarea
                  className="form-control"
                  value={newFamilyDesc}
                  onChange={(e) => setNewFamilyDesc(e.target.value)}
                />
              </div>
            </>
          )}

          <div>
            <label>TF Description</label>
            <textarea
              className="form-control"
              value={tfDesc}
              onChange={(e) => setTfDesc(e.target.value)}
            />
          </div>

          <button className="btn" onClick={handleCreateTF}>
            Save TF
          </button>
        </div>
      )}

      {/* GENOME ACCESSIONS */}
      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-accent">Genome NCBI accession number</h3>

        <div className="flex gap-2">
          <input
            className="form-control flex-1"
            value={genomeInput}
            placeholder="Example: NC_000913.2"
            onChange={(e) => handleAutocompleteGenome(e.target.value)}
          />
          <button className="btn" onClick={handleAddGenome}>Add genome</button>
        </div>

        {genomeSuggestions.length > 0 && (
          <div className="border border-border rounded bg-surface p-2 mt-1">
            {genomeSuggestions.map(g => (
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
          <ul className="text-sm list-disc pl-5 mt-2">
            {genomeItems.map((g, i) => (
              <li key={i}><strong>{g.accession}</strong> — {g.description}</li>
            ))}
          </ul>
        )}
      </div>

      {/* UNIPROT */}
      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-accent">TF UniProt accession number</h3>

        <div className="flex gap-2">
          <input
            className="form-control flex-1"
            value={uniprotInput}
            placeholder="Example: Q87KN2"
            onChange={(e) => handleAutocompleteUniprot(e.target.value)}
          />
          <button className="btn" onClick={handleAddUniprot}>Add UniProt</button>
        </div>

        {uniprotSuggestions.length > 0 && (
          <div className="border border-border rounded bg-surface p-2 mt-1">
            {uniprotSuggestions.map(u => (
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
          <ul className="text-sm list-disc pl-5 mt-2">
            {uniProtItems.map((u, i) => (
              <li key={i}><strong>{u.accession}</strong> — {u.description}</li>
            ))}
          </ul>
        )}
      </div>

      {/* REFSEQ */}
      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-accent">TF NCBI protein (RefSeq) accession number</h3>

        <div className="flex gap-2">
          <input
            className="form-control flex-1"
            value={refseqInput}
            placeholder="Example: NP_799324"
            onChange={(e) => handleAutocompleteRefseq(e.target.value)}
          />
          <button className="btn" onClick={handleAddRefseq}>Add RefSeq</button>
        </div>

        {refseqSuggestions.length > 0 && (
          <div className="border border-border rounded bg-surface p-2 mt-1">
            {refseqSuggestions.map(r => (
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
          <ul className="text-sm list-disc pl-5 mt-2">
            {refseqItems.map((r, i) => (
              <li key={i}><strong>{r.accession}</strong> — {r.description}</li>
            ))}
          </ul>
        )}
      </div>

      {/* CHECKBOXES */}
      <div className="bg-surface border border-border p-4 rounded space-y-3">
        <label className="flex gap-2 items-center">
          <input
            type="checkbox"
            checked={promoterInfo}
            onChange={(e) => setPromoterInfo(e.target.checked)}
          />
          The manuscript contains promoter information
        </label>

        <label className="flex gap-2 items-center">
          <input
            type="checkbox"
            checked={expressionInfo}
            onChange={(e) => setExpressionInfo(e.target.checked)}
          />
          The manuscript contains expression data
        </label>
      </div>

      {/* FINAL CONTINUE BUTTON */}
      {canContinue && (
        <button className="btn mt-6" onClick={goToNextStep}>
          Confirm and continue →
        </button>
      )}
    </div>
  );
}

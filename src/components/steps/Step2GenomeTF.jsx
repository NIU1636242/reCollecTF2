import { useState, useEffect } from "react";
import { runQuery } from "../../db/queryExecutor";
import { useCuration } from "../../context/CurationContext";

// -------- API HELPERS --------

// NCBI nucleotide / protein accession validation (Entrez eSummary)
async function fetchNCBIInfo(acc) {
  try {
    const res = await fetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=nuccore&id=${acc}&retmode=json`
    );
    const json = await res.json();
    const uid = Object.keys(json.result).find((k) => k !== "uids");
    if (!uid) return null;
    return json.result[uid];
  } catch {
    return null;
  }
}

// UniProt accession validation
async function fetchUniProtInfo(acc) {
  try {
    const res = await fetch(
      `https://rest.uniprot.org/uniprotkb/${acc}.json`
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Escape SQL
function esc(str) {
  return String(str || "").replace(/'/g, "''");
}

export default function Step2GenomeTF() {

  // -------- CONTEXT --------
  const {
    tf, setTf,
    genomeAccessions, setGenomeAccessions,
    uniprotAccessions, setUniprotAccessions,
    refseqAccessions, setRefseqAccessions,
    speciesReportedGenome, setSpeciesReportedGenome,
    speciesReportedTF, setSpeciesReportedTF,
    promoterInfo, setPromoterInfo,
    expressionInfo, setExpressionInfo,
    goToNextStep
  } = useCuration();

  // -------- LOCAL STATE --------

  // TF autocomplete
  const [searchName, setSearchName] = useState("");
  const [tfSuggestions, setTfSuggestions] = useState([]);
  const [tfRow, setTfRow] = useState(null);

  // New TF creation
  const [showCreateTF, setShowCreateTF] = useState(false);
  const [newTFName, setNewTFName] = useState("");
  const [tfDesc, setTfDesc] = useState("");

  // Family
  const [families, setFamilies] = useState([]);
  const [selectedFamily, setSelectedFamily] = useState("");
  const [showNewFamily, setShowNewFamily] = useState(false);
  const [newFamilyName, setNewFamilyName] = useState("");
  const [newFamilyDesc, setNewFamilyDesc] = useState("");

  // Genome NCBI nucleotide
  const [genomeInput, setGenomeInput] = useState("");
  const [genomeInfoList, setGenomeInfoList] = useState([]);

  // UniProt
  const [uniInput, setUniInput] = useState("");
  const [uniInfoList, setUniInfoList] = useState([]);

  // RefSeq protein
  const [refseqInput, setRefseqInput] = useState("");
  const [refseqInfoList, setRefseqInfoList] = useState([]);

  // Loading status
  const [loading, setLoading] = useState(false);

  // -------- LOAD FAMILIES --------
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

  // -------- AUTOCOMPLETE TF --------
  async function handleTfAutocomplete(val) {
    setSearchName(val);
    setTfSuggestions([]);
    setTfRow(null);
    setShowCreateTF(false);

    if (!val) return;

    const rows = await runQuery(
      `
      SELECT tf.TF_id, tf.name, fam.name AS family_name
      FROM core_tf tf
      LEFT JOIN core_tffamily fam ON fam.tf_family_id = tf.family_id
      WHERE LOWER(tf.name) LIKE LOWER(? || '%')
      ORDER BY tf.name ASC;
      `,
      [val]
    );

    setTfSuggestions(rows);
  }

  // When selecting a TF from the list
  function selectTF(tf) {
    setTfRow(tf);
    setShowCreateTF(false);
    setSearchName(tf.name);

    // Save to context
    setTf({
      TF_id: tf.TF_id,
      name: tf.name,
      family: tf.family_name
    });
  }

  // -------- CREATE NEW TF --------
  function createTF() {
    setTf({
      name: newTFName,
      description: tfDesc,
      family_id: selectedFamily === "" ? null : selectedFamily,
      newFamilyName,
      newFamilyDesc
    });
    setTfRow(null);
    goToNextStep(); // will continue when accessions filled
  }

  // -------------------------------------------------------
  //               ACCESSION HANDLERS
  // -------------------------------------------------------

  // ------ Add genome accession ------
  async function handleAddGenome() {
    const acc = genomeInput.trim();
    if (!acc) return;

    const info = await fetchNCBIInfo(acc);
    if (!info) return;

    setGenomeInfoList([...genomeInfoList, {
      acc,
      title: info.title || "No description",
      sql: `
        INSERT INTO core_genome (genome_accession, name)
        VALUES ('${esc(acc)}', '${esc(info.title)}');
      `
    }]);

    setGenomeInput("");
  }

  // ------ Add UniProt accession ------
  async function handleAddUniProt() {
    const acc = uniInput.trim().toUpperCase();
    if (!acc) return;

    const info = await fetchUniProtInfo(acc);
    if (!info) return;

    setUniInfoList([...uniInfoList, {
      acc,
      title: info?.proteinDescription?.recommendedName?.fullName?.value || "No description",
      sql: `
        INSERT INTO core_tfinstance (uniprot_accession, description)
        VALUES ('${esc(acc)}', '${esc(info.proteinDescription?.recommendedName?.fullName?.value || "")}');
      `
    }]);

    setUniInput("");

    // If UniProt → auto-fill RefSeq if present
    const ref = info?.uniProtKBCrossReferences?.find(x => x.database === "RefSeq");
    if (ref) {
      const rs = ref.id;
      setRefseqInput(rs);
    }
  }

  // ------ Add RefSeq accession ------
  async function handleAddRefseq() {
    const acc = refseqInput.trim();
    if (!acc) return;

    const info = await fetchNCBIInfo(acc);
    if (!info) return;

    setRefseqInfoList([...refseqInfoList, {
      acc,
      title: info.title || "No description",
      sql: `
        INSERT INTO core_tfinstance (refseq_accession, description)
        VALUES ('${esc(acc)}', '${esc(info.title)}');
      `
    }]);

    setRefseqInput("");
  }

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold">Step 2 – Genome & TF</h2>

      {/* ---------------------------------------------------
           TF NAME INPUT + AUTOCOMPLETE
      --------------------------------------------------- */}
      <div className="space-y-2">
        <label className="block font-medium">TF Name</label>

        <input
          value={searchName}
          className="form-control"
          placeholder="Example: LexA"
          onChange={(e) => handleTfAutocomplete(e.target.value)}
        />

        {tfSuggestions.length > 0 && (
          <div className="border bg-surface border-border p-2 rounded">
            {tfSuggestions.map((tf) => (
              <div
                key={tf.TF_id}
                className="p-1 hover:bg-muted cursor-pointer"
                onClick={() => selectTF(tf)}
              >
                {tf.name} ({tf.family_name})
              </div>
            ))}
          </div>
        )}

        <button
          className="btn mt-1"
          onClick={() => {
            setShowCreateTF(true);
            setTfRow(null);
            setNewTFName(searchName);
          }}
        >
          + Add TF
        </button>
      </div>

      {/* ---------------------------------------------------
           EXISTING TF INFO
      --------------------------------------------------- */}
      {tfRow && (
        <div className="bg-surface border border-border rounded p-4 space-y-2">
          <h3 className="text-lg font-semibold text-accent">{tfRow.name}</h3>

          <p><strong>ID:</strong> {tfRow.TF_id}</p>
          <p><strong>Family:</strong> {tfRow.family_name}</p>

          <button
            className="btn mt-4"
            onClick={() => {}}
          >
            (Continue below)
          </button>
        </div>
      )}

      {/* ---------------------------------------------------
           CREATE NEW TF FORM
      --------------------------------------------------- */}
      {showCreateTF && (
        <div className="bg-surface border border-border rounded p-4 space-y-4">
          <h3 className="text-lg text-accent font-semibold">Create New TF</h3>

          <div>
            <label>TF Name</label>
            <input className="form-control" value={newTFName}
              onChange={(e) => setNewTFName(e.target.value)}
            />
          </div>

          <div>
            <label>Existing Family</label>
            <select
              className="form-control"
              value={selectedFamily}
              onChange={(e) => setSelectedFamily(e.target.value)}
            >
              <option value="">Select family...</option>
              {families.map((f) => (
                <option key={f.tf_family_id} value={f.tf_family_id}>
                  {f.name}
                </option>
              ))}
            </select>

            <button
              className="btn mt-2"
              onClick={() => setShowNewFamily(true)}
            >
              + Add New Family
            </button>
          </div>

          {showNewFamily && (
            <>
              <div>
                <label>Family Name</label>
                <input className="form-control" value={newFamilyName}
                  onChange={(e) => setNewFamilyName(e.target.value)} />
              </div>

              <div>
                <label>Family Description</label>
                <textarea className="form-control" value={newFamilyDesc}
                  onChange={(e) => setNewFamilyDesc(e.target.value)} />
              </div>
            </>
          )}

          <div>
            <label>TF Description</label>
            <textarea className="form-control" value={tfDesc}
              onChange={(e) => setTfDesc(e.target.value)} />
          </div>
        </div>
      )}

      {/* ---------------------------------------------------
          GENOME NCBI ACCESSIONS
      --------------------------------------------------- */}
      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-accent">Genome NCBI accession number</h3>

        <div className="flex gap-2">
          <input
            className="form-control flex-1"
            placeholder="Example: NC_000913.2"
            value={genomeInput}
            onChange={(e) => setGenomeInput(e.target.value)}
          />
          <button className="btn" onClick={handleAddGenome}>Add genome</button>
        </div>

        {genomeInfoList.map((g, i) => (
          <div key={i} className="text-sm text-muted">
            <strong>{g.acc}</strong> — {g.title}
          </div>
        ))}
      </div>

      {/* ---------------------------------------------------
          UNIPROT ACCESSIONS
      --------------------------------------------------- */}
      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-accent">TF UniProt accession number</h3>

        <div className="flex gap-2">
          <input
            className="form-control flex-1"
            placeholder="Example: Q87KN2"
            value={uniInput}
            onChange={(e) => setUniInput(e.target.value)}
          />
          <button className="btn" onClick={handleAddUniProt}>Add UniProt</button>
        </div>

        {uniInfoList.map((u, i) => (
          <div key={i} className="text-sm text-muted">
            <strong>{u.acc}</strong> — {u.title}
          </div>
        ))}
      </div>

      {/* ---------------------------------------------------
          REFSEQ ACCESSIONS
      --------------------------------------------------- */}
      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-accent">TF NCBI protein (RefSeq) accession number</h3>

        <div className="flex gap-2">
          <input
            className="form-control flex-1"
            placeholder="Example: NP_799324"
            value={refseqInput}
            onChange={(e) => setRefseqInput(e.target.value)}
          />
          <button className="btn" onClick={handleAddRefseq}>Add RefSeq</button>
        </div>

        {refseqInfoList.map((r, i) => (
          <div key={i} className="text-sm text-muted">
            <strong>{r.acc}</strong> — {r.title}
          </div>
        ))}
      </div>

      {/* ---------------------------------------------------
          CHECKBOXES
      --------------------------------------------------- */}
      <div className="space-y-3 bg-surface border border-border p-4 rounded">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={promoterInfo}
            onChange={(e) => setPromoterInfo(e.target.checked)} />
          The manuscript contains promoter information
        </label>

        <label className="flex items-center gap-2">
          <input type="checkbox" checked={expressionInfo}
            onChange={(e) => setExpressionInfo(e.target.checked)} />
          The manuscript contains expression data
        </label>
      </div>

      {/* ---------------------------------------------------
          FINAL CONFIRM BUTTON
      --------------------------------------------------- */}
      {(tfRow || showCreateTF) &&
        genomeInfoList.length > 0 &&
        (uniInfoList.length > 0 || refseqInfoList.length > 0) && (
        <button className="btn mt-6" onClick={goToNextStep}>
          Confirm and continue →
        </button>
      )}
    </div>
  );
}

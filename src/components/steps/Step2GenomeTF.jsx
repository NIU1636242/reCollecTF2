import { useState, useEffect } from "react";
import { runQuery } from "../../db/queryExecutor";
import { useCuration } from "../../context/CurationContext";

const PROXY = "https://corsproxy.io/?";
const ENTREZ_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const UNIPROT_BASE = "https://rest.uniprot.org/uniprotkb";

export default function Step2GenomeTF() {
  const {
    tf,
    setTf,
    genomeList,
    setGenomeList,
    uniprotList,
    setUniprotList,
    refseqList,
    setRefseqList,
    strainData,
    setStrainData,
    goToNextStep,
  } = useCuration();

  // ---------------- TF ----------------
  const [searchName, setSearchName] = useState("");
  const [suggestions, setSuggestions] = useState([]);

  const [tfRow, setTfRow] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const [newTFName, setNewTFName] = useState("");
  const [tfDesc, setTfDesc] = useState("");

  const [families, setFamilies] = useState([]);
  const [selectedFamily, setSelectedFamily] = useState("");
  const [showNewFamilyForm, setShowNewFamilyForm] = useState(false);
  const [newFamilyName, setNewFamilyName] = useState("");
  const [newFamilyDesc, setNewFamilyDesc] = useState("");

  const [finalError, setFinalError] = useState("");

  // ---------------- Genome ----------------
  const [genomeInput, setGenomeInput] = useState("");
  const [genomeSuggestions, setGenomeSuggestions] = useState([]);
  const [genomeItems, setGenomeItems] = useState([]);

  // ---------------- UniProt ----------------
  const [uniprotInput, setUniprotInput] = useState("");
  const [uniprotSuggestions, setUniprotSuggestions] = useState([]);
  const [uniProtItems, setUniProtItems] = useState([]);

  // ---------------- RefSeq ----------------
  const [refseqInput, setRefseqInput] = useState("");
  const [refseqSuggestions, setRefseqSuggestions] = useState([]);
  const [refseqItems, setRefseqItems] = useState([]);

  // ---------------- Checkboxes + extra fields ----------------
  const [sameStrainGenome, setSameStrainGenome] = useState(false);
  const [bindingOrganism, setBindingOrganism] = useState("");

  const [sameStrainTF, setSameStrainTF] = useState(false);
  const [reportedTFOrganism, setReportedTFOrganism] = useState("");

  const [promoterInfo, setPromoterInfo] = useState(false);
  const [expressionInfo, setExpressionInfo] = useState(false);

  // Escape SQL
  function esc(s) {
    return String(s || "").replace(/'/g, "''");
  }

  // ---------------- RESTORE FROM CONTEXT ----------------
  useEffect(() => {
    if (tf) {
      if (tf.TF_id) {
        setTfRow(tf);
        setSearchName(tf.name);
      } else {
        setShowCreateForm(true);
        setNewTFName(tf.name || "");
        setTfDesc(tf.description || "");
        setSelectedFamily(tf.family_id || "");
        setShowNewFamilyForm(tf.isNewFamily || false);
        setNewFamilyName(tf.family || "");
        setNewFamilyDesc(tf.family_description || "");
      }
    }
    if (genomeList?.length) setGenomeItems(genomeList);
    if (uniprotList?.length) setUniProtItems(uniprotList);
    if (refseqList?.length) setRefseqItems(refseqList);

    if (strainData) {
      setSameStrainGenome(strainData.sameStrainGenome || false);
      setBindingOrganism(strainData.organismTFBindingSites || "");

      setSameStrainTF(strainData.sameStrainTF || false);
      setReportedTFOrganism(strainData.organismReportedTF || "");

      setPromoterInfo(strainData.promoterInfo || false);
      setExpressionInfo(strainData.expressionInfo || false);
    }
  }, []);

  // ---------------- LOAD FAMILIES ----------------
  useEffect(() => {
    async function loadFamilies() {
      const rows = await runQuery(`
        SELECT tf_family_id, name, description
        FROM core_tffamily ORDER BY name ASC
      `);
      setFamilies(rows);
    }
    loadFamilies();
  }, []);

  // ============================================================
  // TF AUTOCOMPLETE
  // ============================================================
  async function handleAutocompleteTF(val) {
    setSearchName(val);
    setTfRow(null);
    setShowCreateForm(false);

    if (!val || val.length < 1) {
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
      [val]
    );

    setSuggestions(rows);
  }

  // ============================================================
  // When selecting from autocomplete → load full TF
  // ============================================================
  async function loadTF(name) {
    const rows = await runQuery(
      `
      SELECT tf.*, fam.name AS family_name, fam.description AS family_description
      FROM core_tf tf
      LEFT JOIN core_tffamily fam ON fam.tf_family_id = tf.family_id
      WHERE LOWER(tf.name) = LOWER(?)
      LIMIT 1
      `,
      [name]
    );

    if (rows.length) {
      setTfRow(rows[0]);
      setTf(rows[0]); // save to context
      setShowCreateForm(false);
    } else {
      setTfRow(null);
      setShowCreateForm(true);
      setNewTFName(name);
    }
  }

  // ============================================================
  // CREATE NEW TF (NO DEPLOY YET)
  // ============================================================
  function saveNewTF() {
    setFinalError("");

    if (!newTFName.trim()) {
      setFinalError("Please enter a TF name.");
      return;
    }

    let familyName = "";
    let familyId = null;

    if (showNewFamilyForm) {
      if (!newFamilyName.trim()) {
        setFinalError("Please enter the new family name.");
        return;
      }
      familyName = newFamilyName;
    } else {
      if (!selectedFamily) {
        setFinalError("Please select a family.");
        return;
      }
      const fam = families.find((f) => f.tf_family_id == selectedFamily);
      familyName = fam?.name || "";
      familyId = fam?.tf_family_id || null;
    }

    const newObj = {
      name: newTFName,
      description: tfDesc,
      family: familyName,
      family_id: familyId,
      isNew: true,
      isNewFamily: showNewFamilyForm,
      newFamilyName,
      newFamilyDesc,
    };

    setTf(newObj);
    setTfRow(null);
    setShowCreateForm(false);
  }

  // ============================================================
  // GENOME AUTOCOMPLETE + VALIDATION
  // ============================================================
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
      ORDER BY genome_accession ASC
      `,
      [val]
    );
    setGenomeSuggestions(rows);
  }

  async function fetchNuccoreSummary(acc) {
    const url1 = `${ENTREZ_BASE}/esearch.fcgi?db=nuccore&retmode=json&term=${encodeURIComponent(
      acc
    )}[accn]`;
    const r1 = await fetch(PROXY + encodeURIComponent(url1));
    const j1 = await r1.json();
    const uid = j1.esearchresult?.idlist?.[0];
    if (!uid) return null;

    const url2 = `${ENTREZ_BASE}/esummary.fcgi?db=nuccore&id=${uid}&retmode=json`;
    const r2 = await fetch(PROXY + encodeURIComponent(url2));
    const j2 = await r2.json();
    const rec = j2.result?.[uid];
    if (!rec) return null;

    return { title: rec.title, organism: rec.organism };
  }

  async function handleAddGenome() {
    const acc = genomeInput.trim();
    if (!acc) return;
    if (genomeItems.some((g) => g.accession === acc)) {
      setGenomeInput("");
      return;
    }

    const rows = await runQuery(
      `
      SELECT genome_id, genome_accession, organism
      FROM core_genome
      WHERE genome_accession = ?
      LIMIT 1
      `,
      [acc]
    );

    if (rows.length) {
      const g = rows[0];
      const updated = [
        ...genomeItems,
        {
          accession: g.genome_accession,
          description: g.organism,
          organism: g.organism,
          existsInDB: true,
        },
      ];
      setGenomeItems(updated);
      setGenomeList(updated);
      setGenomeInput("");
      setGenomeSuggestions([]);
      return;
    }

    const info = await fetchNuccoreSummary(acc);
    if (!info) return;

    const updated = [
      ...genomeItems,
      {
        accession: acc,
        description: info.title,
        organism: info.organism,
        existsInDB: false,
      },
    ];
    setGenomeItems(updated);
    setGenomeList(updated);

    setGenomeInput("");
    setGenomeSuggestions([]);
  }

  // ============================================================
  // UNIPROT AUTOCOMPLETE + VALIDATION
  // ============================================================
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
      ORDER BY uniprot_accession ASC
      `,
      [val]
    );
    setUniprotSuggestions(rows);
  }

  async function fetchUniprotSummary(acc) {
    const url = `${UNIPROT_BASE}/${encodeURIComponent(acc)}.json`;
    const r = await fetch(PROXY + encodeURIComponent(url));
    if (!r.ok) return null;
    const j = await r.json();

    const name =
      j.proteinDescription?.recommendedName?.fullName?.value ||
      j.proteinDescription?.submissionNames?.[0]?.fullName?.value ||
      "";

    return {
      title: name || j.id || acc,
      organism: j.organism?.scientificName || "",
    };
  }

  async function handleAddUniprot() {
    const acc = uniprotInput.trim();
    if (!acc) return;
    if (uniProtItems.some((i) => i.accession === acc)) {
      setUniprotInput("");
      return;
    }

    const rows = await runQuery(
      `
      SELECT TF_instance_id, uniprot_accession, refseq_accession, description
      FROM core_tfinstance
      WHERE uniprot_accession = ?
      LIMIT 1
      `,
      [acc]
    );

    if (rows.length) {
      const r = rows[0];

      const updatedUni = [
        ...uniProtItems,
        {
          accession: r.uniprot_accession,
          description: r.description || "",
          existsInDB: true,
          linkedRefseq: r.refseq_accession || null,
        },
      ];
      setUniProtItems(updatedUni);
      setUniprotList(updatedUni);

      if (r.refseq_accession) {
        if (!refseqItems.some((x) => x.accession === r.refseq_accession)) {
          const updatedRef = [
            ...refseqItems,
            {
              accession: r.refseq_accession,
              description: r.description || "",
              existsInDB: true,
            },
          ];
          setRefseqItems(updatedRef);
          setRefseqList(updatedRef);
        }
        // NO rellenar el input → FIX pedido
      }

      setUniprotInput("");
      setUniprotSuggestions([]);
      return;
    }

    const info = await fetchUniprotSummary(acc);
    if (!info) return;

    const updated = [
      ...uniProtItems,
      {
        accession: acc,
        description: info.title,
        existsInDB: false,
        linkedRefseq: null,
      },
    ];
    setUniProtItems(updated);
    setUniprotList(updated);

    setUniprotInput("");
    setUniprotSuggestions([]);
  }

  // ============================================================
  // REFSEQ AUTOCOMPLETE + VALIDATION
  // ============================================================
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
      ORDER BY refseq_accession ASC
      `,
      [val]
    );
    setRefseqSuggestions(rows);
  }

  async function fetchProteinSummary(acc) {
    const url1 = `${ENTREZ_BASE}/esearch.fcgi?db=protein&retmode=json&term=${encodeURIComponent(
      acc
    )}[accn]`;
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
    if (!acc) return;
    if (refseqItems.some((i) => i.accession === acc)) {
      setRefseqInput("");
      return;
    }

    const rows = await runQuery(
      `
      SELECT TF_instance_id, refseq_accession, description
      FROM core_tfinstance
      WHERE refseq_accession = ?
      LIMIT 1
      `,
      [acc]
    );

    if (rows.length) {
      const r = rows[0];
      const updated = [
        ...refseqItems,
        {
          accession: r.refseq_accession,
          description: r.description || "",
          existsInDB: true,
        },
      ];
      setRefseqItems(updated);
      setRefseqList(updated);

      setRefseqInput("");
      setRefseqSuggestions([]);
      return;
    }

    const info = await fetchProteinSummary(acc);
    if (!info) return;

    const updated = [
      ...refseqItems,
      {
        accession: acc,
        description: info.title,
        existsInDB: false,
      },
    ];
    setRefseqItems(updated);
    setRefseqList(updated);

    setRefseqInput("");
    setRefseqSuggestions([]);
  }

  // ============================================================
  // FINAL CONFIRM
  // ============================================================
  function handleFinalConfirm() {
    setFinalError("");

    if (!tf) {
      setFinalError("You must select or create a TF before continuing.");
      return;
    }

    if (genomeItems.length === 0) {
      setFinalError("Please add at least one genome accession.");
      return;
    }

    if (!sameStrainGenome && !bindingOrganism.trim()) {
      setFinalError(
        "Please specify the organism where TF binding sites are reported."
      );
      return;
    }

    if (!sameStrainTF && !reportedTFOrganism.trim()) {
      setFinalError("Please specify the organism of origin for the TF.");
      return;
    }

    const strainObj = {
      sameStrainGenome,
      organismTFBindingSites: bindingOrganism,
      sameStrainTF,
      organismReportedTF: reportedTFOrganism,
      promoterInfo,
      expressionInfo,
    };

    setGenomeList(genomeItems);
    setUniprotList(uniProtItems);
    setRefseqList(refseqItems);
    setStrainData(strainObj);

    goToNextStep();
  }

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold">Step 2 – Genome & TF</h2>

      {/* ---------------- TF NAME ---------------- */}
      <div className="space-y-2">
        <label className="block font-medium">TF Name</label>

        <input
          className="form-control"
          placeholder="Example: LexA"
          value={searchName}
          onChange={(e) => handleAutocompleteTF(e.target.value)}
        />

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

        {suggestions.length > 0 && (
          <div className="border border-border rounded bg-surface p-2 mt-1">
            {suggestions.map((s) => (
              <div
                key={s.TF_id}
                className="p-1 hover:bg-muted cursor-pointer"
                onClick={() => {
                  setSearchName(s.name);
                  setSuggestions([]);
                  loadTF(s.name);
                }}
              >
                {s.name} ({s.family_name})
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---------------- EXISTING TF ---------------- */}
      {tfRow && (
        <div className="bg-surface border border-border rounded p-4 space-y-2">
          <h3 className="text-lg font-semibold text-accent">{tfRow.name}</h3>
          <p><strong>ID:</strong> {tfRow.TF_id}</p>
          <p><strong>Family:</strong> {tfRow.family_name}</p>
          <p><strong>TF Description:</strong> {tfRow.description || "—"}</p>
          <p>
            <strong>Family Description:</strong>{" "}
            {tfRow.family_description || "—"}
          </p>
        </div>
      )}

      {/* ---------------- CREATE TF ---------------- */}
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
              onChange={(e) => {
                setSelectedFamily(e.target.value);
                setShowNewFamilyForm(false);
              }}
            >
              <option value="">Select a family...</option>
              {families.map((f) => (
                <option key={f.tf_family_id} value={f.tf_family_id}>
                  {f.name}
                </option>
              ))}
            </select>

            <button
              type="button"
              className="btn mt-2"
              onClick={() => {
                setShowNewFamilyForm(true);
                setSelectedFamily("");
              }}
            >
              + Add TF Family
            </button>
          </div>

          {showNewFamilyForm && (
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

          <button className="btn" onClick={saveNewTF}>
            Save TF
          </button>
        </div>
      )}

      {/* ---------------- GENOME ---------------- */}
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Genome NCBI accession number</h3>
        <p className="text-sm text-muted">
          Paste the NCBI GenBank genome accession for the closest species.
        </p>

        <div className="flex gap-2">
          <input
            className="form-control flex-1"
            value={genomeInput}
            onChange={(e) => handleAutocompleteGenome(e.target.value)}
            placeholder="NC_000913.2"
          />
          <button className="btn" onClick={handleAddGenome}>
            Add genome
          </button>
        </div>

        {/* LISTA DE GENOMES */}
        {genomeItems.length > 0 && (
          <ul className="list-disc pl-6 mt-2 text-sm">
            {genomeItems.map((g, i) => (
              <li key={i}>
                <strong>{g.accession}</strong> — {g.description}
                {g.existsInDB && " (from DB)"}
              </li>
            ))}
          </ul>
        )}

        {/* MOVER CHECKBOX AQUÍ */}
        <label className="inline-flex items-center gap-2 text-sm mt-3">
          <input
            type="checkbox"
            checked={sameStrainGenome}
            onChange={(e) => setSameStrainGenome(e.target.checked)}
          />
          <span>
            This is the exact same strain as reported in the manuscript for the sites.
          </span>
        </label>

        {!sameStrainGenome && (
          <div className="mt-4 space-y-1">
            <label className="block font-medium text-sm">
              Organism TF binding sites are reported in
            </label>

            <textarea
              className="form-control"
              value={bindingOrganism}
              onChange={(e) => setBindingOrganism(e.target.value)}
              placeholder="Example: Pseudomonas putida plasmid pEST1226"
            />

            <p className="text-xs text-muted">
              Used when the reported strain differs from the genome strain.
            </p>
          </div>
        )}
      </div>

      {/* ---------------- UNIPROT ---------------- */}
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">TF UniProt accession number</h3>
        <p className="text-sm text-muted">
          Paste the UniProt accession (e.g. Q87KN2).
        </p>

        <div className="flex gap-2">
          <input
            className="form-control flex-1"
            value={uniprotInput}
            onChange={(e) => handleAutocompleteUniprot(e.target.value)}
            placeholder="Q87KN2"
          />
          <button className="btn" onClick={handleAddUniprot}>
            Add UniProt
          </button>
        </div>

        {uniprotItems.length > 0 && (
          <ul className="list-disc pl-6 mt-2 text-sm">
            {uniprotItems.map((u, i) => (
              <li key={i}>
                <strong>{u.accession}</strong> — {u.description}
                {u.existsInDB && " (from DB)"}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---------------- REFSEQ ---------------- */}
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">TF NCBI RefSeq accession</h3>
        <p className="text-sm text-muted">Enter RefSeq TF protein accession.</p>

        <div className="flex gap-2">
          <input
            className="form-control flex-1"
            value={refseqInput}
            onChange={(e) => handleAutocompleteRefseq(e.target.value)}
            placeholder="NP_799324"
          />
          <button className="btn" onClick={handleAddRefseq}>
            Add RefSeq
          </button>
        </div>

        {/* LISTA */}
        {refseqItems.length > 0 && (
          <ul className="list-disc pl-6 mt-2 text-sm">
            {refseqItems.map((r, i) => (
              <li key={i}>
                <strong>{r.accession}</strong> — {r.description}
                {r.existsInDB && " (from DB)"}
              </li>
            ))}
          </ul>
        )}

        {/* MOVER CHECKBOX AQUÍ */}
        <label className="inline-flex items-center gap-2 text-sm mt-3">
          <input
            type="checkbox"
            checked={sameStrainTF}
            onChange={(e) => setSameStrainTF(e.target.checked)}
          />
          <span>
            This is the exact same strain as reported in the manuscript for the TF.
          </span>
        </label>

        {!sameStrainTF && (
          <div className="mt-4 space-y-1">
            <label className="block font-medium text-sm">
              Organism of origin for reported TF
            </label>

            <textarea
              className="form-control"
              value={reportedTFOrganism}
              onChange={(e) => setReportedTFOrganism(e.target.value)}
              placeholder="Example: Pseudomonas sp. ADP"
            />

            <p className="text-xs text-muted">
              Used when reported TF strain differs from the RefSeq strain.
            </p>
          </div>
        )}
      </div>

      {/* ---------------- PROMOTER & EXPRESSION CHECKBOXES ---------------- */}
      <div className="space-y-3 text-sm">
        <label className="inline-flex items-start gap-2">
          <input
            type="checkbox"
            checked={promoterInfo}
            onChange={(e) => setPromoterInfo(e.target.checked)}
          />
          <span>
            The manuscript contains promoter information.
            <br />
            <span className="text-xs text-muted">
              Sequence or structure of a TF-regulated promoter.
            </span>
          </span>
        </label>

        <label className="inline-flex items-start gap-2">
          <input
            type="checkbox"
            checked={expressionInfo}
            onChange={(e) => setExpressionInfo(e.target.checked)}
          />
          <span>
            The manuscript contains expression data.
            <br />
            <span className="text-xs text-muted">
              Evidence for TF-mediated differential gene expression.
            </span>
          </span>
        </label>
      </div>

      {/* ---------------- FINAL BUTTON ---------------- */}
      <div className="mt-6">
        <button className="btn" onClick={handleFinalConfirm}>
          Confirm and continue →
        </button>
      </div>

      {finalError && (
        <p className="text-red-400 text-sm mt-2">{finalError}</p>
      )}
    </div>
  );
}

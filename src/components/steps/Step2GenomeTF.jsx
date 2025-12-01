import { useState, useEffect } from "react";
import { runQuery } from "../../db/queryExecutor";
import { useCuration } from "../../context/CurationContext";

// Proxy i bases per a les APIs externes
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

  // ---------------- TF NAME ----------------
  const [searchName, setSearchName] = useState(""); // TF search input
  const [suggestions, setSuggestions] = useState([]); // autocomplete

  const [tfRow, setTfRow] = useState(null); // existing TF
  const [showCreateForm, setShowCreateForm] = useState(false);

  const [newTFName, setNewTFName] = useState(""); // TF creation field
  const [tfDesc, setTfDesc] = useState(""); // TF desc

  const [families, setFamilies] = useState([]); // family list
  const [selectedFamily, setSelectedFamily] = useState("");
  const [showNewFamilyForm, setShowNewFamilyForm] = useState(false);
  const [newFamilyName, setNewFamilyName] = useState("");
  const [newFamilyDesc, setNewFamilyDesc] = useState("");

  const [message, setMessage] = useState("");

  // ---------------- GENOME ACCESSIONS ----------------
  const [genomeInput, setGenomeInput] = useState("");
  const [genomeSuggestions, setGenomeSuggestions] = useState([]);
  const [genomeItems, setGenomeItems] = useState([]); // [{accession, description, organism, existsInDB}]

  // ---------------- UNIPROT ACCESSIONS ----------------
  const [uniprotInput, setUniprotInput] = useState("");
  const [uniprotSuggestions, setUniprotSuggestions] = useState([]);
  const [uniProtItems, setUniProtItems] = useState([]); // [{accession, description, organism, existsInDB, linkedRefseq}]

  // ---------------- REFSEQ (NCBI PROTEIN) ACCESSIONS ----------------
  const [refseqInput, setRefseqInput] = useState("");
  const [refseqSuggestions, setRefseqSuggestions] = useState([]);
  const [refseqItems, setRefseqItems] = useState([]); // [{accession, description, organism, existsInDB}]

  // ---------------- CHECKBOXES & ORGANISM TEXTS ----------------
  const [sameStrainGenome, setSameStrainGenome] = useState(false);
  const [sameStrainTF, setSameStrainTF] = useState(false);
  const [bindingOrganism, setBindingOrganism] = useState("");
  const [reportedTFOrganism, setReportedTFOrganism] = useState("");
  const [promoterInfo, setPromoterInfo] = useState(false);
  const [expressionInfo, setExpressionInfo] = useState(false);

  // escape SQL
  function esc(str) {
    return String(str || "").replace(/'/g, "''");
  }

  // ---------------- RESTAURAR DEL CONTEXT ----------------
  useEffect(() => {
    // TF
    if (tf) {
      if (tf.TF_id) {
        setTfRow(tf);
        setSearchName(tf.name || "");
      } else {
        // TF creat manualment
        setShowCreateForm(true);
        setNewTFName(tf.name || "");
        setSelectedFamily(tf.family_id || "");
        setTfDesc(tf.description || "");
      }
    }

    // genomes / proteins
    if (genomeList && genomeList.length > 0) {
      setGenomeItems(genomeList);
    }
    if (uniprotList && uniprotList.length > 0) {
      setUniProtItems(uniprotList);
    }
    if (refseqList && refseqList.length > 0) {
      setRefseqItems(refseqList);
    }

    // strain / organism info
    if (strainData) {
      setSameStrainGenome(strainData.sameStrainGenome || false);
      setSameStrainTF(strainData.sameStrainTF || false);
      setBindingOrganism(strainData.organismTFBindingSites || "");
      setReportedTFOrganism(strainData.organismReportedTF || "");
      setPromoterInfo(strainData.promoterInfo || false);
      setExpressionInfo(strainData.expressionInfo || false);
    }
  }, []); // només en muntar

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
  // TF NAME: AUTOCOMPLETE + LOOKUP
  // ====================================================

  async function handleAutocompleteTF(value) {
    setSearchName(value);
    setTfRow(null);
    setShowCreateForm(false);
    setMessage("");

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

  // Busca TF exacte i mostra info
  async function handleSearchTF(nameOverride) {
    setMessage("");
    setTfRow(null);
    setShowCreateForm(false);

    const name = (nameOverride ?? searchName).trim();
    if (!name) return;

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
        const row = rows[0];
        setTfRow(row);
        setTf(row); // guardem TF al context per al Summary
      } else {
        setMessage("TF not found. You can create it.");
        setShowCreateForm(true);
        setNewTFName(name);
        setTf(null);
      }
    } catch (err) {
      console.error(err);
      setMessage("Database error.");
    }
  }

  // ====================================================
  // CREAR NOU TF (sense deploy encara)
  // ====================================================

  async function handleCreateTF() {
    setMessage("");

    if (!newTFName.trim()) {
      setMessage("Please enter a name for the TF.");
      return;
    }

    const isNewFamily = showNewFamilyForm && newFamilyName.trim();
    const famId = selectedFamily ? Number(selectedFamily) : null;

    if (!isNewFamily && !famId) {
      setMessage("Please select a family or create a new one.");
      return;
    }

    const queries = [];

    if (isNewFamily) {
      // INSERT nova família
      queries.push(`
        INSERT INTO core_tffamily (name, description)
        VALUES ('${esc(newFamilyName)}', '${esc(newFamilyDesc)}');
      `);

      // INSERT TF lligat a la nova família
      queries.push(`
        INSERT INTO core_tf (name, family_id, description)
        VALUES (
          '${esc(newTFName)}',
          (SELECT tf_family_id FROM core_tffamily WHERE name='${esc(
            newFamilyName
          )}'),
          '${esc(tfDesc)}'
        );
      `);
    } else {
      queries.push(`
        INSERT INTO core_tf (name, family_id, description)
        VALUES ('${esc(newTFName)}', ${famId}, '${esc(tfDesc)}');
      `);
    }

    const sqlFinal = queries.join("\n");
    // Aquí es on en el futur es farà el deploy al Step7
    // await dispatchWorkflow({ inputs: { queries: sqlFinal } });

    const famName = isNewFamily
      ? newFamilyName
      : families.find((f) => f.tf_family_id == famId)?.name;

    // Guardem al context un objecte TF "nou"
    const newTfObj = {
      name: newTFName,
      family: famName,
      family_id: famId || null,
      description: tfDesc,
      isNew: true,
      sql: sqlFinal, // perquè Step7 pugui executar-ho
    };

    setTf(newTfObj);
    setTfRow(null);

    setMessage("New TF registered locally. It will be created at Step 7.");
  }

  // ====================================================
  // GENOME: AUTOCOMPLETE + VALIDADOR ENTrez
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
    const esearchUrl = `${ENTREZ_BASE}/esearch.fcgi?db=nuccore&retmode=json&term=${encodeURIComponent(
      accession
    )}[accn]`;
    const r1 = await fetch(PROXY + encodeURIComponent(esearchUrl));
    const j1 = await r1.json();
    const uid = j1.esearchresult?.idlist?.[0];
    if (!uid) return null;

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

    if (genomeItems.some((g) => g.accession === acc)) {
      setGenomeInput("");
      return;
    }

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

    try {
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

    // 1) DB
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

      const updatedUni = [
        ...uniProtItems,
        {
          accession: row.uniprot_accession,
          description: row.description || "",
          organism: "",
          existsInDB: true,
          linkedRefseq: row.refseq_accession || null,
        },
      ];
      setUniProtItems(updatedUni);
      setUniprotList(updatedUni);

      // Si té RefSeq associat, l'afegim
      if (row.refseq_accession) {
        if (!refseqItems.some((r) => r.accession === row.refseq_accession)) {
          const updatedRef = [
            ...refseqItems,
            {
              accession: row.refseq_accession,
              description: row.description || "",
              organism: "",
              existsInDB: true,
            },
          ];
          setRefseqItems(updatedRef);
          setRefseqList(updatedRef);
        }
        if (!refseqInput) {
          setRefseqInput(row.refseq_accession);
        }
      }

      setUniprotInput("");
      setUniprotSuggestions([]);
      return;
    }

    // 2) UniProt API
    const info = await fetchUniprotSummary(acc);
    if (!info) return;

    const updated = [
      ...uniProtItems,
      {
        accession: acc,
        description: info.title,
        organism: info.organism,
        existsInDB: false,
        linkedRefseq: null,
      },
    ];
    setUniProtItems(updated);
    setUniprotList(updated);
    setUniprotInput("");
    setUniprotSuggestions([]);
  }

  // ====================================================
  // REFSEQ: AUTOCOMPLETE + ENTrez protein
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
    const esearchUrl = `${ENTREZ_BASE}/esearch.fcgi?db=protein&retmode=json&term=${encodeURIComponent(
      accession
    )}[accn]`;
    const r1 = await fetch(PROXY + encodeURIComponent(esearchUrl));
    const j1 = await r1.json();
    const uid = j1.esearchresult?.idlist?.[0];
    if (!uid) return null;

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
      const updated = [
        ...refseqItems,
        {
          accession: row.refseq_accession,
          description: row.description || "",
          organism: "",
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

    const updated2 = [
      ...refseqItems,
      {
        accession: acc,
        description: info.title,
        organism: "",
        existsInDB: false,
      },
    ];
    setRefseqItems(updated2);
    setRefseqList(updated2);
    setRefseqInput("");
    setRefseqSuggestions([]);
  }

  // ====================================================
  // CONFIRMAR I CONTINUAR (UN SOL BOTÓ AL FINAL)
  // ====================================================

  function handleFinalConfirm() {
    setMessage("");

    if (!tf) {
      setMessage("Please select or create a TF before continuing.");
      return;
    }

    setGenomeList(genomeItems);
    setUniprotList(uniProtItems);
    setRefseqList(refseqItems);

    setStrainData({
      sameStrainGenome,
      sameStrainTF,
      organismTFBindingSites: bindingOrganism,
      organismReportedTF: reportedTFOrganism,
      promoterInfo,
      expressionInfo,
    });

    goToNextStep();
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

        <input
          className="form-control flex-1"
          value={searchName}
          placeholder="Example: LexA"
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
            <strong>TF Description:</strong> {tfRow.description || "—"}
          </p>
          <p>
            <strong>Family Description:</strong>{" "}
            {tfRow.family_description || "—"}
          </p>
        </div>
      )}

      {/* CREATE NEW TF FORM */}
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
              {families.map((f) => (
                <option key={f.tf_family_id} value={f.tf_family_id}>
                  {f.name}
                </option>
              ))}
            </select>

            <button
              type="button"
              className="btn mt-2"
              onClick={() => setShowNewFamilyForm(true)}
            >
              + Add New Family
            </button>
          </div>

          {/* NEW FAMILY FIELDS */}
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

          <button className="btn" onClick={handleCreateTF}>
            Save TF (no deploy yet)
          </button>
        </div>
      )}

      {/* ======================== GENOME SECTION ======================== */}
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Genome NCBI accession number</h3>
        <p className="text-sm text-muted">
          Paste the NCBI GenBank genome accession number for the species closest
          to the reported species/strain (e.g. NC_000913.2). You can add more
          than one chromosome.
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

        {/* checkbox igual que CollectTF */}
        <div className="mt-2 text-sm">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={sameStrainGenome}
              onChange={(e) => setSameStrainGenome(e.target.checked)}
            />
            <span>
              This is the exact same strain as reported in the manuscript for
              the sites.
            </span>
          </label>
        </div>

        {/* autocomplete list */}
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

        {/* lista de genomes añadidos */}
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

        {/* Organism TF binding sites are reported in */}
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
              If the work you are reporting uses a strain different from the
              selected RefSeq genome, please type/paste the original strain
              here. This allows us to keep track of the correspondence between
              reported and mapped strains.
            </p>
          </div>
        )}
      </div>

      {/* ======================== UNIPROT SECTION ======================== */}
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">TF UniProt accession number</h3>
        <p className="text-sm text-muted">
          Paste the NCBI TF protein accession number for the species closest to
          the reported species/strain. You can add more than one TF.
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
                {u.existsInDB && " (from DB)"}
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
          Enter the RefSeq equivalent TF protein accession number for the
          species closest to the reported species/strain (e.g. NP_799324). You
          can add more than one TF.
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

        {/* checkbox strain TF */}
        <div className="mt-2 text-sm">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={sameStrainTF}
              onChange={(e) => setSameStrainTF(e.target.checked)}
            />
            <span>
              This is the exact same strain as reported in the manuscript for
              the TF.
            </span>
          </label>
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
                {r.existsInDB && " (from DB)"}
              </li>
            ))}
          </ul>
        )}

        {/* Organism of origin for reported TF */}
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
              If the work you are reporting uses a strain different from the
              selected RefSeq genome, please type/paste the original strain
              here. This helps tracking the correspondence between reported and
              mapped strains.
            </p>
          </div>
        )}
      </div>

      {/* ======================== PROMOTER / EXPRESSION FLAGS ======================== */}
      <div className="space-y-3 mt-4 text-sm">
        <label className="inline-flex items-start gap-2">
          <input
            type="checkbox"
            checked={promoterInfo}
            onChange={(e) => setPromoterInfo(e.target.checked)}
          />
          <span>
            The manuscript contains promoter information. <br />
            <span className="text-xs text-muted">
              Check if the paper provides experimental data on the structure and
              sequence of a TF-regulated promoter.
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
            The manuscript contains expression data. <br />
            <span className="text-xs text-muted">
              Check if the paper provides experimental support for TF-mediated
              regulation of genes (e.g. differential gene expression).
            </span>
          </span>
        </label>
      </div>

      {/* BOTÓN ÚNICO DE CONFIRMACIÓN */}
      <div className="mt-6">
        <button className="btn" onClick={handleFinalConfirm}>
          Confirm and continue →
        </button>
      </div>
    </div>
  );
}

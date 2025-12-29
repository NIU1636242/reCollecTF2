import { useEffect, useMemo, useState } from "react";
import { useCuration } from "../../context/CurationContext";
import { runQuery } from "../../db/queryExecutor";
import { dispatchWorkflow } from "../../utils/serverless";

// --------------------
// Helpers
// --------------------
function esc(str) {
  return String(str ?? "").replace(/'/g, "''");
}

function normalizeEco(raw) {
  if (!raw) return "";
  let s = String(raw).trim().toUpperCase();
  if (!s) return "";
  if (!s.startsWith("ECO:")) s = "ECO:" + s;
  return s;
}

function isDoi(v) {
  return typeof v === "string" && v.includes("/");
}

function isPmid(v) {
  return typeof v === "string" && /^\d+$/.test(v.trim());
}

function truthyBool(v) {
  return v ? 1 : 0;
}

// Reconstruct selected hit from step4Data
function getSelectedHitForSite(site, step4Data) {
  const sel = step4Data?.choice?.[site];
  if (!sel) return null;

  if (sel.startsWith("ex-")) {
    const idx = Number(sel.split("-")[1]);
    return step4Data.exactHits?.[site]?.[idx] || null;
  }
  if (sel.startsWith("fz-")) {
    const idx = Number(sel.split("-")[1]);
    return step4Data.fuzzyHits?.[site]?.[idx] || null;
  }
  return null;
}

// --------------------
// Component
// --------------------
export default function Step7CurationInfo() {
  const {
    publication,
    tf,
    genomeList,
    uniprotList,
    refseqList,
    strainData,
    techniques,
    step4Data,
    step5Data,
    step6Data,
  } = useCuration();

  // UI state
  const REVISION_REASONS = useMemo(
    () => [
      { value: "None", label: "None" },
      { value: "No comparable genome in NCBI", label: "No comparable genome in NCBI" },
      { value: "Matching genome still in progress", label: "Matching genome still in progress" },
      { value: "No comparable TF protein sequence in NCBI", label: "No comparable TF protein sequence in NCBI" },
      { value: "Other reason (specify in notes)", label: "Other reason (specify in notes)" },
    ],
    []
  );

  const [revisionReason, setRevisionReason] = useState("None");
  const [curationComplete, setCurationComplete] = useState(true);
  const [notes, setNotes] = useState("");
  const [submitChecked, setSubmitChecked] = useState(false);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  // Basic guardrails
  const canSubmit = useMemo(() => {
    return (
      publication &&
      tf &&
      genomeList?.length > 0 &&
      uniprotList?.length > 0 &&
      refseqList?.length > 0 &&
      step4Data?.sites?.length > 0 &&
      step5Data?.annotations &&
      submitChecked &&
      !loading
    );
  }, [
    publication,
    tf,
    genomeList,
    uniprotList,
    refseqList,
    step4Data,
    step5Data,
    submitChecked,
    loading,
  ]);

  // Validate techniques: if any ECO is missing in DB and has no metadata -> block
  async function validateTechniquesBeforeSubmit() {
    const list = (techniques || []).map((t) =>
      typeof t === "string" ? { eco: normalizeEco(t) } : { ...t, eco: normalizeEco(t.eco || t.EO_term || t.code) }
    );

    // Remove empties
    const clean = list.filter((x) => x.eco);

    // If no techniques, it's allowed (depends on your pipeline rules)
    if (clean.length === 0) return { ok: true, normalized: [] };

    // Find which exist
    const ecoValues = clean.map((x) => x.eco);
    const placeholders = ecoValues.map(() => "?").join(",");

    const rows = await runQuery(
      `
      SELECT EO_term
      FROM core_experimentaltechnique
      WHERE EO_term IN (${placeholders})
    `,
      ecoValues
    );

    const existing = new Set(rows.map((r) => r.EO_term));

    const missing = clean.filter((x) => !existing.has(x.eco));
    if (missing.length === 0) return { ok: true, normalized: clean };

    // Missing techniques must have enough info to create them
    // Required minimal: description (optional but recommended), and ideally categoryId to fill bridge.
    // If they don't have categoryId, we can still insert the technique row but not category relation.
    // However, your Step3 requirement expects category; so we block unless categoryId is provided.
    const missingWithoutCategory = missing.filter((x) => !x.categoryId && !x.category_id && !x.selectedCategory);
    if (missingWithoutCategory.length) {
      return {
        ok: false,
        error:
          "Hay técnicas ECO que NO existen en la base de datos y tu Step3 actual solo guarda el código (sin categoría/descripcion). " +
          "Vuelve a Step3 y añade esas técnicas como 'nuevas' (o adapta Step3 para guardar categoryId+description en el Context). " +
          "ECO faltantes: " +
          missingWithoutCategory.map((m) => m.eco).join(", "),
      };
    }

    return { ok: true, normalized: clean };
  }

  // Build SQL script
  async function buildSqlScript(normalizedTechniques) {
    // -------------------------
    // Publication: find by PMID or DOI
    // -------------------------
    const pubIdClause = publication?.pmid
      ? `pmid='${esc(publication.pmid)}'`
      : publication?.doi && publication.doi !== "No DOI"
        ? `doi='${esc(publication.doi)}'`
        : null;

    if (!pubIdClause) {
      throw new Error("No se puede identificar la publicación (falta PMID y DOI).");
    }

    // -------------------------
    // TF / Family (ensure)
    // Your Step2 stores either:
    //  - existing TF row: has TF_id
    //  - new TF object: {isNew:true, name, description, isNewFamily, newFamilyName, newFamilyDesc, family_id, family}
    // -------------------------
    const tfIsExisting = !!tf?.TF_id;
    const tfName = tf?.name || "";
    if (!tfName.trim()) throw new Error("TF inválido: falta nombre.");

    // Family
    const wantsNewFamily = !!tf?.isNewFamily;
    const newFamilyName = tf?.newFamilyName || tf?.family || "";
    const newFamilyDesc = tf?.newFamilyDesc || tf?.family_description || "";
    const existingFamilyId = tf?.family_id || tf?.familyId || null;

    // -------------------------
    // Genomes + TF instances
    // -------------------------
    const genomes = genomeList || [];
    const uni = uniprotList || [];
    const ref = refseqList || [];

    // -------------------------
    // Sites / annotations / regulation
    // -------------------------
    const sites = step4Data?.sites || [];
    const annotations = step5Data?.annotations || {};
    const regulation = step6Data || {};

    // -------------------------
    // Curation info
    // -------------------------
    const requiresRevision = revisionReason !== "None";
    const revisionText = revisionReason === "None" ? "" : revisionReason;

    // promoter/expression flags from Step2
    const containsPromoter = truthyBool(strainData?.promoterInfo);
    const containsExpression = truthyBool(strainData?.expressionInfo);

    // -------------------------
    // SQL generation
    // -------------------------
    const sql = [];

    sql.push("BEGIN TRANSACTION;");

    // Temp tables to store ids
    sql.push("DROP TABLE IF EXISTS _tmp_curation;");
    sql.push("CREATE TEMP TABLE _tmp_curation(id INTEGER);");

    sql.push("DROP TABLE IF EXISTS _tmp_sites;");
    sql.push(
      "CREATE TEMP TABLE _tmp_sites(site TEXT PRIMARY KEY, site_instance_id INTEGER, curation_siteinstance_id INTEGER);"
    );

    // 1) Ensure publication exists
    // Insert minimal fields (some columns may be nullable; keep it simple)
    sql.push(`
      INSERT OR IGNORE INTO core_publication (pmid, doi, title, authors, journal, publication_date)
      VALUES (
        ${publication.pmid ? `'${esc(publication.pmid)}'` : "NULL"},
        ${publication.doi && publication.doi !== "No DOI" ? `'${esc(publication.doi)}'` : "NULL"},
        '${esc(publication.title)}',
        '${esc(publication.authors)}',
        '${esc(publication.journal)}',
        '${esc(publication.pubdate)}'
      );
    `);

    // Update flags/notes that may live in publication table (your ER shows them)
    sql.push(`
      UPDATE core_publication
      SET
        contains_promoter_data = ${containsPromoter},
        contains_expression_data = ${containsExpression},
        submission_notes = '${esc(notes)}',
        curation_complete = ${truthyBool(curationComplete)}
      WHERE ${pubIdClause};
    `);

    // 2) Ensure family / TF
    if (!tfIsExisting) {
      if (wantsNewFamily) {
        if (!newFamilyName.trim()) throw new Error("Falta el nombre de la nueva TF family.");
        sql.push(`
          INSERT OR IGNORE INTO core_tffamily (name, description)
          VALUES ('${esc(newFamilyName)}', '${esc(newFamilyDesc)}');
        `);
      }

      // Determine family_id expression
      let familyExpr = "NULL";
      if (wantsNewFamily) {
        familyExpr = `(SELECT tf_family_id FROM core_tffamily WHERE name='${esc(newFamilyName)}' LIMIT 1)`;
      } else if (existingFamilyId) {
        familyExpr = Number(existingFamilyId);
      } else if (tf?.family) {
        // fallback: try by name
        familyExpr = `(SELECT tf_family_id FROM core_tffamily WHERE name='${esc(tf.family)}' LIMIT 1)`;
      }

      sql.push(`
        INSERT OR IGNORE INTO core_tf (name, family_id, description)
        VALUES (
          '${esc(tfName)}',
          ${familyExpr},
          '${esc(tf.description || "")}'
        );
      `);
    }

    // 3) Ensure genomes exist
    genomes.forEach((g) => {
      const acc = g.accession;
      const organism = g.organism || g.description || "";
      sql.push(`
        INSERT OR IGNORE INTO core_genome (genome_accession, organism)
        VALUES ('${esc(acc)}', '${esc(organism)}');
      `);
    });

    // 4) Ensure TF instances exist
    // Strategy: create by UniProt (preferred), then ensure RefSeq, link both to same TF if possible.
    // We insert separate rows if needed (schema may allow both in same row).
    // We'll attempt to insert using both columns when we can pair them by index.
    const maxLen = Math.max(uni.length, ref.length);

    for (let i = 0; i < maxLen; i++) {
      const u = uni[i];
      const r = ref[i];

      const uniprotAcc = u?.accession || "";
      const refseqAcc = r?.accession || "";

      if (!uniprotAcc && !refseqAcc) continue;

      const desc = (u?.description || r?.description || "").trim();

      sql.push(`
        INSERT OR IGNORE INTO core_tfinstance (uniprot_accession, refseq_accession, description, TF_id)
        VALUES (
          ${uniprotAcc ? `'${esc(uniprotAcc)}'` : "NULL"},
          ${refseqAcc ? `'${esc(refseqAcc)}'` : "NULL"},
          '${esc(desc)}',
          (SELECT TF_id FROM core_tf WHERE LOWER(name)=LOWER('${esc(tfName)}') LIMIT 1)
        );
      `);

      // If row existed but TF_id was NULL, update it
      if (uniprotAcc) {
        sql.push(`
          UPDATE core_tfinstance
          SET TF_id = (SELECT TF_id FROM core_tf WHERE LOWER(name)=LOWER('${esc(tfName)}') LIMIT 1)
          WHERE uniprot_accession='${esc(uniprotAcc)}' AND (TF_id IS NULL OR TF_id='');
        `);
      }
      if (refseqAcc) {
        sql.push(`
          UPDATE core_tfinstance
          SET TF_id = (SELECT TF_id FROM core_tf WHERE LOWER(name)=LOWER('${esc(tfName)}') LIMIT 1)
          WHERE refseq_accession='${esc(refseqAcc)}' AND (TF_id IS NULL OR TF_id='');
        `);
      }
    }

    // 5) Ensure experimental techniques exist (only if missing and have metadata)
    // normalizedTechniques: [{eco, categoryId?, description? ...}] or existing ones
    for (const t of normalizedTechniques) {
      const eco = t.eco;
      const desc = t.description || t.techDescription || "";
      const categoryId = t.categoryId || t.category_id || t.selectedCategory || null;

      // Insert technique if missing
      sql.push(`
        INSERT OR IGNORE INTO core_experimentaltechnique (name, description, preset_function, EO_term)
        VALUES (NULL, '${esc(desc)}', NULL, '${esc(eco)}');
      `);

      // Link category if provided
      if (categoryId) {
        sql.push(`
          INSERT OR IGNORE INTO core_experimentaltechnique_categories (experimentaltechnique_id, experimentaltechniquecategory_id)
          VALUES (
            (SELECT technique_id FROM core_experimentaltechnique WHERE EO_term='${esc(eco)}' LIMIT 1),
            ${Number(categoryId)}
          );
        `);
      }
    }

    // 6) Create curation + store id
    // Minimal fields + reason in notes
    const combinedNotes = [revisionText ? `Revision reason: ${revisionText}` : null, notes ? notes : null]
      .filter(Boolean)
      .join("\n");

    sql.push(`
      INSERT INTO core_curation (
        publication_id,
        notes,
        requires_revision,
        forms_complex
      )
      VALUES (
        (SELECT publication_id FROM core_publication WHERE ${pubIdClause} LIMIT 1),
        '${esc(combinedNotes)}',
        ${truthyBool(requiresRevision)},
        0
      );
    `);

    sql.push(`INSERT INTO _tmp_curation(id) VALUES (last_insert_rowid());`);

    // 7) Link curation to TF instances (from UniProt + RefSeq lists)
    // We link by both accessions if present
    for (const u of uni) {
      const uniprotAcc = u?.accession;
      if (!uniprotAcc) continue;
      sql.push(`
        INSERT OR IGNORE INTO core_curation_TF_instances (curation_id, tfinstance_id)
        VALUES (
          (SELECT id FROM _tmp_curation),
          (SELECT TF_instance_id FROM core_tfinstance WHERE uniprot_accession='${esc(uniprotAcc)}' LIMIT 1)
        );
      `);
    }
    for (const r of ref) {
      const refseqAcc = r?.accession;
      if (!refseqAcc) continue;
      sql.push(`
        INSERT OR IGNORE INTO core_curation_TF_instances (curation_id, tfinstance_id)
        VALUES (
          (SELECT id FROM _tmp_curation),
          (SELECT TF_instance_id FROM core_tfinstance WHERE refseq_accession='${esc(refseqAcc)}' LIMIT 1)
        );
      `);
    }

    // 8) Sites: create siteinstance + curation_siteinstance and store ids in temp
    // We create one row per reported site using chosen mapping (acc,start,end,strand)
    for (const site of sites) {
      const hit = getSelectedHitForSite(site, step4Data);
      if (!hit) continue;

      const genomeAcc = hit.acc;
      const start = Number(hit.start) + 1; // your UI shows 1-based
      const end = Number(hit.end) + 1;
      const strand = hit.strand || "+";
      const mappedSeq = hit.match || site;

      // Insert siteinstance
      sql.push(`
        INSERT INTO core_siteinstance (seq, genome_id, start, end, strand)
        VALUES (
          '${esc(mappedSeq)}',
          (SELECT genome_id FROM core_genome WHERE genome_accession='${esc(genomeAcc)}' LIMIT 1),
          ${start},
          ${end},
          '${esc(strand)}'
        );
      `);

      // Save site_instance_id into temp table
      sql.push(`
        INSERT OR REPLACE INTO _tmp_sites(site, site_instance_id, curation_siteinstance_id)
        VALUES ('${esc(site)}', last_insert_rowid(), NULL);
      `);

      // Insert curation_siteinstance
      const ann = annotations[site] || {};
      const tfType = ann.tfType || "not specified";
      const tfFunc = ann.tfFunc || "not specified";

      // NOTE: your ER shows curation_siteinstance has curation_siteinstance_id, curation_id, site_instance_id, annotated_seq, TF_type, TF_function, quantitative_value, obsolete?, etc.
      // We'll fill the common columns.
      sql.push(`
        INSERT INTO core_curation_siteinstance (curation_id, site_instance_id, annotated_seq, TF_type, TF_function, is_high_throughput)
        VALUES (
          (SELECT id FROM _tmp_curation),
          (SELECT site_instance_id FROM _tmp_sites WHERE site='${esc(site)}'),
          '${esc(site)}',
          '${esc(tfType)}',
          '${esc(tfFunc)}',
          0
        );
      `);

      // Save curation_siteinstance_id
      sql.push(`
        UPDATE _tmp_sites
        SET curation_siteinstance_id = last_insert_rowid()
        WHERE site='${esc(site)}';
      `);

      // 9) Link techniques to this site, only if ann.useTechniques = true
      if (ann.useTechniques) {
        for (const t of normalizedTechniques) {
          const eco = normalizeEco(typeof t === "string" ? t : t.eco);
          if (!eco) continue;

          sql.push(`
            INSERT OR IGNORE INTO core_curation_siteinstance_experimental_techniques
              (curation_siteinstance_id, experimentaltechnique_id)
            VALUES (
              (SELECT curation_siteinstance_id FROM _tmp_sites WHERE site='${esc(site)}'),
              (SELECT technique_id FROM core_experimentaltechnique WHERE EO_term='${esc(eco)}' LIMIT 1)
            );
          `);
        }
      }

      // 10) Regulation: insert core_regulation rows for selected genes (by locus_tag)
      const regGenes = regulation?.[site]?.regulatedGenes || [];
      for (const g of regGenes) {
        const locus = g?.locus;
        if (!locus) continue;

        sql.push(`
          INSERT OR IGNORE INTO core_regulation (curation_site_instance_id, gene_id, evidence_type, meta_site_id)
          VALUES (
            (SELECT curation_siteinstance_id FROM _tmp_sites WHERE site='${esc(site)}'),
            (SELECT gene_id FROM core_gene WHERE locus_tag='${esc(locus)}' LIMIT 1),
            NULL,
            NULL
          );
        `);
      }
    }

    // 11) Final update of curation flags if those columns exist (safe enough even if redundant)
    sql.push(`
      UPDATE core_curation
      SET
        requires_revision = ${truthyBool(requiresRevision)},
        notes = '${esc(combinedNotes)}'
      WHERE curation_id = (SELECT id FROM _tmp_curation);
    `);

    sql.push("COMMIT;");

    return sql.join("\n");
  }

  async function handleSubmit() {
    setMsg("");

    if (!submitChecked) {
      setMsg("Debes marcar 'I want to submit this curation' para enviar.");
      return;
    }
    if (!publication) {
      setMsg("Falta Step1 (publication).");
      return;
    }
    if (!tf) {
      setMsg("Falta Step2 (TF).");
      return;
    }
    if (!step4Data?.sites?.length) {
      setMsg("Falta Step4 (reported sites).");
      return;
    }
    if (!step5Data?.annotations) {
      setMsg("Falta Step5 (site annotation).");
      return;
    }

    setLoading(true);
    try {
      const techCheck = await validateTechniquesBeforeSubmit();
      if (!techCheck.ok) {
        setMsg(techCheck.error);
        setLoading(false);
        return;
      }

      const sqlString = await buildSqlScript(techCheck.normalized);

      await dispatchWorkflow({
        inputs: { queries: sqlString },
      });

      setMsg(
        "✅ Curación enviada. La base de datos se actualizará automáticamente tras el workflow y redeploy."
      );
    } catch (e) {
      console.error(e);
      setMsg(`❌ Error al enviar: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Step 7 – Curation information</h2>

      {/* Revision required */}
      <div className="bg-surface border border-border rounded p-4 space-y-3">
        <div>
          <label className="block font-medium mb-1">Revision required</label>
          <select
            className="form-control"
            value={revisionReason}
            onChange={(e) => setRevisionReason(e.target.value)}
          >
            {REVISION_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>

          <p className="text-xs text-muted mt-1">
            Select, if needed, the reason why this curation may require revision.
          </p>
        </div>

        {/* Complete */}
        <label className="inline-flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={curationComplete}
            onChange={(e) => setCurationComplete(e.target.checked)}
          />
          <span>
            <div className="font-medium">Curation for this paper is complete</div>
            <div className="text-xs text-muted">
              Check if there are no more curations pending for this paper.
            </div>
          </span>
        </label>

        {/* Notes */}
        <div>
          <label className="block font-medium mb-1">Notes</label>
          <textarea
            className="form-control w-full h-40"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any additional notes on the curation process..."
          />
          <p className="text-xs text-muted mt-1">
            Include any relevant notes (e.g., why sites were left out, surrogate genome choice, etc.).
          </p>
        </div>

        {/* Submit checkbox */}
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={submitChecked}
            onChange={(e) => setSubmitChecked(e.target.checked)}
          />
          <span className="text-red-400">I want to submit this curation</span>
        </label>

        {!submitChecked && (
          <div className="text-xs text-red-400">
            This field is required. Check to submit when you click "submit curation".
          </div>
        )}
      </div>

      {/* Buttons */}
      <div className="flex items-center gap-3">
        <button
          className="btn"
          onClick={handleSubmit}
          disabled={!canSubmit}
          title={!canSubmit ? "Complete required steps and check submit box." : ""}
        >
          {loading ? "Submitting..." : "Submit curation"}
        </button>
      </div>

      {msg && (
        <div
          className={`text-sm ${
            msg.startsWith("✅") ? "text-green-400" : "text-red-400"
          }`}
        >
          {msg}
        </div>
      )}
    </div>
  );
}

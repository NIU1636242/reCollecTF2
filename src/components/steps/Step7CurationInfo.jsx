// src/components/steps/Step7CurationInfo.jsx
import { useMemo, useState } from "react";
import { useCuration } from "../../context/CurationContext";
import { dispatchWorkflow } from "../../utils/serverless";

// --------------------
// Helpers
// --------------------
function esc(str) {
  return String(str ?? "").replace(/'/g, "''");
}

function truthyBool(v) {
  return v ? 1 : 0;
}

function pickFirstNonEmpty(...vals) {
  for (const v of vals) {
    if (v === 0) return 0;
    if (v === false) return false;
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
}

function getStep5ForSite(step5Data, site) {
  return step5Data?.annotations?.[site] || null;
}


function normalizeStrand(str) {
  if (str === "-" || str === -1) return -1;
  return 1;
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
    setStep7Data,
  } = useCuration();

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

  // UI state
  const [revisionReason, setRevisionReason] = useState("None");
  const [curationComplete, setCurationComplete] = useState(true);
  const [notes, setNotes] = useState("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const canSubmit = useMemo(() => {
    return !!publication && !!tf?.name && !!step4Data && !loading;
  }, [publication, tf, step4Data, loading]);

  // --------------------
  // BUILD SQL (full insert)
  // --------------------
  function buildFullSql() {
    if (!publication) throw new Error("Missing publication (Step 1).");
    if (!tf?.name) throw new Error("Missing TF name (Step 2).");
    if (!step4Data?.sites?.length) throw new Error("Missing sites (Step 4).");

    const pub = publication;

    const pubTitle = pickFirstNonEmpty(pub?.title, "");
    const pubAuthors = pickFirstNonEmpty(pub?.authors, "");
    const pubJournal = pickFirstNonEmpty(pub?.journal, "");
    const pubDate = pickFirstNonEmpty(pub?.pubdate, "");

    const pmid = pickFirstNonEmpty(pub?.pmid, "");
    const doi = pickFirstNonEmpty(pub?.doi, "");

    // Use PMID if possible, otherwise DOI as "key"
    const pubKeyWhere = pmid
      ? `pmid='${esc(pmid)}'`
      : `doi='${esc(doi)}'`;

    const tfName = String(tf.name).trim();

    // family id detection
    const rawFamilyId =
      tf?.family_id ??
      tf?.familyId ??
      tf?.familyID ??
      tf?.family;
    const familyIdNum = Number(rawFamilyId);
    const hasFamilyId = Number.isFinite(familyIdNum) && familyIdNum > 0;

    const familyName = pickFirstNonEmpty(tf?.familyName, tf?.family_name, `AutoFamily:${tfName}`);

    // Uniprot/refseq
    const uniAcc = pickFirstNonEmpty(uniprotList?.[0], tf?.uniprot_accession, tf?.uniprot, "");
    const refAcc = pickFirstNonEmpty(refseqList?.[0], tf?.refseq_accession, tf?.refseq, "");

    // Step2 organism strings
    const siteSpecies = pickFirstNonEmpty(strainData?.organismTFBindingSites, "");
    const tfSpecies = pickFirstNonEmpty(strainData?.organismReportedTF, siteSpecies, "");
    const containsPromoter = truthyBool(strainData?.promoterInfo);
    const containsExpression = truthyBool(strainData?.expressionInfo);

    const requiresRevision = revisionReason !== "None";
    const submissionNotes = [requiresRevision ? `Revision reason: ${revisionReason}` : "", notes].filter(Boolean).join("\n");

    // Step4
    const selectedBySite = step4Data?.selectedBySite || {};
    const siteType = pickFirstNonEmpty(step4Data?.siteType, "");

    // In DB, we’ll create one curation per submission
    const sql = [];
    sql.push("PRAGMA foreign_keys = ON;");
    sql.push("BEGIN TRANSACTION;");

    // --------------------
    // 1) Publication upsert
    // --------------------
    // core_publication fields (from your sqlite schema):
    // publication_id, pmid, doi, title, authors, journal, pub_date,
    // publication_type, reported_TF, reported_species, contains_promoter_data,
    // contains_expression_data, curation_complete, submission_notes
    sql.push(`
INSERT INTO core_publication
  (pmid, doi, title, authors, journal, pub_date,
   publication_type, reported_TF, reported_species,
   contains_promoter_data, contains_expression_data,
   curation_complete, submission_notes)
SELECT
  ${pmid ? `'${esc(pmid)}'` : "NULL"},
  ${doi ? `'${esc(doi)}'` : "NULL"},
  '${esc(pubTitle)}',
  '${esc(pubAuthors)}',
  '${esc(pubJournal)}',
  '${esc(pubDate)}',
  'ARTICLE',
  '${esc(tfName)}',
  '${esc(siteSpecies)}',
  ${containsPromoter},
  ${containsExpression},
  ${truthyBool(curationComplete)},
  '${esc(submissionNotes)}'
WHERE NOT EXISTS (
  SELECT 1 FROM core_publication WHERE ${pubKeyWhere}
);
    `.trim());

    // Update key fields (safe) if publication already existed
    sql.push(`
UPDATE core_publication
SET
  title = CASE WHEN title IS NULL OR title='' THEN '${esc(pubTitle)}' ELSE title END,
  authors = CASE WHEN authors IS NULL OR authors='' THEN '${esc(pubAuthors)}' ELSE authors END,
  journal = CASE WHEN journal IS NULL OR journal='' THEN '${esc(pubJournal)}' ELSE journal END,
  pub_date = CASE WHEN pub_date IS NULL OR pub_date='' THEN '${esc(pubDate)}' ELSE pub_date END,
  reported_TF = CASE WHEN reported_TF IS NULL OR reported_TF='' THEN '${esc(tfName)}' ELSE reported_TF END,
  reported_species = CASE WHEN reported_species IS NULL OR reported_species='' THEN '${esc(siteSpecies)}' ELSE reported_species END,
  contains_promoter_data = ${containsPromoter},
  contains_expression_data = ${containsExpression},
  curation_complete = ${truthyBool(curationComplete)},
  submission_notes = CASE
    WHEN submission_notes IS NULL OR submission_notes=''
    THEN '${esc(submissionNotes)}'
    ELSE submission_notes
  END
WHERE ${pubKeyWhere};
    `.trim());

    const publicationIdExpr = `(SELECT publication_id FROM core_publication WHERE ${pubKeyWhere} LIMIT 1)`;

    // --------------------
    // 2) TF Family + TF
    // --------------------
    if (!hasFamilyId) {
      sql.push(`
INSERT INTO core_tffamily (name, description)
SELECT '${esc(familyName)}', '${esc(submissionNotes)}'
WHERE NOT EXISTS (SELECT 1 FROM core_tffamily WHERE lower(name)=lower('${esc(familyName)}'));
      `.trim());
    }
    const familyIdExpr = hasFamilyId
      ? `${familyIdNum}`
      : `(SELECT tf_family_id FROM core_tffamily WHERE lower(name)=lower('${esc(familyName)}') LIMIT 1)`;

    sql.push(`
INSERT INTO core_tf (name, family_id, description)
SELECT '${esc(tfName)}', ${familyIdExpr}, '${esc(notes || "")}'
WHERE NOT EXISTS (SELECT 1 FROM core_tf WHERE lower(name)=lower('${esc(tfName)}'));
    `.trim());

    sql.push(`
UPDATE core_tf
SET family_id = COALESCE(family_id, ${familyIdExpr})
WHERE lower(name)=lower('${esc(tfName)}');
    `.trim());

    const tfIdExpr = `(SELECT tf_id FROM core_tf WHERE lower(name)=lower('${esc(tfName)}') LIMIT 1)`;

    // --------------------
    // 3) TF Instance (core_tfinstance)
    // --------------------
    // unique key likely = uniprot_accession
    // fields: TF_instance_id, refseq_accession, uniprot_accession, TF_id
    if (uniAcc) {
      sql.push(`
INSERT INTO core_tfinstance (refseq_accession, uniprot_accession, TF_id)
SELECT
  ${refAcc ? `'${esc(refAcc)}'` : "NULL"},
  '${esc(uniAcc)}',
  ${tfIdExpr}
WHERE NOT EXISTS (SELECT 1 FROM core_tfinstance WHERE uniprot_accession='${esc(uniAcc)}');
      `.trim());

      sql.push(`
UPDATE core_tfinstance
SET TF_id = COALESCE(TF_id, ${tfIdExpr}),
    refseq_accession = CASE
      WHEN refseq_accession IS NULL OR refseq_accession='' THEN ${refAcc ? `'${esc(refAcc)}'` : "refseq_accession"}
      ELSE refseq_accession
    END
WHERE uniprot_accession='${esc(uniAcc)}';
      `.trim());
    }

    const tfInstanceIdExpr = uniAcc
      ? `(SELECT TF_instance_id FROM core_tfinstance WHERE uniprot_accession='${esc(uniAcc)}' LIMIT 1)`
      : "NULL";

    // --------------------
    // 4) Curation row (core_curation)
    // --------------------
    // curator_id: take first existing curator
    const curatorIdExpr = `(SELECT curator_id FROM core_curator ORDER BY curator_id LIMIT 1)`;

    sql.push(`
INSERT INTO core_curation
  (TF_species, site_species, experimental_process, forms_complex,
   complex_notes, notes, last_modified, curator_id, publication_id, created, validated_by_id)
VALUES
  ('${esc(tfSpecies)}', '${esc(siteSpecies)}', '',
   0, '', '${esc(submissionNotes)}',
   datetime('now'), ${curatorIdExpr}, ${publicationIdExpr}, datetime('now'), NULL);
    `.trim());

    const curationIdExpr = `(SELECT curation_id FROM core_curation WHERE publication_id=${publicationIdExpr} ORDER BY curation_id DESC LIMIT 1)`;

    // Link TF instance to curation (if we have one)
    if (uniAcc) {
      sql.push(`
INSERT INTO core_curation_TF_instances (curation_id, tfinstance_id)
SELECT ${curationIdExpr}, ${tfInstanceIdExpr}
WHERE NOT EXISTS (
  SELECT 1 FROM core_curation_TF_instances
  WHERE curation_id=${curationIdExpr} AND tfinstance_id=${tfInstanceIdExpr}
);
      `.trim());
    }

    // --------------------
    // 5) Genomes + Genes (from genomeList + Step4 loaded genomes if available)
    // --------------------
    // We insert genomes for each accession in genomeList.
    const accessions = (genomeList || []).map((g) => g.accession).filter(Boolean);

    for (const acc of accessions) {
      // core_genome fields: genome_id, organism_name, genome_accession
      sql.push(`
INSERT INTO core_genome (organism_name, genome_accession)
SELECT '${esc(siteSpecies)}', '${esc(acc)}'
WHERE NOT EXISTS (SELECT 1 FROM core_genome WHERE genome_accession='${esc(acc)}');
      `.trim());
    }

    // Genes: if Step4 loaded them, Step4 keeps them in context "genomes".
    // But Step7 doesn't have that state here unless you add it to context usage.
    // If you DO have it, you can easily add `genomes` in the destructuring above.
    // For now: we will insert genes ONLY if step4Data.genesByAcc exists (optional).
    const genesByAcc = step4Data?.genesByAcc || null; // optional (if you decide to store it later)
    if (genesByAcc) {
      for (const [acc, genes] of Object.entries(genesByAcc)) {
        if (!Array.isArray(genes) || genes.length === 0) continue;
        const genomeIdExpr = `(SELECT genome_id FROM core_genome WHERE genome_accession='${esc(acc)}' LIMIT 1)`;

        for (const g of genes) {
          const locus = pickFirstNonEmpty(g?.locus, "");
          if (!locus) continue;
          const geneName = pickFirstNonEmpty(g?.geneLabel, g?.gene, "");
          const desc = pickFirstNonEmpty(g?.product, "");
          const start = Number(g?.start ?? 0);
          const end = Number(g?.end ?? 0);
          const strand = normalizeStrand(g?.strand);

          sql.push(`
INSERT INTO core_gene (locus_tag, name, description, start, end, strand, gene_type, genome_id)
SELECT
  '${esc(locus)}',
  '${esc(geneName)}',
  '${esc(desc)}',
  ${Number.isFinite(start) ? start : 0},
  ${Number.isFinite(end) ? end : 0},
  ${strand},
  'CDS',
  ${genomeIdExpr}
WHERE NOT EXISTS (
  SELECT 1 FROM core_gene
  WHERE genome_id=${genomeIdExpr} AND locus_tag='${esc(locus)}'
);
          `.trim());
        }
      }
    }

    // --------------------
    // 6) Techniques (Step3) insert + later link to each curated siteinstance
    // --------------------
    const techList = Array.isArray(techniques) ? techniques : [];
    for (const t of techList) {
      const EO = pickFirstNonEmpty(t?.eco, t?.EO_term, t?.EO, "");
      if (!EO) continue;

      const preset = pickFirstNonEmpty(t?.presetFunction, t?.preset_function, "");
      const name = pickFirstNonEmpty(t?.category, t?.name, EO);
      const desc = pickFirstNonEmpty(t?.description, "");

      sql.push(`
INSERT INTO core_experimentaltechnique (name, description, preset_function, EO_term)
SELECT '${esc(name)}', '${esc(desc)}', '${esc(preset)}', '${esc(EO)}'
WHERE NOT EXISTS (SELECT 1 FROM core_experimentaltechnique WHERE EO_term='${esc(EO)}');
      `.trim());
    }

    // Helper: list of technique id expressions (select by EO_term)
    const techIdExprs = techList
      .map((t) => pickFirstNonEmpty(t?.eco, t?.EO_term, t?.EO, ""))
      .filter(Boolean)
      .map((EO) => `(SELECT experimental_technique_id FROM core_experimentaltechnique WHERE EO_term='${esc(EO)}' LIMIT 1)`);

    // --------------------
    // 7) Sites: insert annotated / not annotated
    // --------------------
    const sites = step4Data.sites || [];

    for (const site of sites) {
      const bundle = selectedBySite?.[site] || { kind: "none", hit: null, nearbyGenes: [] };

      const s5 = getStep5ForSite(step5Data, site);

      const TF_type = pickFirstNonEmpty(s5?.tfType, "");
      const TF_function = pickFirstNonEmpty(s5?.tfFunc, "");

      const annotatedSeq = pickFirstNonEmpty(s5?.annotated_seq, s5?.annotatedSeq, "");
      const qv = s5?.quantitative_value ?? s5?.qval ?? s5?.qValue ?? null;
      const qvNum = Number(qv);
      const quantitativeValue = Number.isFinite(qvNum) ? qvNum : null;

      if (!bundle || bundle.kind === "none" || !bundle.hit) {
        // not annotated
        sql.push(`
INSERT INTO core_notannotatedsiteinstance (sequence, curation_id, TF_type, TF_function)
VALUES ('${esc(site)}', ${curationIdExpr},
        ${TF_type ? `'${esc(TF_type)}'` : "NULL"},
        ${TF_function ? `'${esc(TF_function)}'` : "NULL"});
        `.trim());
        continue;
      }

      const hit = bundle.hit;
      const acc = hit.acc;
      const hitStart0 = Number(hit.start ?? 0);
      const hitEnd0 = Number(hit.end ?? 0);
      const strand = normalizeStrand(hit.strand);

      const genomeIdExpr = `(SELECT genome_id FROM core_genome WHERE genome_accession='${esc(acc)}' LIMIT 1)`;

      // Insert site instance (avoid duplicates: same genome,start,end,strand,seq)
      sql.push(`
INSERT INTO core_siteinstance (seq, genome_id, start, end, strand)
SELECT
  '${esc(site)}',
  ${genomeIdExpr},
  ${hitStart0},
  ${hitEnd0},
  ${strand}
WHERE NOT EXISTS (
  SELECT 1 FROM core_siteinstance
  WHERE genome_id=${genomeIdExpr}
    AND start=${hitStart0} AND end=${hitEnd0} AND strand=${strand}
    AND seq='${esc(site)}'
);
      `.trim());

      const siteInstanceIdExpr = `(SELECT id FROM core_siteinstance
        WHERE genome_id=${genomeIdExpr}
          AND start=${hitStart0} AND end=${hitEnd0} AND strand=${strand}
          AND seq='${esc(site)}'
        ORDER BY id DESC LIMIT 1)`;

      // Insert curation_siteinstance
      sql.push(`
INSERT INTO core_curation_siteinstance
  (site_type, annotated_seq, quantitative_value, TF_type, TF_function, TF_instance_id, curation_id, site_instance_id)
VALUES
  ('${esc(siteType)}',
   ${annotatedSeq ? `'${esc(annotatedSeq)}'` : "NULL"},
   ${quantitativeValue === null ? "NULL" : quantitativeValue},
   ${TF_type ? `'${esc(TF_type)}'` : "NULL"},
   ${TF_function ? `'${esc(TF_function)}'` : "NULL"},
   ${uniAcc ? tfInstanceIdExpr : "NULL"},
   ${curationIdExpr},
   ${siteInstanceIdExpr});
      `.trim());

      const curationSiteInstanceIdExpr = `(SELECT id FROM core_curation_siteinstance
        WHERE curation_id=${curationIdExpr}
          AND site_instance_id=${siteInstanceIdExpr}
        ORDER BY id DESC LIMIT 1)`;

      // Link techniques to this curation_site_instance (if any techniques exist)
      // Link ONLY techniques checked in Step5 for this site
      const techMap = s5?.techniques || {};
      const selectedECOs = Object.keys(techMap).filter((eco) => techMap[eco] === true);

      for (const eco of selectedECOs) {
        const techIdExpr = `(SELECT experimental_technique_id
                       FROM core_experimentaltechnique
                       WHERE EO_term='${esc(eco)}'
                       LIMIT 1)`;

        sql.push(`
INSERT INTO core_curation_siteinstance_experimental_techniques
  (curation_site_instance_id, experimental_technique_id)
SELECT ${curationSiteInstanceIdExpr}, ${techIdExpr}
WHERE ${techIdExpr} IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM core_curation_siteinstance_experimental_techniques
    WHERE curation_site_instance_id=${curationSiteInstanceIdExpr}
      AND experimental_technique_id=${techIdExpr}
  );
  `.trim());
      }


      // --------------------
      // Regulations from Step6
      // --------------------
      const regsForSite = step6Data?.[site]?.regulatedGenes || [];
      if (Array.isArray(regsForSite) && regsForSite.length > 0) {
        for (const g of regsForSite) {
          const locus = pickFirstNonEmpty(g?.locus, "");
          if (!locus) continue;

          // gene_id in DB (if core_gene inserted / exists)
          const geneIdExpr = `(SELECT gene_id FROM core_gene
            WHERE locus_tag='${esc(locus)}' AND genome_id=${genomeIdExpr}
            ORDER BY gene_id DESC LIMIT 1)`;

          // evidence_type/mode: if you have these in your UI later, plug them here.
          const evidenceType = containsExpression ? "exp_verified" : "inferred";
          const mode = "UNKNOWN";

          sql.push(`
INSERT INTO core_regulation (evidence_type, mode, ref_pmid, gene_id, curation_site_instance_id)
SELECT
  '${esc(evidenceType)}',
  '${esc(mode)}',
  ${pmid ? `'${esc(pmid)}'` : "NULL"},
  ${geneIdExpr},
  ${curationSiteInstanceIdExpr}
WHERE ${geneIdExpr} IS NOT NULL;
          `.trim());
        }
      }
    }

    // Persist step7Data snapshot (optional in DB: here we just keep it client-side too)
    // End transaction
    sql.push("COMMIT;");

    return sql.join("\n\n");
  }

  async function handleSubmit() {
    setMsg("");
    setLoading(true);

    try {
      const sqlString = buildFullSql();

      await dispatchWorkflow({
        inputs: { queries: sqlString },
      });

      setStep7Data({
        revisionReason,
        curationComplete,
        notes,
        submittedAt: new Date().toISOString(),
      });

      setMsg("✅ Submit OK: se han insertado/actualizado publication, TF, curation, sites, techniques y regulations.");
    } catch (e) {
      console.error("Submit error full:", e);
      console.error("Submit error payload:", e?.payload);

      const details =
        typeof e?.payload === "string"
          ? e.payload
          : e?.payload
            ? JSON.stringify(e.payload, null, 2)
            : "";

      setMsg(`Error: ${e?.message || String(e)}\n\n${details}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Step 7 – Curation information</h2>

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
      </div>

      <div className="flex items-center gap-3">
        <button
          className="btn"
          onClick={handleSubmit}
          disabled={!canSubmit}
          title={!canSubmit ? "Need Step1 + Step2 TF + Step4 completed." : ""}
        >
          {loading ? "Submitting..." : "Submit curation"}
        </button>
      </div>

      {msg && (
        <div className={`text-sm ${msg.startsWith("✅") ? "text-green-400" : "text-red-400"}`}>
          {msg}
        </div>
      )}
    </div>
  );
}

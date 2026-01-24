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
function toStrandInt(s) {
  return String(s) === "-" ? -1 : 1;
}
function safeText(v, fallback = "") {
  const s = String(v ?? "").trim();
  return s.length ? s : fallback;
}

// --------------------
// Component
// --------------------
export default function Step7CurationInfo() {
  const {
    publication,
    tf,
    genomeList,
    strainData,
    techniques,
    step4Data,
    step5Data,
    step6Data,
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
    return !!tf?.name && !!publication?.title && !loading;
  }, [tf, publication, loading]);

  function buildSql() {
    // --------------------
    // Collect inputs
    // --------------------
    const tfName = safeText(tf?.name, "");
    if (!tfName) throw new Error("Missing TF name (Step 2).");

    const pubTitle = safeText(publication?.title, "");
    const pubAuthors = safeText(publication?.authors, "—");
    const pubJournal = safeText(publication?.journal, "—");
    const pubDate = safeText(publication?.pubdate, "—");
    const pubPmid = publication?.pmid ? Number(publication.pmid) : null;

    const requiresRevision = revisionReason !== "None";

    // Strain flags from Step2
    const containsPromoter = truthyBool(!!strainData?.promoterInfo);
    const containsExpression = truthyBool(!!strainData?.expressionInfo);

    // Organisms (use what you already capture in Step2)
    const siteSpecies = safeText(strainData?.organismTFBindingSites, "Unknown");
    const tfSpecies = safeText(strainData?.organismReportedTF, "Unknown");

    // Techniques list (Step3) -> map by ECO id (EO_term in DB)
    const techArr = Array.isArray(techniques) ? techniques : [];
    const techNormalized = techArr
      .map((t) => {
        const eco =
          (typeof t === "string" && t) ||
          t?.ecoId ||
          t?.eco ||
          t?.EO_term ||
          t?.id ||
          t?.code ||
          t?.identifier ||
          "";
        if (!eco) return null;
        return {
          eco: String(eco),
          name: String(t?.name || t?.label || eco),
        };
      })
      .filter(Boolean);

    // Step4 selections
    const selectedBySite = step4Data?.selectedBySite || {};
    const sites = step4Data?.sites || [];

    // Step5 annotations (tf type/function + techniques per site)
    const annotations = step5Data?.annotations || {};

    // Step6 regulation (genes selected by curator)
    const regulation = step6Data || {}; // { [site]: { regulatedGenes: [...] } }

    // --------------------
    // TF Family / TF / TF Instance
    // --------------------
    const rawFamilyId =
      tf?.family_id ??
      tf?.familyId ??
      tf?.familyID ??
      tf?.family;

    const familyIdNum = Number(rawFamilyId);
    const hasFamilyId = Number.isFinite(familyIdNum) && familyIdNum > 0;

    const familyName = safeText(tf?.family_name, "") || `AutoFamily:${tfName}`;
    const familyDesc = [requiresRevision ? `Revision reason: ${revisionReason}` : "", notes]
      .filter(Boolean)
      .join("\n");

    // These tables have NOT NULL description/notes, so never send NULL
    const tfDesc = safeText(tf?.description, "") || safeText(notes, "");
    const tfiDesc = safeText(notes, "");
    const tfiNotes = safeText(notes, "");

    // If you have these in Step2 context in the future, plug them here.
    const uniprotId = safeText(tf?.uniprot_id || tf?.uniprotId || tf?.uniprot, "UNKNOWN");
    const refseqId = safeText(tf?.refseq_id || tf?.refseqId || tf?.refseq, "UNKNOWN");

    // --------------------
    // Genomes used (from genomeList Step2)
    // core_genome columns: genome_id (PK), genome_accession, genome_dna_accession, genome_taxon_id, organism
    // We'll store genome_id as accession (works as string PK).
    // --------------------
    const genomesToInsert = (Array.isArray(genomeList) ? genomeList : [])
      .map((g) => String(g?.accession || "").trim())
      .filter(Boolean);

    // --------------------
    // Sites that have mapping (kind exact/fuzzy)
    // Insert core_siteinstance + core_curation_siteinstance
    // --------------------
    const mappedSites = [];
    for (const site of sites) {
      const bundle = selectedBySite?.[site];
      if (!bundle || !bundle.hit || (bundle.kind !== "exact" && bundle.kind !== "fuzzy")) continue;
      mappedSites.push({ site, bundle });
    }

    // --------------------
    // Build SQL
    // --------------------
    const sql = [];
    sql.push("PRAGMA foreign_keys = ON;");
    sql.push("BEGIN TRANSACTION;");

    // 0) Ensure a curator exists (we use a stable username)
    sql.push(`
INSERT OR IGNORE INTO core_curator (curator_type, username, email)
VALUES ('human', 'webcurator', 'webcurator@example.com');
    `.trim());

    sql.push(`
WITH curator_row AS (
  SELECT curator_id FROM core_curator WHERE username='webcurator' LIMIT 1
)
SELECT curator_id FROM curator_row;
    `.trim());

    // 1) Publication (NO DOI column!)
    // core_publication: pmid, title, authors, journal, publication_date, curation_complete,
    // requires_revision, contains_promoter_data, contains_expression_data, revision_reason, notes
    const pmidExpr = pubPmid !== null && Number.isFinite(pubPmid) ? String(pubPmid) : "NULL";

    sql.push(`
INSERT OR IGNORE INTO core_publication
(pmid, title, authors, journal, publication_date,
 curation_complete, requires_revision, contains_promoter_data, contains_expression_data,
 revision_reason, notes)
VALUES
(${pmidExpr},
 '${esc(pubTitle)}',
 '${esc(pubAuthors)}',
 '${esc(pubJournal)}',
 '${esc(pubDate)}',
 ${truthyBool(curationComplete)},
 ${truthyBool(requiresRevision)},
 ${containsPromoter},
 ${containsExpression},
 ${requiresRevision ? `'${esc(revisionReason)}'` : "NULL"},
 ${notes.trim() ? `'${esc(notes)}'` : "NULL"}
);
    `.trim());

    // Get publication_id reliably:
    // If PMID exists, use it; else fallback to title+journal+date.
    sql.push(`
SELECT publication_id FROM core_publication
WHERE
  (${pmidExpr} IS NOT NULL AND pmid = ${pmidExpr})
  OR
  (${pmidExpr} IS NULL AND title='${esc(pubTitle)}' AND journal='${esc(pubJournal)}' AND publication_date='${esc(pubDate)}')
ORDER BY publication_id DESC
LIMIT 1;
    `.trim());

    // 2) TF family
    if (!hasFamilyId) {
      sql.push(`
INSERT OR IGNORE INTO core_tffamily (name, description)
VALUES ('${esc(familyName)}', '${esc(familyDesc)}');
      `.trim());
    }

    const familyIdExpr = hasFamilyId
      ? `${familyIdNum}`
      : `(SELECT tf_family_id FROM core_tffamily WHERE name='${esc(familyName)}' ORDER BY tf_family_id DESC LIMIT 1)`;

    // 3) TF (description NOT NULL)
    sql.push(`
INSERT OR IGNORE INTO core_tf (name, family_id, description)
VALUES ('${esc(tfName)}', ${familyIdExpr}, '${esc(tfDesc)}');

UPDATE core_tf
SET
  family_id = COALESCE(family_id, ${familyIdExpr}),
  description = CASE
    WHEN description IS NULL OR description='' THEN '${esc(tfDesc)}'
    ELSE description
  END
WHERE lower(name)=lower('${esc(tfName)}');
    `.trim());

    // 4) TF instance (description + notes NOT NULL, uniprot_id/refseq_id NOT NULL)
    // tf_instance_id AUTOINC, so we insert and later select.
    sql.push(`
INSERT OR IGNORE INTO core_tfinstance (tf_id, uniprot_id, refseq_id, description, notes)
VALUES (
  (SELECT tf_id FROM core_tf WHERE lower(name)=lower('${esc(tfName)}') LIMIT 1),
  '${esc(uniprotId)}',
  '${esc(refseqId)}',
  '${esc(tfiDesc)}',
  '${esc(tfiNotes)}'
);
    `.trim());

    // 5) Curation (experimental_process NOT NULL, forms_complex NOT NULL, complex_notes NOT NULL)
    // We create it even if no sites map.
    sql.push(`
INSERT INTO core_curation
(TF_species, site_species, experimental_process, forms_complex, complex_notes, notes, publication_id, curator_id)
VALUES
('${esc(tfSpecies)}',
 '${esc(siteSpecies)}',
 'manual',
 0,
 '',
 ${notes.trim() ? `'${esc(notes)}'` : "NULL"},
 (
   SELECT publication_id FROM core_publication
   WHERE
     (${pmidExpr} IS NOT NULL AND pmid = ${pmidExpr})
     OR
     (${pmidExpr} IS NULL AND title='${esc(pubTitle)}' AND journal='${esc(pubJournal)}' AND publication_date='${esc(pubDate)}')
   ORDER BY publication_id DESC
   LIMIT 1
 ),
 (SELECT curator_id FROM core_curator WHERE username='webcurator' LIMIT 1)
);
    `.trim());

    // curation_id for later use
    sql.push(`
SELECT curation_id FROM core_curation
ORDER BY curation_id DESC
LIMIT 1;
    `.trim());

    // 6) Genomes (insert minimal rows)
    for (const acc of genomesToInsert) {
      sql.push(`
INSERT OR IGNORE INTO core_genome (genome_id, genome_accession, genome_dna_accession, genome_taxon_id, organism)
VALUES ('${esc(acc)}', '${esc(acc)}', '${esc(acc)}', '', '${esc(siteSpecies)}');
      `.trim());
    }

    // 7) Experimental techniques master rows (ensure EO_term exists)
    for (const t of techNormalized) {
      sql.push(`
INSERT OR IGNORE INTO core_experimentaltechnique (name, category, EO_term, description)
VALUES ('${esc(t.name)}', 'binding', '${esc(t.eco)}', '');
      `.trim());
    }

    // 8) Siteinstances + curation_siteinstance + techniques linking + genes + regulation
    // NOTE:
    // - core_siteinstance: (_seq, start, end, strand, genome_id)
    // - core_curation_siteinstance: (TF_type, TF_function, qval, creation_date, last_update, is_high_throughput, is_sig, significance_notes, site_instance_id, curation_id)
    // - join techniques: core_curation_siteinstance_experimental_techniques (curation_siteinstance_id, experimentaltechnique_id)
    // - genes: core_gene (locus_tag, genome_id, name, description, start, end, strand)
    // - regulation: core_regulation (curation_site_instance_id, gene_id, evidence_type)
    //
    for (const { site, bundle } of mappedSites) {
      const hit = bundle.hit;

      const acc = String(hit.acc || "").trim();
      if (!acc) continue;

      const seq = safeText(hit.match || hit.site || site, "");
      const start0 = Number(hit.start);
      const end0 = Number(hit.end);
      const strand = toStrandInt(hit.strand);

      // per-site annotation
      const ann = annotations?.[site] || {};
      const tfType = safeText(ann.tfType, "not specified");
      const tfFunc = safeText(ann.tfFunc, "not specified");
      const techMap = ann.techniques || {};

      // Insert site instance (ignore duplicates)
      sql.push(`
INSERT OR IGNORE INTO core_siteinstance (_seq, start, end, strand, genome_id)
VALUES ('${esc(seq)}', ${start0}, ${end0}, ${strand}, '${esc(acc)}');
      `.trim());

      // Insert curation_siteinstance (this is the row that gets technique links + regulation)
      sql.push(`
INSERT INTO core_curation_siteinstance
(TF_type, TF_function, qval, creation_date, last_update, is_high_throughput, is_sig, significance_notes, site_instance_id, curation_id)
VALUES
('${esc(tfType)}',
 '${esc(tfFunc)}',
 NULL,
 datetime('now'),
 datetime('now'),
 0,
 0,
 '',
 (SELECT site_instance_id FROM core_siteinstance
  WHERE genome_id='${esc(acc)}' AND start=${start0} AND end=${end0} AND strand=${strand} AND _seq='${esc(seq)}'
  ORDER BY site_instance_id DESC
  LIMIT 1
 ),
 (SELECT curation_id FROM core_curation ORDER BY curation_id DESC LIMIT 1)
);
      `.trim());

      // Techniques links (only checked ones)
      for (const ecoId of Object.keys(techMap || {})) {
        if (!techMap[ecoId]) continue;

        sql.push(`
INSERT OR IGNORE INTO core_curation_siteinstance_experimental_techniques
(curation_siteinstance_id, experimentaltechnique_id)
VALUES
(
 (SELECT curation_site_instance_id FROM core_curation_siteinstance ORDER BY curation_site_instance_id DESC LIMIT 1),
 (SELECT experimental_technique_id FROM core_experimentaltechnique WHERE EO_term='${esc(ecoId)}' LIMIT 1)
);
        `.trim());
      }

      // Genes: we insert ALL nearbyGenes so that regulations can reference them safely
      const nearbyGenes = Array.isArray(bundle.nearbyGenes) ? bundle.nearbyGenes : [];
      for (const g of nearbyGenes) {
        const locus = safeText(g?.locus, "");
        if (!locus) continue;

        const gName = safeText(g?.geneLabel, "");
        const gDesc = safeText(g?.product, "");
        const gStart = Number(g?.start);
        const gEnd = Number(g?.end);
        const gStrand = toStrandInt(g?.strand);

        sql.push(`
INSERT OR IGNORE INTO core_gene
(locus_tag, genome_id, name, description, start, end, strand)
VALUES
('${esc(locus)}', '${esc(acc)}', '${esc(gName)}', '${esc(gDesc)}', ${gStart}, ${gEnd}, ${gStrand});
        `.trim());
      }

      // Regulation: insert only genes selected in Step6
      const regulated = regulation?.[site]?.regulatedGenes || [];
      for (const g of regulated) {
        const locus = safeText(g?.locus, "");
        if (!locus) continue;

        sql.push(`
INSERT OR IGNORE INTO core_regulation
(curation_site_instance_id, gene_id, evidence_type)
VALUES
(
  (SELECT curation_site_instance_id FROM core_curation_siteinstance ORDER BY curation_site_instance_id DESC LIMIT 1),
  (SELECT gene_id FROM core_gene WHERE genome_id='${esc(acc)}' AND locus_tag='${esc(locus)}' LIMIT 1),
  'exp_verified'
);
        `.trim());
      }
    }

    sql.push("COMMIT;");
    return sql.join("\n\n");
  }

  async function handleSubmit() {
    setMsg("");
    setLoading(true);

    try {
      const sqlString = buildSql();

      const res = await dispatchWorkflow({
        inputs: { queries: sqlString },
      });

      // IMPORTANT: dispatchWorkflow returns the raw Response
      if (!res?.ok) {
        let payload = null;
        try {
          payload = await res.json();
        } catch {
          // ignore
        }
        const details = payload ? JSON.stringify(payload) : "";
        throw new Error(`Dispatch failed (${res?.status || "?"}) ${details}`);
      }

      setMsg("Submit OK: se han insertado/actualizado publication, TF, curation, sites, techniques y regulations.");
    } catch (e) {
      console.error(e);
      setMsg(`Error: ${e?.message || String(e)}`);
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
          title={!canSubmit ? "Need TF name (Step 2) + publication (Step 1) first." : ""}
        >
          {loading ? "Submitting..." : "Submit curation"}
        </button>
      </div>

      {msg && (
        <div className={`text-sm ${msg.startsWith("Submit OK") ? "text-green-400" : "text-red-400"}`}>
          {msg}
        </div>
      )}
    </div>
  );
}

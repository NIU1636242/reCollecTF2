// src/components/steps/Step7CurationInformation.jsx
import React, { useMemo, useState } from "react";
import { useCuration } from "../../context/CurationContext";
import { dispatchWorkflow } from "../../utils/serverless";

export default function Step7CurationInformation() {
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

  const REVISION_REASONS = [
    "None",
    "No comparable genome in NCBI",
    "Matching genome still in progress",
    "No comparable TF protein sequence in NCBI",
    "Other reason (specify in notes)",
  ];

  const [revisionReason, setRevisionReason] = useState("None");
  const [isComplete, setIsComplete] = useState(false);
  const [notes, setNotes] = useState("");
  const [wantSubmit, setWantSubmit] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");

  function esc(str) {
    return String(str || "").replace(/'/g, "''");
  }

  // --- techniques normalization (Step3 can store strings or objects) ---
  function techId(t) {
    return typeof t === "string"
      ? t
      : t?.eco || t?.ecoId || t?.EO_term || t?.code || t?.id || "";
  }

  function techIsNew(t) {
    return typeof t === "object" && !!t?.isNew;
  }

  // --- Step4 selected hit reconstruction ---
  const sites = step4Data?.sites || [];
  const choice = step4Data?.choice || {};
  const exactHits = step4Data?.exactHits || {};
  const fuzzyHits = step4Data?.fuzzyHits || {};
  const siteType = step4Data?.siteType || null;

  function getSelectedHit(site) {
    const sel = choice?.[site];
    if (!sel) return null;

    if (sel.startsWith("ex-")) {
      const idx = parseInt(sel.split("-")[1], 10);
      const hit = exactHits?.[site]?.[idx];
      return hit && hit !== "none" ? hit : null;
    }
    if (sel.startsWith("fz-")) {
      const idx = parseInt(sel.split("-")[1], 10);
      const hit = fuzzyHits?.[site]?.[idx];
      return hit && hit !== "none" ? hit : null;
    }
    return null;
  }

  // --- Basic completeness check (same as you enforce earlier) ---
  const canSubmit = useMemo(() => {
    if (!publication?.publication_id && !publication?.pmid) return false;
    if (!tf?.name) return false;
    if (!Array.isArray(genomeList) || genomeList.length === 0) return false;
    if (!Array.isArray(uniprotList) || uniprotList.length === 0) return false;
    if (!Array.isArray(refseqList) || refseqList.length === 0) return false;
    // Step4 should be completed in your flow anyway
    return true;
  }, [publication, tf, genomeList, uniprotList, refseqList]);

  async function handleSubmit() {
    setMsg("");
    if (!canSubmit) {
      setMsg("Missing required information from previous steps.");
      return;
    }
    if (!wantSubmit) {
      setMsg("Please check 'I want to submit this curation' to proceed.");
      return;
    }

    setSubmitting(true);
    try {
      const sql = [];

      // ------------------------------------------------------------
      // 0) Resolve publication_id
      // ------------------------------------------------------------
      const pubIdExpr = publication?.publication_id
        ? String(Number(publication.publication_id))
        : `(SELECT publication_id FROM core_publication WHERE pmid='${esc(publication?.pmid)}' LIMIT 1)`;

      // ------------------------------------------------------------
      // 1) Insert TF family / TF if new (core_tffamily, core_tf)
      // ------------------------------------------------------------
      const tfName = esc(tf?.name || "");
      const tfDesc = esc(tf?.description || "");
      const familyName = esc(tf?.family || tf?.family_name || tf?.newFamilyName || "");
      const familyDesc = esc(tf?.family_description || tf?.newFamilyDesc || "");

      const tfIdExpr = tf?.TF_id
        ? String(Number(tf.TF_id))
        : `(SELECT TF_id FROM core_tf WHERE LOWER(name)=LOWER('${tfName}') LIMIT 1)`;

      if (tf?.isNew) {
        if (tf?.isNewFamily) {
          sql.push(`
            INSERT INTO core_tffamily (name, description)
            SELECT '${familyName}', '${familyDesc}'
            WHERE NOT EXISTS (
              SELECT 1 FROM core_tffamily WHERE LOWER(name)=LOWER('${familyName}')
            );
          `);

          sql.push(`
            INSERT INTO core_tf (name, family_id, description)
            SELECT
              '${tfName}',
              (SELECT tf_family_id FROM core_tffamily WHERE LOWER(name)=LOWER('${familyName}') LIMIT 1),
              '${tfDesc}'
            WHERE NOT EXISTS (
              SELECT 1 FROM core_tf WHERE LOWER(name)=LOWER('${tfName}')
            );
          `);
        } else {
          const famId = Number(tf?.family_id || 0) || "NULL";
          sql.push(`
            INSERT INTO core_tf (name, family_id, description)
            SELECT '${tfName}', ${famId}, '${tfDesc}'
            WHERE NOT EXISTS (
              SELECT 1 FROM core_tf WHERE LOWER(name)=LOWER('${tfName}')
            );
          `);
        }
      }

      // ------------------------------------------------------------
      // 2) Ensure genomes exist (core_genome: genome_accession, organism)
      // ------------------------------------------------------------
      for (const g of genomeList || []) {
        const acc = esc(g?.accession);
        const org = esc(g?.organism || g?.description || "");
        if (!acc) continue;

        sql.push(`
          INSERT INTO core_genome (genome_accession, organism)
          SELECT '${acc}', '${org}'
          WHERE NOT EXISTS (
            SELECT 1 FROM core_genome WHERE genome_accession='${acc}'
          );
        `);
      }

      // ------------------------------------------------------------
      // 3) Ensure TF instances exist (core_tfinstance)
      //    Fields in ER: TF_instance_id, refseq_accession, uniprot_accession, description, TF_id, notes, EO_term_id
      // ------------------------------------------------------------
      const uniAccs = (uniprotList || []).map((x) => x?.accession).filter(Boolean);
      const refAccs = (refseqList || []).map((x) => x?.accession).filter(Boolean);

      for (const u of uniAccs) {
        const ua = esc(u);
        sql.push(`
          INSERT INTO core_tfinstance (uniprot_accession, TF_id, description)
          SELECT '${ua}', ${tfIdExpr}, ''
          WHERE NOT EXISTS (
            SELECT 1 FROM core_tfinstance WHERE uniprot_accession='${ua}'
          );
        `);
      }

      for (const r of refAccs) {
        const ra = esc(r);
        sql.push(`
          INSERT INTO core_tfinstance (refseq_accession, TF_id, description)
          SELECT '${ra}', ${tfIdExpr}, ''
          WHERE NOT EXISTS (
            SELECT 1 FROM core_tfinstance WHERE refseq_accession='${ra}'
          );
        `);
      }

      // ------------------------------------------------------------
      // 4) Insert new experimental techniques if created in Step3
      //    core_experimentaltechnique: technique_id, name, description, preset_function, EO_term
      // ------------------------------------------------------------
      for (const t of techniques || []) {
        if (!techIsNew(t)) continue;

        const eco = esc(techId(t));
        const desc = esc(t?.description || "");
        const name = esc(t?.name || ""); // you may not have it in Step3 creation
        sql.push(`
          INSERT INTO core_experimentaltechnique (name, description, preset_function, EO_term)
          SELECT '${name || ""}', '${desc}', NULL, '${eco}'
          WHERE NOT EXISTS (
            SELECT 1 FROM core_experimentaltechnique WHERE EO_term='${eco}'
          );
        `);

        const catId = Number(t?.categoryId || 0);
        if (catId) {
          // core_experimentaltechnique_categories: id, experimentaltechnique_id, experimentaltechniquecategory_id
          sql.push(`
            INSERT INTO core_experimentaltechnique_categories (experimentaltechnique_id, experimentaltechniquecategory_id)
            SELECT
              (SELECT technique_id FROM core_experimentaltechnique WHERE EO_term='${eco}' LIMIT 1),
              ${catId}
            WHERE NOT EXISTS (
              SELECT 1 FROM core_experimentaltechnique_categories
              WHERE experimentaltechnique_id=(SELECT technique_id FROM core_experimentaltechnique WHERE EO_term='${eco}' LIMIT 1)
                AND experimentaltechniquecategory_id=${catId}
            );
          `);
        }
      }

      // ------------------------------------------------------------
      // 5) Update core_publication flags
      //    core_publication has: contains_promoter_data, contains_expression_data, submission_note, curation_complete
      // ------------------------------------------------------------
      const promoterVal = strainData?.promoterInfo ? 1 : 0;
      const exprVal = strainData?.expressionInfo ? 1 : 0;
      const completeVal = isComplete ? 1 : 0;

      // optional: store revisionReason in submission_note together with notes
      const submissionNote = esc(
        revisionReason !== "None"
          ? `Revision required: ${revisionReason}\n\n${notes || ""}`
          : (notes || "")
      );

      sql.push(`
        UPDATE core_publication
        SET
          contains_promoter_data=${promoterVal},
          contains_expression_data=${exprVal},
          curation_complete=${completeVal},
          submission_note='${submissionNote}'
        WHERE publication_id=${pubIdExpr};
      `);

      // ------------------------------------------------------------
      // 6) Insert core_curation (your schema)
      //    core_curation: curation_id, TF_species, site_species, confidence, NCBI_submission_ready,
      //                 requires_revision, experimental_process, forms_complex, complex_notes, notes,
      //                 last_modified, curator_id, publication_id, quantitative_data_format, created, validated_by_id
      // ------------------------------------------------------------
      const requiresRevisionVal = revisionReason === "None" ? "" : esc(revisionReason);

      sql.push(`
        INSERT INTO core_curation (
          TF_species,
          site_species,
          confidence,
          NCBI_submission_ready,
          requires_revision,
          experimental_process,
          forms_complex,
          complex_notes,
          notes,
          last_modified,
          curator_id,
          publication_id,
          quantitative_data_format,
          created,
          validated_by_id
        )
        VALUES (
          '',
          '',
          '',
          0,
          '${requiresRevisionVal}',
          '',
          0,
          '',
          '${esc(notes)}',
          CURRENT_TIMESTAMP,
          NULL,
          ${pubIdExpr},
          '',
          CURRENT_TIMESTAMP,
          NULL
        );
      `);

      // We'll use last_insert_rowid() as curation_id in subsequent inserts (SQLite).
      // ------------------------------------------------------------
      // 7) Link TF instances to curation (core_curation_TF_instances)
      //    core_curation_TF_instances: id, curation_id, instance_id
      // ------------------------------------------------------------
      for (const u of uniAccs) {
        const ua = esc(u);
        sql.push(`
          INSERT INTO core_curation_TF_instances (curation_id, instance_id)
          SELECT
            last_insert_rowid(),
            (SELECT TF_instance_id FROM core_tfinstance WHERE uniprot_accession='${ua}' LIMIT 1);
        `);
      }
      for (const r of refAccs) {
        const ra = esc(r);
        sql.push(`
          INSERT INTO core_curation_TF_instances (curation_id, instance_id)
          SELECT
            last_insert_rowid(),
            (SELECT TF_instance_id FROM core_tfinstance WHERE refseq_accession='${ra}' LIMIT 1);
        `);
      }

      // ------------------------------------------------------------
      // 8) Persist sites + site annotations + techniques + regulation
      //    core_siteinstance + core_curation_siteinstance + technique bridge + core_regulation
      // ------------------------------------------------------------
      const annotations = step5Data?.annotations || {};
      const exprEnabled = !!strainData?.expressionInfo;

      for (const site of sites) {
        const hit = getSelectedHit(site);
        if (!hit) continue;

        const acc = esc(hit.acc);
        const seq = esc(hit.match || hit.site || site); // store matched seq in siteinstance.seq
        const strand = esc(hit.strand || "+");
        const start1 = Number(hit.start ?? 0) + 1;
        const end1 = Number(hit.end ?? 0) + 1;

        // core_siteinstance: site_id, seq, genome_id, start, end, strand
        sql.push(`
          INSERT INTO core_siteinstance (seq, genome_id, start, end, strand)
          VALUES (
            '${seq}',
            (SELECT genome_id FROM core_genome WHERE genome_accession='${acc}' LIMIT 1),
            ${start1},
            ${end1},
            '${strand}'
          );
        `);

        // core_curation_siteinstance
        const ann = annotations?.[site] || {};
        const tfType = esc(ann.tfType || "not specified");
        const tfFunc = esc(ann.tfFunc || "not specified");
        const annotatedSeq = esc(site); // original reported sequence (useful)
        const siteTypeVal = esc(siteType || "");

        sql.push(`
          INSERT INTO core_curation_siteinstance (
            curation_id,
            site_instance_id,
            annotated_seq,
            quantitative_value,
            is_obsolete,
            why_obsolete,
            site_type,
            TF_function,
            TF_type,
            is_high_throughput,
            motif_id,
            meta_site_id
          )
          VALUES (
            last_insert_rowid(),         -- curation_id
            last_insert_rowid(),         -- site_instance_id
            '${annotatedSeq}',
            NULL,
            0,
            '',
            '${siteTypeVal}',
            '${tfFunc}',
            '${tfType}',
            0,
            NULL,
            NULL
          );
        `);

        // Techniques for this site:
        // Prefer per-site list: ann.techniques = ["ECO:....", ...]
        // Otherwise if ann.useTechniques is true => apply ALL Step3 techniques
        let selectedTechs = [];
        if (Array.isArray(ann.techniques)) {
          selectedTechs = ann.techniques.map(techId).filter(Boolean);
        } else if (ann.useTechniques) {
          selectedTechs = (techniques || []).map(techId).filter(Boolean);
        }

        for (const ecoRaw of selectedTechs) {
          const eco = esc(ecoRaw);
          sql.push(`
            INSERT INTO core_curation_siteinstance_experimental_techniques (curation_siteinstance_id, experimentaltechnique_id)
            VALUES (
              last_insert_rowid(),
              (SELECT technique_id FROM core_experimentaltechnique WHERE EO_term='${eco}' LIMIT 1)
            );
          `);
        }

        // Regulation: core_regulation (id, curation_site_instance_id, gene_id, evidence_type, meta_site_id)
        if (exprEnabled) {
          const regs = step6Data?.[site]?.regulatedGenes || [];
          for (const g of regs) {
            const locus = esc(g?.locus || "");
            if (!locus) continue;

            const gStart = Number(g?.start ?? 0);
            const gEnd = Number(g?.end ?? 0);
            const gStrand = esc(g?.strand || "+");
            const gName = esc(g?.gene || g?.geneLabel || "");
            const gDesc = esc(g?.product || "");

            // Ensure gene exists (core_gene: gene_id, genome_id, name, description, start, end, strand, locus_tag, gene_type)
            sql.push(`
              INSERT INTO core_gene (genome_id, name, description, start, end, strand, locus_tag, gene_type)
              SELECT
                (SELECT genome_id FROM core_genome WHERE genome_accession='${acc}' LIMIT 1),
                '${gName}',
                '${gDesc}',
                ${gStart},
                ${gEnd},
                '${gStrand}',
                '${locus}',
                ''
              WHERE NOT EXISTS (
                SELECT 1 FROM core_gene
                WHERE genome_id=(SELECT genome_id FROM core_genome WHERE genome_accession='${acc}' LIMIT 1)
                  AND locus_tag='${locus}'
              );
            `);

            sql.push(`
              INSERT INTO core_regulation (curation_site_instance_id, gene_id, evidence_type, meta_site_id)
              VALUES (
                last_insert_rowid(),
                (SELECT gene_id FROM core_gene
                 WHERE genome_id=(SELECT genome_id FROM core_genome WHERE genome_accession='${acc}' LIMIT 1)
                   AND locus_tag='${locus}'
                 LIMIT 1),
                '',
                NULL
              );
            `);
          }
        }
      }

      const sqlString = sql
        .map((s) => String(s).trim())
        .filter(Boolean)
        .join("\n");

      // IMPORTANT: your serverless expects { inputs: { queries: "..." } }
      const res = await dispatchWorkflow({ inputs: { queries: sqlString } });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Serverless dispatch failed: HTTP ${res.status} ${txt}`);
      }

      setMsg(
        "Curation submitted. The database will be updated automatically after the workflow and redeploy."
      );
      setWantSubmit(false);
    } catch (e) {
      console.error(e);
      setMsg(`Error submitting curation: ${e?.message || String(e)}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Step 7 – Curation information</h2>

      <div className="bg-surface border border-border rounded p-4 space-y-4">
        <div>
          <label className="block font-medium mb-1">Revision required</label>
          <select
            className="form-control"
            value={revisionReason}
            onChange={(e) => setRevisionReason(e.target.value)}
          >
            {REVISION_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>

          <p className="text-xs text-muted mt-1">
            Select, if needed, the reason why this curation may require revision.
            See the detailed list of reasons in the curation guide.
          </p>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={isComplete}
            onChange={(e) => setIsComplete(e.target.checked)}
          />
          <span>
            Curation for this paper is complete.
            <br />
            <span className="text-xs text-muted">
              Check this box if there are no more curations pending for this paper
              (additional sites, sites supported by different techniques, sites for other TFs, etc.).
            </span>
          </span>
        </label>

        <div>
          <label className="block font-medium mb-1">Notes</label>
          <textarea
            className="form-control min-h-[160px]"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <p className="text-xs text-muted mt-1">
            Include any relevant notes (e.g., why sites were left out, surrogate genome choice, general comments on the experimental process, etc.).
          </p>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={wantSubmit}
            onChange={(e) => setWantSubmit(e.target.checked)}
          />
          <span>
            I want to submit this curation
            <br />
            <span className="text-xs text-muted">
              Check to submit when you click "Submit curation".
            </span>
          </span>
        </label>
      </div>

      <button
        className="btn"
        onClick={handleSubmit}
        disabled={!canSubmit || !wantSubmit || submitting}
      >
        {submitting ? "Submitting..." : "Submit curation"}
      </button>

      {msg && (
        <div
          className={[
            "text-sm",
            msg.toLowerCase().startsWith("error") ? "text-red-400" : "text-emerald-300",
          ].join(" ")}
        >
          {msg}
        </div>
      )}
    </div>
  );
}

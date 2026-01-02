// src/components/steps/Step7CurationInfo.jsx
import { useMemo, useState } from "react";
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

function truthyBool(v) {
  return v ? 1 : 0;
}

function isPmid(v) {
  return typeof v === "string" && /^\d+$/.test(v.trim());
}

function isDoi(v) {
  return typeof v === "string" && v.includes("/");
}

// Step4: reconstruir el hit seleccionado
function getSelectedHitForSite(site, step4Data) {
  const sel = step4Data?.choice?.[site];
  if (!sel) return null;

  if (sel.startsWith("ex-")) {
    const idx = Number(sel.split("-")[1]);
    const h = step4Data.exactHits?.[site]?.[idx];
    return h && h !== "none" ? h : null;
  }
  if (sel.startsWith("fz-")) {
    const idx = Number(sel.split("-")[1]);
    const h = step4Data.fuzzyHits?.[site]?.[idx];
    return h && h !== "none" ? h : null;
  }
  return null;
}

async function tableExists(name) {
  const rows = await runQuery(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1;`,
    [name]
  );
  return rows.length > 0;
}

async function getCols(table) {
  const rows = await runQuery(`PRAGMA table_info(${table});`);
  return new Set(rows.map((r) => r.name));
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
    return (
      !!publication &&
      !!tf &&
      (genomeList?.length ?? 0) > 0 &&
      (uniprotList?.length ?? 0) > 0 &&
      (refseqList?.length ?? 0) > 0 &&
      (step4Data?.sites?.length ?? 0) > 0 &&
      !!step5Data?.annotations &&
      !loading
    );
  }, [publication, tf, genomeList, uniprotList, refseqList, step4Data, step5Data, loading]);

  // Step3 techniques: normalizar a { ecoId, name }
  const normalizedTechniques = useMemo(() => {
    const arr = Array.isArray(techniques) ? techniques : [];
    return arr
      .map((t) => {
        const ecoId =
          typeof t === "string"
            ? normalizeEco(t)
            : normalizeEco(t.ecoId || t.eco || t.EO_term || t.code || t.id);

        if (!ecoId) return null;

        const name = typeof t === "string" ? "" : (t.name || "");
        return { ecoId, name };
      })
      .filter(Boolean);
  }, [techniques]);

  async function buildSqlScript() {
    // --- Required schema checks
    const requiredTables = [
      "core_publication",
      "core_curation",
      "core_tf",
      "core_tffamily",
      "core_tfinstance",
      "core_genome",
      "core_siteinstance",
      "core_curation_siteinstance",
      "core_curation_siteinstance_experimental_techniques",
      "core_curation_TF_instances",
      "core_regulation",
      "core_metasite",
      "core_gene",
    ];

    for (const t of requiredTables) {
      const ok = await tableExists(t);
      // Gene/regulation/metasite may exist always in your ER; if one is missing, we degrade gracefully below.
      if (!ok && ["core_gene", "core_regulation", "core_metasite"].includes(t)) continue;
      if (!ok) throw new Error(`Missing table in DB: ${t}`);
    }

    const pubCols = await getCols("core_publication");
    const curCols = await getCols("core_curation");
    const tfCols = await getCols("core_tf");
    const famCols = await getCols("core_tffamily");
    const tfiCols = await getCols("core_tfinstance");
    const genCols = await getCols("core_genome");
    const siCols = await getCols("core_siteinstance");
    const csiCols = await getCols("core_curation_siteinstance");

    const hasMeta = await tableExists("core_metasite");
    const metaCols = hasMeta ? await getCols("core_metasite") : new Set();

    const hasReg = await tableExists("core_regulation");
    const regCols = hasReg ? await getCols("core_regulation") : new Set();

    const hasGene = await tableExists("core_gene");
    const geneCols = hasGene ? await getCols("core_gene") : new Set();

    const hasBridgeTech = await tableExists("core_curation_siteinstance_experimental_techniques");
    const hasBridgeTF = await tableExists("core_curation_TF_instances");

    // --- Publication identity
    const pmid = publication?.pmid && isPmid(String(publication.pmid)) ? String(publication.pmid) : "";
    const doi = publication?.doi && publication.doi !== "No DOI" && isDoi(publication.doi) ? publication.doi : "";
    const doiUrl = doi ? `https://doi.org/${doi}` : "";

    // Use pmid first, else url (doiUrl) if exists in schema
    const pubWhere =
      pmid && pubCols.has("pmid")
        ? `pmid='${esc(pmid)}'`
        : doiUrl && pubCols.has("url")
        ? `url='${esc(doiUrl)}'`
        : null;

    if (!pubWhere) {
      throw new Error("Cannot identify publication row (need PMID or DOI/url column).");
    }

    // --- Species logic
    const firstGenomeOrg = genomeList?.[0]?.organism || genomeList?.[0]?.description || "";
    const tfSpecies = strainData?.sameStrainTF ? firstGenomeOrg : (strainData?.organismReportedTF || "");
    const siteSpecies = strainData?.sameStrainGenome ? firstGenomeOrg : (strainData?.organismTFBindingSites || "");

    const requiresRevision = revisionReason !== "None";
    const combinedNotes = [
      requiresRevision ? `Revision reason: ${revisionReason}` : null,
      notes?.trim() ? notes.trim() : null,
    ].filter(Boolean).join("\n");

    const containsPromoter = truthyBool(strainData?.promoterInfo);
    const containsExpression = truthyBool(strainData?.expressionInfo);

    const tfName = (tf?.name || "").trim();
    if (!tfName) throw new Error("TF name missing.");

    const tfIsExisting = !!tf?.TF_id;
    const wantsNewFamily = !!tf?.isNewFamily;

    const newFamilyName = (tf?.newFamilyName || tf?.family || "").trim();
    const newFamilyDesc = (tf?.newFamilyDesc || tf?.family_description || "").trim();
    const existingFamilyId = tf?.family_id || tf?.familyId || null;

    const sites = step4Data?.sites || [];
    const annotations = step5Data?.annotations || {};
    const regulation = step6Data || {};

    const sql = [];
    sql.push("BEGIN TRANSACTION;");

    // Temp vars
    sql.push("DROP TABLE IF EXISTS _tmp_curation;");
    sql.push("CREATE TEMP TABLE _tmp_curation(curation_id INTEGER);");

    // -------------------------
    // 1) Publication upsert
    // -------------------------
    {
      const cols = [];
      const vals = [];

      if (pubCols.has("pmid") && pmid) {
        cols.push("pmid"); vals.push(`'${esc(pmid)}'`);
      }
      if (pubCols.has("title")) {
        cols.push("title"); vals.push(`'${esc(publication.title || "")}'`);
      }
      if (pubCols.has("authors")) {
        cols.push("authors"); vals.push(`'${esc(publication.authors || "")}'`);
      }
      if (pubCols.has("journal")) {
        cols.push("journal"); vals.push(`'${esc(publication.journal || "")}'`);
      }
      if (pubCols.has("publication_date")) {
        cols.push("publication_date"); vals.push(`'${esc(publication.pubdate || "")}'`);
      }
      if (pubCols.has("url") && doiUrl) {
        cols.push("url"); vals.push(`'${esc(doiUrl)}'`);
      }

      if (cols.length) {
        sql.push(`
          INSERT OR IGNORE INTO core_publication (${cols.join(",")})
          VALUES (${vals.join(",")});
        `);
      } else {
        sql.push(`INSERT OR IGNORE INTO core_publication DEFAULT VALUES;`);
      }

      const upd = [];
      if (pubCols.has("contains_promoter_data")) upd.push(`contains_promoter_data=${containsPromoter}`);
      if (pubCols.has("contains_expression_data")) upd.push(`contains_expression_data=${containsExpression}`);
      if (pubCols.has("submission_notes")) upd.push(`submission_notes='${esc(combinedNotes)}'`);
      if (pubCols.has("curation_complete")) upd.push(`curation_complete=${truthyBool(curationComplete)}`);
      if (pubCols.has("reported_TF")) upd.push(`reported_TF='${esc(tfName)}'`);
      if (pubCols.has("reported_species")) upd.push(`reported_species='${esc(siteSpecies || tfSpecies || "")}'`);

      if (upd.length) {
        sql.push(`
          UPDATE core_publication
          SET ${upd.join(", ")}
          WHERE ${pubWhere};
        `);
      }
    }

    // -------------------------
    // 2) TF family + TF upsert (if new)
    // -------------------------
    if (!tfIsExisting) {
      // family
      if (wantsNewFamily) {
        if (!newFamilyName) throw new Error("New TF family name missing.");

        if (famCols.has("name")) {
          const fCols = ["name"];
          const fVals = [`'${esc(newFamilyName)}'`];
          if (famCols.has("description")) {
            fCols.push("description");
            fVals.push(`'${esc(newFamilyDesc)}'`);
          }

          sql.push(`
            INSERT OR IGNORE INTO core_tffamily (${fCols.join(",")})
            VALUES (${fVals.join(",")});
          `);
        } else {
          sql.push(`INSERT OR IGNORE INTO core_tffamily DEFAULT VALUES;`);
        }
      }

      // TF
      let familyExpr = "NULL";
      if (wantsNewFamily) {
        familyExpr = `(SELECT tf_family_id FROM core_tffamily WHERE name='${esc(newFamilyName)}' LIMIT 1)`;
      } else if (existingFamilyId) {
        familyExpr = Number(existingFamilyId);
      } else if (tf?.family) {
        familyExpr = `(SELECT tf_family_id FROM core_tffamily WHERE name='${esc(tf.family)}' LIMIT 1)`;
      }

      const tCols = [];
      const tVals = [];
      if (tfCols.has("name")) { tCols.push("name"); tVals.push(`'${esc(tfName)}'`); }
      if (tfCols.has("family_id")) { tCols.push("family_id"); tVals.push(`${familyExpr}`); }
      if (tfCols.has("description")) { tCols.push("description"); tVals.push(`'${esc(tf.description || "")}'`); }

      if (tCols.length) {
        sql.push(`
          INSERT OR IGNORE INTO core_tf (${tCols.join(",")})
          VALUES (${tVals.join(",")});
        `);
      } else {
        sql.push(`INSERT OR IGNORE INTO core_tf DEFAULT VALUES;`);
      }
    }

    // TF id expression
    const TF_ID_EXPR = `(SELECT TF_id FROM core_tf WHERE LOWER(name)=LOWER('${esc(tfName)}') LIMIT 1)`;

    // -------------------------
    // 3) Genomes upsert
    // -------------------------
    for (const g of genomeList || []) {
      const acc = (g?.accession || "").trim();
      if (!acc) continue;
      const org = (g?.organism || g?.description || "").trim();

      const gCols = [];
      const gVals = [];
      if (genCols.has("genome_accession")) { gCols.push("genome_accession"); gVals.push(`'${esc(acc)}'`); }
      if (genCols.has("organism")) { gCols.push("organism"); gVals.push(`'${esc(org)}'`); }

      if (gCols.length) {
        sql.push(`
          INSERT OR IGNORE INTO core_genome (${gCols.join(",")})
          VALUES (${gVals.join(",")});
        `);
      } else {
        sql.push(`INSERT OR IGNORE INTO core_genome DEFAULT VALUES;`);
      }
    }

    // -------------------------
    // 4) TF instances upsert (uniprot/refseq)
    // -------------------------
    const uni = uniprotList || [];
    const ref = refseqList || [];
    const maxLen = Math.max(uni.length, ref.length);

    for (let i = 0; i < maxLen; i++) {
      const uAcc = (uni?.[i]?.accession || "").trim();
      const rAcc = (ref?.[i]?.accession || "").trim();
      if (!uAcc && !rAcc) continue;

      const desc = (uni?.[i]?.description || ref?.[i]?.description || "").trim();

      const iCols = [];
      const iVals = [];

      if (tfiCols.has("uniprot_accession")) { iCols.push("uniprot_accession"); iVals.push(uAcc ? `'${esc(uAcc)}'` : "NULL"); }
      if (tfiCols.has("refseq_accession")) { iCols.push("refseq_accession"); iVals.push(rAcc ? `'${esc(rAcc)}'` : "NULL"); }
      if (tfiCols.has("description")) { iCols.push("description"); iVals.push(`'${esc(desc)}'`); }
      if (tfiCols.has("TF_id")) { iCols.push("TF_id"); iVals.push(TF_ID_EXPR); }

      if (iCols.length) {
        sql.push(`
          INSERT OR IGNORE INTO core_tfinstance (${iCols.join(",")})
          VALUES (${iVals.join(",")});
        `);
      } else {
        sql.push(`INSERT OR IGNORE INTO core_tfinstance DEFAULT VALUES;`);
      }

      // Ensure TF_id set (if row existed)
      if (tfiCols.has("TF_id")) {
        if (uAcc && tfiCols.has("uniprot_accession")) {
          sql.push(`
            UPDATE core_tfinstance
            SET TF_id=${TF_ID_EXPR}
            WHERE uniprot_accession='${esc(uAcc)}' AND (TF_id IS NULL OR TF_id='');
          `);
        }
        if (rAcc && tfiCols.has("refseq_accession")) {
          sql.push(`
            UPDATE core_tfinstance
            SET TF_id=${TF_ID_EXPR}
            WHERE refseq_accession='${esc(rAcc)}' AND (TF_id IS NULL OR TF_id='');
          `);
        }
      }
    }

    // -------------------------
    // 5) Experimental techniques upsert (EO_term)
    // -------------------------
    if (await tableExists("core_experimentaltechnique")) {
      const techCols = await getCols("core_experimentaltechnique");

      for (const t of normalizedTechniques) {
        const eco = normalizeEco(t.ecoId);
        if (!eco) continue;

        const c = [];
        const v = [];
        if (techCols.has("EO_term")) { c.push("EO_term"); v.push(`'${esc(eco)}'`); }
        if (techCols.has("name")) { c.push("name"); v.push(t.name ? `'${esc(t.name)}'` : "NULL"); }

        if (c.length) {
          sql.push(`
            INSERT OR IGNORE INTO core_experimentaltechnique (${c.join(",")})
            VALUES (${v.join(",")});
          `);
        }
      }
    }

    // -------------------------
    // 6) Create curation row
    // -------------------------
    {
      const cols = [];
      const vals = [];

      if (curCols.has("TF_species")) { cols.push("TF_species"); vals.push(`'${esc(tfSpecies || "")}'`); }
      if (curCols.has("site_species")) { cols.push("site_species"); vals.push(`'${esc(siteSpecies || "")}'`); }
      if (curCols.has("requires_revision")) { cols.push("requires_revision"); vals.push(`${truthyBool(requiresRevision)}`); }
      if (curCols.has("notes")) { cols.push("notes"); vals.push(`'${esc(combinedNotes)}'`); }
      if (curCols.has("forms_complex")) { cols.push("forms_complex"); vals.push("0"); }
      if (curCols.has("experimental_process")) { cols.push("experimental_process"); vals.push(`'${esc("")}'`); }
      if (curCols.has("created")) { cols.push("created"); vals.push("datetime('now')"); }
      if (curCols.has("last_modified")) { cols.push("last_modified"); vals.push("datetime('now')"); }

      if (curCols.has("publication_id")) {
        cols.push("publication_id");
        vals.push(`(SELECT publication_id FROM core_publication WHERE ${pubWhere} LIMIT 1)`);
      }

      if (!cols.length) throw new Error("core_curation has no writable columns (unexpected).");

      sql.push(`
        INSERT INTO core_curation (${cols.join(",")})
        VALUES (${vals.join(",")});
      `);
      sql.push(`INSERT INTO _tmp_curation(curation_id) VALUES (last_insert_rowid());`);
    }

    // -------------------------
    // 7) Link curation ↔ TF instances
    // -------------------------
    if (hasBridgeTF) {
      // uniprot
      for (const u of uni) {
        const acc = (u?.accession || "").trim();
        if (!acc) continue;
        sql.push(`
          INSERT OR IGNORE INTO core_curation_TF_instances (curation_id, tfinstance_id)
          SELECT
            (SELECT curation_id FROM _tmp_curation),
            TF_instance_id
          FROM core_tfinstance
          WHERE uniprot_accession='${esc(acc)}'
          LIMIT 1;
        `);
      }
      // refseq
      for (const r of ref) {
        const acc = (r?.accession || "").trim();
        if (!acc) continue;
        sql.push(`
          INSERT OR IGNORE INTO core_curation_TF_instances (curation_id, tfinstance_id)
          SELECT
            (SELECT curation_id FROM _tmp_curation),
            TF_instance_id
          FROM core_tfinstance
          WHERE refseq_accession='${esc(acc)}'
          LIMIT 1;
        `);
      }
    }

    // -------------------------
    // 8) Insert sites + annotations + technique links + regulation
    // -------------------------
    // Temp table for per-site IDs
    sql.push("DROP TABLE IF EXISTS _tmp_sites;");
    sql.push("CREATE TEMP TABLE _tmp_sites(site TEXT PRIMARY KEY, site_instance_id INTEGER, curation_siteinstance_id INTEGER, meta_site_id INTEGER);");

    for (const site of sites) {
      const hit = getSelectedHitForSite(site, step4Data);
      if (!hit) continue;

      const genomeAcc = hit.acc;
      const start = Number(hit.start) + 1;
      const end = Number(hit.end) + 1;
      const strand = hit.strand || "+";
      const mappedSeq = (hit.match || site || "").toUpperCase();

      // 8.1) core_siteinstance
      {
        const cols = [];
        const vals = [];

        if (siCols.has("seq")) { cols.push("seq"); vals.push(`'${esc(mappedSeq)}'`); }
        if (siCols.has("start")) { cols.push("start"); vals.push(`${start}`); }
        if (siCols.has("end")) { cols.push("end"); vals.push(`${end}`); }
        if (siCols.has("strand")) { cols.push("strand"); vals.push(`'${esc(strand)}'`); }

        if (siCols.has("genome_id")) {
          cols.push("genome_id");
          vals.push(`(SELECT genome_id FROM core_genome WHERE genome_accession='${esc(genomeAcc)}' LIMIT 1)`);
        }

        sql.push(`
          INSERT INTO core_siteinstance (${cols.join(",")})
          VALUES (${vals.join(",")});
        `);

        sql.push(`
          INSERT OR REPLACE INTO _tmp_sites(site, site_instance_id, curation_siteinstance_id, meta_site_id)
          VALUES ('${esc(site)}', last_insert_rowid(), NULL, NULL);
        `);
      }

      // 8.2) core_metasite (create one per curated site)
      if (hasMeta && (metaCols.has("meta_site_id") || metaCols.has("delegate_id"))) {
        // meta_site_id is not guaranteed AUTOINC -> we generate it: MAX+1
        const hasMetaId = metaCols.has("meta_site_id");
        const hasDelegate = metaCols.has("delegate_id");

        if (hasMetaId && hasDelegate) {
          sql.push(`
            INSERT INTO core_metasite (meta_site_id, delegate_id)
            SELECT
              (SELECT IFNULL(MAX(meta_site_id),0)+1 FROM core_metasite),
              (SELECT IFNULL(MAX(meta_site_id),0)+1 FROM core_metasite);
          `);
          sql.push(`
            UPDATE _tmp_sites
            SET meta_site_id = (SELECT MAX(meta_site_id) FROM core_metasite)
            WHERE site='${esc(site)}';
          `);
        }
      }

      // 8.3) core_curation_siteinstance
      {
        const ann = annotations?.[site] || {};
        const tfType = ann.tfType || "not specified";
        const tfFunc = ann.tfFunc || "not specified";

        const cols = [];
        const vals = [];

        if (csiCols.has("curation_id")) { cols.push("curation_id"); vals.push("(SELECT curation_id FROM _tmp_curation)"); }
        if (csiCols.has("site_instance_id")) { cols.push("site_instance_id"); vals.push(`(SELECT site_instance_id FROM _tmp_sites WHERE site='${esc(site)}')`); }

        if (csiCols.has("annotated_seq")) { cols.push("annotated_seq"); vals.push(`'${esc(site)}'`); }
        if (csiCols.has("site_type")) { cols.push("site_type"); vals.push(`'${esc(step4Data.siteType || "")}'`); }

        if (csiCols.has("TF_type")) { cols.push("TF_type"); vals.push(`'${esc(tfType)}'`); }
        if (csiCols.has("TF_function")) { cols.push("TF_function"); vals.push(`'${esc(tfFunc)}'`); }

        if (csiCols.has("is_high_throughput")) { cols.push("is_high_throughput"); vals.push("0"); }

        // Store meta_site_id / motif_id if those columns exist
        if (csiCols.has("meta_site_id")) {
          cols.push("meta_site_id");
          vals.push(`(SELECT meta_site_id FROM _tmp_sites WHERE site='${esc(site)}')`);
        }
        if (csiCols.has("motif_id")) {
          // In your ER, motif_id exists in curation_siteinstance; using metasite id is safe & consistent
          cols.push("motif_id");
          vals.push(`(SELECT meta_site_id FROM _tmp_sites WHERE site='${esc(site)}')`);
        }

        sql.push(`
          INSERT INTO core_curation_siteinstance (${cols.join(",")})
          VALUES (${vals.join(",")});
        `);

        sql.push(`
          UPDATE _tmp_sites
          SET curation_siteinstance_id = last_insert_rowid()
          WHERE site='${esc(site)}';
        `);
      }

      // 8.4) Link techniques per site (Step5 uses techniques map)
      if (hasBridgeTech) {
        const techMap = annotations?.[site]?.techniques || {};
        for (const t of normalizedTechniques) {
          const eco = normalizeEco(t.ecoId);
          if (!eco) continue;
          if (!techMap?.[eco]) continue; // only checked techniques for this site

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

      // 8.5) Regulation
      if (hasReg && hasGene && geneCols.has("locus_tag")) {
        const regGenes = regulation?.[site]?.regulatedGenes || [];
        for (const g of regGenes) {
          const locus = (g?.locus || "").trim();
          if (!locus) continue;

          // Only insert if gene exists
          // core_gene: gene_id, genome_id, name, description, start, end, strand, locus_tag, gene_type
          sql.push(`
            INSERT OR IGNORE INTO core_regulation (curation_site_instance_id, gene_id)
            SELECT
              (SELECT curation_siteinstance_id FROM _tmp_sites WHERE site='${esc(site)}'),
              (SELECT gene_id FROM core_gene WHERE locus_tag='${esc(locus)}' LIMIT 1)
            WHERE (SELECT gene_id FROM core_gene WHERE locus_tag='${esc(locus)}' LIMIT 1) IS NOT NULL;
          `);
        }
      }
    }

    sql.push("COMMIT;");
    return sql.join("\n");
  }

  async function handleSubmit() {
    setMsg("");

    if (!canSubmit) {
      setMsg("❌ Complete the required steps first (1–6).");
      return;
    }

    setLoading(true);
    try {
      const sqlString = await buildSqlScript();

      await dispatchWorkflow({
        inputs: { queries: sqlString },
      });

      setMsg("✅ Curación enviada. El workflow actualizará CollecTF.db y hará redeploy.");
    } catch (e) {
      console.error(e);
      setMsg(`❌ Error: ${e?.message || String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Step 7 – Curation information</h2>

      <div className="bg-surface border border-border rounded p-4 space-y-3">
        {/* Revision required */}
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
            Select the reason why this curation may require revision (if any).
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
              Check if there is no more curation pending for this paper.
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
            Include any relevant notes (surrogate genome choice, exclusions, etc.).
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          className="btn"
          onClick={handleSubmit}
          disabled={!canSubmit}
          title={!canSubmit ? "Complete required steps first." : ""}
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

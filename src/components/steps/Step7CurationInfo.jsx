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

async function getTableInfo(table) {
  // returns [{cid,name,type,notnull,dflt_value,pk}]
  return await runQuery(`PRAGMA table_info(${table});`);
}

async function getCols(table) {
  const info = await getTableInfo(table);
  return new Set(info.map((r) => r.name));
}

async function getNotNullCols(table) {
  const info = await getTableInfo(table);
  return new Set(info.filter((r) => r.notnull === 1).map((r) => r.name));
}

async function getColTypes(table) {
  const info = await getTableInfo(table);
  const m = new Map();
  info.forEach((r) => m.set(r.name, (r.type || "").toUpperCase()));
  return m;
}

async function getForeignKeys(table) {
  // rows: {id, seq, table, from, to, on_update, on_delete, match}
  return await runQuery(`PRAGMA foreign_key_list(${table});`);
}

function pickTextDefault(type) {
  // Safe defaults for NOT NULL when we don't have value.
  // SQLite types are flexible anyway.
  if (!type) return "''";
  const t = type.toUpperCase();
  if (t.includes("INT") || t.includes("REAL") || t.includes("NUM")) return "0";
  return "''";
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

  // Basic guardrails: sin checkbox extra
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

  // Normalize techniques: soporta strings o objetos
  function normalizeTechList(raw) {
    const list = (raw || []).map((t) =>
      typeof t === "string"
        ? { eco: normalizeEco(t), existsInDB: true }
        : {
            ...t,
            eco: normalizeEco(t.eco || t.EO_term || t.code),
          }
    );
    return list.filter((x) => x.eco);
  }

  // Build SQL script (robusto)
  async function buildSqlScript(normalizedTechniques) {
    if (!publication) throw new Error("Falta publication.");
    if (!tf) throw new Error("Falta TF.");
    if (!step4Data?.sites?.length) throw new Error("Falta Step4.");
    if (!step5Data?.annotations) throw new Error("Falta Step5.");

    // -------------------------
    // Introspección del schema real
    // -------------------------
    const pubCols = await getCols("core_publication");
    const curCols = await getCols("core_curation");
    const curNN = await getNotNullCols("core_curation");
    const curTypes = await getColTypes("core_curation");

    const tfCols = await getCols("core_tf");
    const famCols = await getCols("core_tffamily");
    const genomeCols = await getCols("core_genome");

    const tfiCols = await getCols("core_tfinstance");

    const techCols = await getCols("core_experimentaltechnique");

    const siteCols = await getCols("core_siteinstance");

    const csiCols = await getCols("core_curation_siteinstance");
    const csiNN = await getNotNullCols("core_curation_siteinstance");
    const csiFK = await getForeignKeys("core_curation_siteinstance");

    const regCols = await getCols("core_regulation");

    // motif handling if motif_id exists / required
    const motifRequired = csiNN.has("motif_id") || csiCols.has("motif_id");
    const motifFK = motifRequired ? csiFK.find((fk) => fk.from === "motif_id") : null;
    const motifTable = motifFK?.table || null;
    const motifCols = motifTable ? await getCols(motifTable) : null;
    const motifNN = motifTable ? await getNotNullCols(motifTable) : null;
    const motifTypes = motifTable ? await getColTypes(motifTable) : null;

    // -------------------------
    // Publication identification clause
    // -------------------------
    const pubIdClause = publication.pmid && isPmid(publication.pmid)
      ? `pmid='${esc(publication.pmid)}'`
      : publication.doi && publication.doi !== "No DOI" && isDoi(publication.doi) && pubCols.has("doi")
        ? `doi='${esc(publication.doi)}'`
        : null;

    // si no hay doi column, usa pmid (si existe) o url si existe
    const doiUrl = publication.doi && publication.doi !== "No DOI" && isDoi(publication.doi)
      ? `https://doi.org/${publication.doi}`
      : "";

    const pubAltClause = pubIdClause
      ? pubIdClause
      : (publication.pmid && pubCols.has("pmid") ? `pmid='${esc(publication.pmid)}'` : null) ||
        (doiUrl && pubCols.has("url") ? `url='${esc(doiUrl)}'` : null);

    if (!pubAltClause) {
      throw new Error("No se puede identificar la publication: falta PMID y/o el schema no soporta DOI/URL.");
    }

    // -------------------------
    // Species (NOT NULL en core_curation)
    // -------------------------
    const firstGenomeOrg = genomeList?.[0]?.organism || genomeList?.[0]?.description || "";
    const tfSpecies =
      strainData?.sameStrainTF ? firstGenomeOrg : (strainData?.organismReportedTF || "");
    const siteSpecies =
      strainData?.sameStrainGenome ? firstGenomeOrg : (strainData?.organismTFBindingSites || "");

    // -------------------------
    // Prep curation info
    // -------------------------
    const requiresRevision = revisionReason !== "None";
    const revisionText = requiresRevision ? revisionReason : "";

    const combinedNotes = [revisionText ? `Revision reason: ${revisionText}` : null, notes ? notes : null]
      .filter(Boolean)
      .join("\n");

    const containsPromoter = truthyBool(strainData?.promoterInfo);
    const containsExpression = truthyBool(strainData?.expressionInfo);

    // -------------------------
    // TF / family
    // -------------------------
    const tfIsExisting = !!tf?.TF_id;
    const tfName = (tf?.name || "").trim();
    if (!tfName) throw new Error("TF inválido: falta nombre.");

    const wantsNewFamily = !!tf?.isNewFamily;
    const newFamilyName = (tf?.newFamilyName || tf?.family || "").trim();
    const newFamilyDesc = tf?.newFamilyDesc || tf?.family_description || "";
    const existingFamilyId = tf?.family_id || tf?.familyId || null;

    // -------------------------
    // Data from steps
    // -------------------------
    const genomes = genomeList || [];
    const uni = uniprotList || [];
    const ref = refseqList || [];
    const sites = step4Data?.sites || [];
    const annotations = step5Data?.annotations || {};
    const regulation = step6Data || {};

    // -------------------------
    // SQL generation
    // -------------------------
    const sql = [];
    sql.push("BEGIN TRANSACTION;");

    // temp tables
    sql.push("DROP TABLE IF EXISTS _tmp_curation;");
    sql.push("CREATE TEMP TABLE _tmp_curation(curation_id INTEGER);");

    sql.push("DROP TABLE IF EXISTS _tmp_sites;");
    sql.push("CREATE TEMP TABLE _tmp_sites(site TEXT PRIMARY KEY, site_instance_id INTEGER, curation_siteinstance_id INTEGER, motif_id INTEGER);");

    // 1) Ensure publication exists (only columns that exist)
    {
      const cols = [];
      const vals = [];

      if (pubCols.has("pmid") && publication.pmid && isPmid(publication.pmid)) {
        cols.push("pmid");
        vals.push(`'${esc(publication.pmid)}'`);
      }

      if (pubCols.has("doi") && publication.doi && publication.doi !== "No DOI" && isDoi(publication.doi)) {
        cols.push("doi");
        vals.push(`'${esc(publication.doi)}'`);
      } else if (!pubCols.has("doi") && pubCols.has("url") && doiUrl) {
        cols.push("url");
        vals.push(`'${esc(doiUrl)}'`);
      }

      if (pubCols.has("title")) {
        cols.push("title");
        vals.push(`'${esc(publication.title || "")}'`);
      }
      if (pubCols.has("authors")) {
        cols.push("authors");
        vals.push(`'${esc(publication.authors || "")}'`);
      }
      if (pubCols.has("journal")) {
        cols.push("journal");
        vals.push(`'${esc(publication.journal || "")}'`);
      }
      if (pubCols.has("publication_date")) {
        cols.push("publication_date");
        vals.push(`'${esc(publication.pubdate || "")}'`);
      } else if (pubCols.has("pubdate")) {
        cols.push("pubdate");
        vals.push(`'${esc(publication.pubdate || "")}'`);
      }

      if (cols.length === 0) {
        // si la tabla fuera rara
        sql.push(`INSERT OR IGNORE INTO core_publication DEFAULT VALUES;`);
      } else {
        sql.push(`
          INSERT OR IGNORE INTO core_publication (${cols.join(",")})
          VALUES (${vals.join(",")});
        `);
      }

      // Update flags if they exist
      const up = [];
      if (pubCols.has("contains_promoter_data")) up.push(`contains_promoter_data=${containsPromoter}`);
      if (pubCols.has("contains_expression_data")) up.push(`contains_expression_data=${containsExpression}`);
      if (pubCols.has("submission_notes")) up.push(`submission_notes='${esc(notes)}'`);
      if (pubCols.has("curation_complete")) up.push(`curation_complete=${truthyBool(curationComplete)}`);

      if (up.length) {
        sql.push(`
          UPDATE core_publication
          SET ${up.join(", ")}
          WHERE ${pubAltClause};
        `);
      }
    }

    // 2) Ensure family / TF
    if (!tfIsExisting) {
      if (wantsNewFamily) {
        if (!newFamilyName) throw new Error("Falta el nombre de la nueva TF family.");
        if (famCols.has("name")) {
          const famInsertCols = ["name"];
          const famInsertVals = [`'${esc(newFamilyName)}'`];
          if (famCols.has("description")) {
            famInsertCols.push("description");
            famInsertVals.push(`'${esc(newFamilyDesc)}'`);
          }
          sql.push(`
            INSERT OR IGNORE INTO core_tffamily (${famInsertCols.join(",")})
            VALUES (${famInsertVals.join(",")});
          `);
        } else {
          sql.push(`INSERT OR IGNORE INTO core_tffamily DEFAULT VALUES;`);
        }
      }

      // family expr
      let familyExpr = "NULL";
      if (wantsNewFamily && newFamilyName) {
        familyExpr = `(SELECT tf_family_id FROM core_tffamily WHERE name='${esc(newFamilyName)}' LIMIT 1)`;
      } else if (existingFamilyId) {
        familyExpr = Number(existingFamilyId);
      } else if (tf?.family) {
        familyExpr = `(SELECT tf_family_id FROM core_tffamily WHERE name='${esc(tf.family)}' LIMIT 1)`;
      }

      const tfInsertCols = [];
      const tfInsertVals = [];

      if (tfCols.has("name")) {
        tfInsertCols.push("name");
        tfInsertVals.push(`'${esc(tfName)}'`);
      }
      if (tfCols.has("family_id")) {
        tfInsertCols.push("family_id");
        tfInsertVals.push(`${familyExpr}`);
      }
      if (tfCols.has("description")) {
        tfInsertCols.push("description");
        tfInsertVals.push(`'${esc(tf.description || "")}'`);
      }

      if (tfInsertCols.length === 0) {
        sql.push(`INSERT OR IGNORE INTO core_tf DEFAULT VALUES;`);
      } else {
        sql.push(`
          INSERT OR IGNORE INTO core_tf (${tfInsertCols.join(",")})
          VALUES (${tfInsertVals.join(",")});
        `);
      }
    }

    // 3) Ensure genomes exist (columns safe)
    for (const g of genomes) {
      const acc = g.accession;
      const organism = g.organism || g.description || "";
      if (!acc) continue;

      const gCols = [];
      const gVals = [];

      if (genomeCols.has("genome_accession")) {
        gCols.push("genome_accession");
        gVals.push(`'${esc(acc)}'`);
      }
      if (genomeCols.has("organism")) {
        gCols.push("organism");
        gVals.push(`'${esc(organism)}'`);
      }

      if (gCols.length === 0) {
        sql.push(`INSERT OR IGNORE INTO core_genome DEFAULT VALUES;`);
      } else {
        sql.push(`
          INSERT OR IGNORE INTO core_genome (${gCols.join(",")})
          VALUES (${gVals.join(",")});
        `);
      }
    }

    // 4) Ensure TF instances exist (safe columns)
    // Pair by index, but also update TF_id afterwards
    const maxLen = Math.max(uni.length, ref.length);
    for (let i = 0; i < maxLen; i++) {
      const u = uni[i];
      const r = ref[i];
      const uniprotAcc = (u?.accession || "").trim();
      const refseqAcc = (r?.accession || "").trim();
      if (!uniprotAcc && !refseqAcc) continue;

      const desc = (u?.description || r?.description || "").trim();

      const cols = [];
      const vals = [];

      if (tfiCols.has("uniprot_accession")) {
        cols.push("uniprot_accession");
        vals.push(uniprotAcc ? `'${esc(uniprotAcc)}'` : "NULL");
      }
      if (tfiCols.has("refseq_accession")) {
        cols.push("refseq_accession");
        vals.push(refseqAcc ? `'${esc(refseqAcc)}'` : "NULL");
      }
      if (tfiCols.has("description")) {
        cols.push("description");
        vals.push(`'${esc(desc)}'`);
      }
      if (tfiCols.has("TF_id")) {
        cols.push("TF_id");
        vals.push(`(SELECT TF_id FROM core_tf WHERE LOWER(name)=LOWER('${esc(tfName)}') LIMIT 1)`);
      }

      if (cols.length === 0) {
        sql.push(`INSERT OR IGNORE INTO core_tfinstance DEFAULT VALUES;`);
      } else {
        sql.push(`
          INSERT OR IGNORE INTO core_tfinstance (${cols.join(",")})
          VALUES (${vals.join(",")});
        `);
      }

      // Update TF_id if missing
      if (tfiCols.has("TF_id")) {
        if (uniprotAcc && tfiCols.has("uniprot_accession")) {
          sql.push(`
            UPDATE core_tfinstance
            SET TF_id=(SELECT TF_id FROM core_tf WHERE LOWER(name)=LOWER('${esc(tfName)}') LIMIT 1)
            WHERE uniprot_accession='${esc(uniprotAcc)}' AND (TF_id IS NULL OR TF_id='');
          `);
        }
        if (refseqAcc && tfiCols.has("refseq_accession")) {
          sql.push(`
            UPDATE core_tfinstance
            SET TF_id=(SELECT TF_id FROM core_tf WHERE LOWER(name)=LOWER('${esc(tfName)}') LIMIT 1)
            WHERE refseq_accession='${esc(refseqAcc)}' AND (TF_id IS NULL OR TF_id='');
          `);
        }
      }
    }

    // 5) Ensure experimental techniques exist (safe columns)
    for (const t of normalizedTechniques) {
      const eco = normalizeEco(t.eco);
      if (!eco) continue;

      const cols = [];
      const vals = [];

      if (techCols.has("EO_term")) {
        cols.push("EO_term");
        vals.push(`'${esc(eco)}'`);
      }
      if (techCols.has("description")) {
        cols.push("description");
        vals.push(`'${esc(t.description || t.techDescription || "")}'`);
      }
      if (techCols.has("name")) {
        cols.push("name");
        vals.push(t.name ? `'${esc(t.name)}'` : "NULL");
      }
      if (techCols.has("preset_function")) {
        cols.push("preset_function");
        vals.push("NULL");
      }

      if (cols.length === 0) {
        sql.push(`INSERT OR IGNORE INTO core_experimentaltechnique DEFAULT VALUES;`);
      } else {
        sql.push(`
          INSERT OR IGNORE INTO core_experimentaltechnique (${cols.join(",")})
          VALUES (${vals.join(",")});
        `);
      }

      // category bridge (optional)
      const categoryId = t.categoryId || t.category_id || t.selectedCategory || null;
      if (categoryId) {
        sql.push(`
          INSERT OR IGNORE INTO core_experimentaltechnique_categories
            (experimentaltechnique_id, experimentaltechniquecategory_id)
          VALUES (
            (SELECT technique_id FROM core_experimentaltechnique WHERE EO_term='${esc(eco)}' LIMIT 1),
            ${Number(categoryId)}
          );
        `);
      }
    }

    // 6) Create curation (rellena NOT NULL básicos)
    {
      const cols = [];
      const vals = [];

      if (curCols.has("publication_id")) {
        cols.push("publication_id");
        vals.push(`(SELECT publication_id FROM core_publication WHERE ${pubAltClause} LIMIT 1)`);
      }

      // notes
      if (curCols.has("notes")) {
        cols.push("notes");
        vals.push(`'${esc(combinedNotes)}'`);
      }

      if (curCols.has("requires_revision")) {
        cols.push("requires_revision");
        vals.push(`${truthyBool(requiresRevision)}`);
      }

      if (curCols.has("forms_complex")) {
        cols.push("forms_complex");
        vals.push("0");
      }

      if (curCols.has("TF_species")) {
        cols.push("TF_species");
        vals.push(`'${esc((tfSpecies || "").trim() || "Unknown")}'`);
      }

      if (curCols.has("site_species")) {
        cols.push("site_species");
        vals.push(`'${esc((siteSpecies || "").trim() || "Unknown")}'`);
      }

      // Si hay otros NOT NULL y no los hemos puesto, ponemos defaults seguros
      // (evita crashes por NOT NULL inesperados)
      for (const nn of curNN) {
        if (cols.includes(nn)) continue;
        // saltamos PK auto
        if (nn === "curation_id") continue;
        // si tiene default en schema, no hace falta, pero no lo tenemos aquí; usamos default safe
        cols.push(nn);
        vals.push(pickTextDefault(curTypes.get(nn)));
      }

      sql.push(`
        INSERT INTO core_curation (${cols.join(",")})
        VALUES (${vals.join(",")});
      `);
      sql.push(`INSERT INTO _tmp_curation(curation_id) VALUES (last_insert_rowid());`);
    }

    // 7) Link curation to TF instances
    // OJO: si no encuentra TF_instance_id -> NULL -> FK fail.
    // Insertamos solo si existe.
    if (await runQuery(`SELECT name FROM sqlite_master WHERE type='table' AND name='core_curation_TF_instances' LIMIT 1;`).then(r => r.length > 0)) {
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

    // 8) Sites: siteinstance + curation_siteinstance + techniques + regulation
    for (const site of sites) {
      const hit = getSelectedHitForSite(site, step4Data);
      if (!hit) continue;

      const genomeAcc = hit.acc;
      const start = Number(hit.start) + 1;
      const end = Number(hit.end) + 1;
      const strand = hit.strand || "+";
      const mappedSeq = hit.match || site;

      // --- Insert siteinstance (sin seq si no existe)
      {
        const cols = [];
        const vals = [];

        if (siteCols.has("genome_id")) {
          cols.push("genome_id");
          vals.push(`(SELECT genome_id FROM core_genome WHERE genome_accession='${esc(genomeAcc)}' LIMIT 1)`);
        }
        if (siteCols.has("start")) {
          cols.push("start");
          vals.push(`${start}`);
        }
        if (siteCols.has("end")) {
          cols.push("end");
          vals.push(`${end}`);
        }
        if (siteCols.has("strand")) {
          cols.push("strand");
          vals.push(`'${esc(strand)}'`);
        }
        if (siteCols.has("seq")) {
          cols.push("seq");
          vals.push(`'${esc(mappedSeq)}'`);
        } else if (siteCols.has("sequence")) {
          cols.push("sequence");
          vals.push(`'${esc(mappedSeq)}'`);
        }

        if (cols.length === 0) {
          sql.push(`INSERT INTO core_siteinstance DEFAULT VALUES;`);
        } else {
          sql.push(`
            INSERT INTO core_siteinstance (${cols.join(",")})
            VALUES (${vals.join(",")});
          `);
        }

        sql.push(`
          INSERT OR REPLACE INTO _tmp_sites(site, site_instance_id, curation_siteinstance_id, motif_id)
          VALUES ('${esc(site)}', last_insert_rowid(), NULL, NULL);
        `);
      }

      // --- If motif is required: create motif row and store motif_id in _tmp_sites
      if (motifRequired && motifTable) {
        // Try create a minimal motif row.
        // We'll satisfy NOT NULL columns with safe defaults.
        const mCols = [];
        const mVals = [];

        // Prefer consensus/name/sequence columns if exist
        if (motifCols?.has("consensus")) {
          mCols.push("consensus");
          mVals.push(`'${esc(site)}'`);
        } else if (motifCols?.has("sequence")) {
          mCols.push("sequence");
          mVals.push(`'${esc(site)}'`);
        } else if (motifCols?.has("name")) {
          mCols.push("name");
          mVals.push(`'${esc(site)}'`);
        }

        if (motifNN && motifTypes) {
          for (const nn of motifNN) {
            if (mCols.includes(nn)) continue;
            // Skip PK-like
            if (nn.endsWith("_id") && (nn.includes("motif") || nn === "id")) continue;
            mCols.push(nn);
            mVals.push(pickTextDefault(motifTypes.get(nn)));
          }
        }

        if (mCols.length === 0) {
          sql.push(`INSERT INTO ${motifTable} DEFAULT VALUES;`);
        } else {
          sql.push(`INSERT INTO ${motifTable} (${mCols.join(",")}) VALUES (${mVals.join(",")});`);
        }

        sql.push(`
          UPDATE _tmp_sites
          SET motif_id = last_insert_rowid()
          WHERE site='${esc(site)}';
        `);
      }

      // --- Insert curation_siteinstance (motif_id if required)
      {
        const ann = annotations[site] || {};
        const tfType = ann.tfType || "not specified";
        const tfFunc = ann.tfFunc || "not specified";

        const cols = [];
        const vals = [];

        if (csiCols.has("curation_id")) {
          cols.push("curation_id");
          vals.push(`(SELECT curation_id FROM _tmp_curation)`);
        }
        if (csiCols.has("site_instance_id")) {
          cols.push("site_instance_id");
          vals.push(`(SELECT site_instance_id FROM _tmp_sites WHERE site='${esc(site)}')`);
        }

        // annotated_seq column name differs sometimes
        if (csiCols.has("annotated_seq")) {
          cols.push("annotated_seq");
          vals.push(`'${esc(site)}'`);
        } else if (csiCols.has("annotated_sequence")) {
          cols.push("annotated_sequence");
          vals.push(`'${esc(site)}'`);
        }

        if (csiCols.has("TF_type")) {
          cols.push("TF_type");
          vals.push(`'${esc(tfType)}'`);
        }
        if (csiCols.has("TF_function")) {
          cols.push("TF_function");
          vals.push(`'${esc(tfFunc)}'`);
        }
        if (csiCols.has("is_high_throughput")) {
          cols.push("is_high_throughput");
          vals.push("0");
        }

        // motif_id if required/existing
        if (motifRequired && csiCols.has("motif_id")) {
          cols.push("motif_id");
          vals.push(`(SELECT motif_id FROM _tmp_sites WHERE site='${esc(site)}')`);
        }

        // Fill other NOT NULL in curation_siteinstance with safe defaults (avoid crash)
        const csiTypes = await getColTypes("core_curation_siteinstance");
        for (const nn of csiNN) {
          if (cols.includes(nn)) continue;
          if (nn === "curation_siteinstance_id") continue;
          cols.push(nn);
          vals.push(pickTextDefault(csiTypes.get(nn)));
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

      // --- Link techniques to this site if ann.useTechniques
      if (annotations[site]?.useTechniques) {
        // table name fixed in your ER
        sql.push(`
          -- link experimental techniques to site
        `);
        for (const t of normalizedTechniques) {
          const eco = normalizeEco(t.eco);
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

      // --- Regulation (only if regulation table + gene exists)
      const regGenes = regulation?.[site]?.regulatedGenes || [];
      for (const g of regGenes) {
        const locus = (g?.locus || "").trim();
        if (!locus) continue;

        // Insert only columns that exist
        const cols = [];
        const vals = [];

        // In ER: curation_site_instance_id (note: your log shows core_regulation.curation_site_instance_id maybe)
        if (regCols.has("curation_site_instance_id")) {
          cols.push("curation_site_instance_id");
          vals.push(`(SELECT curation_siteinstance_id FROM _tmp_sites WHERE site='${esc(site)}')`);
        } else if (regCols.has("curation_siteinstance_id")) {
          cols.push("curation_siteinstance_id");
          vals.push(`(SELECT curation_siteinstance_id FROM _tmp_sites WHERE site='${esc(site)}')`);
        }

        if (regCols.has("gene_id")) {
          cols.push("gene_id");
          vals.push(`(SELECT gene_id FROM core_gene WHERE locus_tag='${esc(locus)}' LIMIT 1)`);
        }

        if (regCols.has("evidence_type")) {
          cols.push("evidence_type");
          vals.push("NULL");
        }
        if (regCols.has("meta_site_id")) {
          cols.push("meta_site_id");
          vals.push("NULL");
        }

        if (cols.length) {
          sql.push(`
            INSERT OR IGNORE INTO core_regulation (${cols.join(",")})
            VALUES (${vals.join(",")});
          `);
        }
      }
    }

    // 9) Update publication completion flag again (safe)
    if (pubCols.has("curation_complete")) {
      sql.push(`
        UPDATE core_publication
        SET curation_complete=${truthyBool(curationComplete)}
        WHERE ${pubAltClause};
      `);
    }

    sql.push("COMMIT;");
    return sql.join("\n");
  }

  async function handleSubmit() {
    setMsg("");

    if (!publication) return setMsg("Falta Step1 (publication).");
    if (!tf) return setMsg("Falta Step2 (TF).");
    if (!step4Data?.sites?.length) return setMsg("Falta Step4 (reported sites).");
    if (!step5Data?.annotations) return setMsg("Falta Step5 (site annotation).");

    setLoading(true);
    try {
      const normalized = normalizeTechList(techniques);

      // Nota: si quieres forzar que técnicas nuevas tengan categoryId, hazlo aquí.
      // Ahora NO bloqueamos: insertamos técnica y categoría si llega.
      const sqlString = await buildSqlScript(normalized);

      await dispatchWorkflow({
        inputs: { queries: sqlString },
      });

      setMsg("Curación enviada. La base de datos se actualizará automáticamente tras el workflow y redeploy.");
    } catch (e) {
      console.error(e);
      setMsg(`Error al enviar: ${e?.message || String(e)}`);
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
        <div className={`text-sm ${msg.startsWith("Bien") ? "text-green-400" : "text-red-400"}`}>
          {msg}
        </div>
      )}
    </div>
  );
}

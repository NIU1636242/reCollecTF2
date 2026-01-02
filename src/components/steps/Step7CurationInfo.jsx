// src/components/steps/Step7CurationInformation.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useCuration } from "../../context/CurationContext";
import { runQuery } from "../../db/queryExecutor";
import { dispatchWorkflow } from "../../utils/serverless";

// -----------------------------
// Helpers: schema introspection
// -----------------------------
async function tableExists(name) {
  const rows = await runQuery(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
    [name]
  );
  return rows?.length > 0;
}

async function getTableInfo(table) {
  // Returns PRAGMA table_info rows: {cid, name, type, notnull, dflt_value, pk}
  try {
    const rows = await runQuery(`PRAGMA table_info(${table});`);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function colsSet(infoRows) {
  return new Set((infoRows || []).map((r) => r.name));
}

function pickCol(colSet, candidates) {
  return candidates.find((c) => colSet.has(c)) || null;
}

function esc(v) {
  return String(v ?? "").replace(/'/g, "''");
}

function asBool01(v) {
  return v ? 1 : 0;
}

// Build INSERT using only existing columns.
// `valuesSql` should already be SQL-safe (strings escaped).
function buildInsertSql(table, colSet, dataObj) {
  const cols = Object.keys(dataObj).filter((k) => colSet.has(k));
  if (cols.length === 0) return null;

  const values = cols.map((k) => dataObj[k]);
  return `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${values.join(", ")});`;
}

// INSERT ... SELECT ... WHERE NOT EXISTS pattern (safe against duplicates)
function buildInsertIfNotExistsSql({ table, insertCols, selectSql, whereNotExistsSql }) {
  return `
INSERT INTO ${table} (${insertCols.join(", ")})
SELECT ${selectSql}
WHERE NOT EXISTS (${whereNotExistsSql});
`.trim();
}

// -----------------------------
// MAIN COMPONENT
// -----------------------------
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

  // UI state
  const REVISION_OPTIONS = useMemo(
    () => [
      { value: "None", label: "None" },
      { value: "No comparable genome in NCBI", label: "No comparable genome in NCBI" },
      { value: "Matching genome still in progress", label: "Matching genome still in progress" },
      { value: "No comparable TF protein sequence in NCBI", label: "No comparable TF protein sequence in NCBI" },
      { value: "Other reason (specify in notes)", label: "Other reason (specify in notes)" },
    ],
    []
  );

  const [revisionRequired, setRevisionRequired] = useState("None");
  const [curationComplete, setCurationComplete] = useState(false);
  const [notes, setNotes] = useState("");
  const [submitChecked, setSubmitChecked] = useState(false);

  const [statusMsg, setStatusMsg] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // -----------------------------
  // Minimal validation
  // -----------------------------
  const canSubmit = !!publication?.pmid && !!tf && Array.isArray(genomeList) && genomeList.length > 0;

  // -----------------------------
  // Core submit
  // -----------------------------
  async function handleSubmit() {
    setStatusMsg("");
    if (!submitChecked) {
      setStatusMsg("Please check “I want to submit this curation” before submitting.");
      return;
    }
    if (!canSubmit) {
      setStatusMsg("Missing required data (Publication / TF / at least one Genome).");
      return;
    }

    setSubmitting(true);

    try {
      // -----------------------------
      // 1) Detect schema safely
      // -----------------------------
      const hasPublication = await tableExists("core_publication");
      const hasCuration = await tableExists("core_curation");
      if (!hasPublication || !hasCuration) {
        setStatusMsg("Database schema missing core_publication or core_curation. Cannot submit.");
        setSubmitting(false);
        return;
      }

      const pubInfo = await getTableInfo("core_publication");
      const curInfo = await getTableInfo("core_curation");
      const pubCols = colsSet(pubInfo);
      const curCols = colsSet(curInfo);

      // Optional tables
      const hasCurator = await tableExists("core_curator");
      const curatorInfo = hasCurator ? await getTableInfo("core_curator") : [];
      const curatorCols = colsSet(curatorInfo);

      const hasTF = await tableExists("core_tf");
      const hasTFFamily = await tableExists("core_tffamily");
      const tfInfo = hasTF ? await getTableInfo("core_tf") : [];
      const tfCols = colsSet(tfInfo);

      const famInfo = hasTFFamily ? await getTableInfo("core_tffamily") : [];
      const famCols = colsSet(famInfo);

      const hasTFInstance = await tableExists("core_tfinstance");
      const tfiInfo = hasTFInstance ? await getTableInfo("core_tfinstance") : [];
      const tfiCols = colsSet(tfiInfo);

      const hasCurationTFInstances = await tableExists("core_curation_TF_instances");
      const ctfiInfo = hasCurationTFInstances ? await getTableInfo("core_curation_TF_instances") : [];
      const ctfiCols = colsSet(ctfiInfo);

      const hasGenome = await tableExists("core_genome");
      const genomeInfo = hasGenome ? await getTableInfo("core_genome") : [];
      const genomeCols = colsSet(genomeInfo);

      const hasSiteInstance = await tableExists("core_siteinstance");
      const siInfo = hasSiteInstance ? await getTableInfo("core_siteinstance") : [];
      const siCols = colsSet(siInfo);

      const hasCurationSiteInstance = await tableExists("core_curation_siteinstance");
      const csiInfo = hasCurationSiteInstance ? await getTableInfo("core_curation_siteinstance") : [];
      const csiCols = colsSet(csiInfo);

      const hasMotif = await tableExists("core_motif");
      const motifInfo = hasMotif ? await getTableInfo("core_motif") : [];
      const motifCols = colsSet(motifInfo);

      const hasExperimentalTechnique = await tableExists("core_experimentaltechnique");
      const etInfo = hasExperimentalTechnique ? await getTableInfo("core_experimentaltechnique") : [];
      const etCols = colsSet(etInfo);

      const hasCsiTech = await tableExists("core_curation_siteinstance_experimental_techniques");
      const csitInfo = hasCsiTech ? await getTableInfo("core_curation_siteinstance_experimental_techniques") : [];
      const csitCols = colsSet(csitInfo);

      const hasRegulation = await tableExists("core_regulation");
      const regInfo = hasRegulation ? await getTableInfo("core_regulation") : [];
      const regCols = colsSet(regInfo);

      const hasGene = await tableExists("core_gene");
      const geneInfo = hasGene ? await getTableInfo("core_gene") : [];
      const geneCols = colsSet(geneInfo);

      // -----------------------------
      // 2) Determine IDs safely via subselects
      // -----------------------------
      // publication_id by pmid (safer than trusting object)
      const pubIdCol = pickCol(pubCols, ["publication_id", "id"]);
      const pmidCol = pickCol(pubCols, ["pmid"]);
      if (!pubIdCol || !pmidCol) {
        setStatusMsg("core_publication missing publication_id or pmid column.");
        setSubmitting(false);
        return;
      }

      // Curator id fallback (if required)
      let curatorIdSql = "NULL";
      if (curCols.has("curator_id")) {
        // get first curator id (stable fallback)
        if (hasCurator) {
          const curatorIdCol = pickCol(curatorCols, ["curator_id", "id"]);
          if (curatorIdCol) {
            curatorIdSql = `(SELECT ${curatorIdCol} FROM core_curator ORDER BY ${curatorIdCol} ASC LIMIT 1)`;
          }
        }
        // If no curators table, we still must provide something -> 1 as fallback
        if (curatorIdSql === "NULL") curatorIdSql = "1";
      }

      // -----------------------------
      // 3) Build SQL list
      // -----------------------------
      const sql = [];
      sql.push("PRAGMA foreign_keys=ON;");

      // --- Update publication flags if those columns exist
      const containsPromoterCol = pickCol(pubCols, ["contains_promoter_data", "promoter_data", "containsPromoterData"]);
      const containsExprCol = pickCol(pubCols, ["contains_expression_data", "expression_data", "containsExpressionData"]);
      const curationCompleteCol = pickCol(pubCols, ["curation_complete", "is_curated", "curated"]);
      const reportedTfCol = pickCol(pubCols, ["reported_TF", "reported_tf"]);
      const reportedSpeciesCol = pickCol(pubCols, ["reported_species"]);

      // Only include columns that exist
      const pubUpdates = [];
      if (containsPromoterCol) pubUpdates.push(`${containsPromoterCol}=${asBool01(!!strainData?.promoterInfo)}`);
      if (containsExprCol) pubUpdates.push(`${containsExprCol}=${asBool01(!!strainData?.expressionInfo)}`);
      if (curationCompleteCol) pubUpdates.push(`${curationCompleteCol}=${asBool01(!!curationComplete)}`);

      // Optional: store reported TF/species strings if present in schema
      if (reportedTfCol && tf?.name) pubUpdates.push(`${reportedTfCol}='${esc(tf.name)}'`);

      if (pubUpdates.length > 0) {
        sql.push(
          `UPDATE core_publication SET ${pubUpdates.join(", ")} WHERE ${pmidCol}='${esc(publication.pmid)}';`
        );
      }

      // --- Ensure TF family/TF exist if schema supports it (skip if not)
      if (hasTFFamily && tf?.isNewFamily && tf?.newFamilyName) {
        const famNameCol = pickCol(famCols, ["name"]);
        const famDescCol = pickCol(famCols, ["description"]);
        if (famNameCol) {
          const insertCols = [famNameCol];
          const selectParts = [`'${esc(tf.newFamilyName)}'`];
          if (famDescCol) {
            insertCols.push(famDescCol);
            selectParts.push(`'${esc(tf.newFamilyDesc || "")}'`);
          }
          sql.push(
            buildInsertIfNotExistsSql({
              table: "core_tffamily",
              insertCols,
              selectSql: selectParts.join(", "),
              whereNotExistsSql: `SELECT 1 FROM core_tffamily WHERE ${famNameCol}='${esc(tf.newFamilyName)}'`,
            })
          );
        }
      }

      if (hasTF && tf?.name) {
        const tfNameCol = pickCol(tfCols, ["name"]);
        const tfDescCol = pickCol(tfCols, ["description"]);
        const tfFamilyIdCol = pickCol(tfCols, ["family_id"]);
        if (tfNameCol) {
          // Determine family id SQL: either existing selected family_id or subselect by family name
          let familyIdSql = "NULL";
          if (tfFamilyIdCol) {
            if (tf?.family_id) familyIdSql = Number(tf.family_id);
            else if (tf?.family) {
              // subselect by family name if we have core_tffamily
              if (hasTFFamily) {
                const famNameCol = "name";
                const famIdCol = pickCol(famCols, ["tf_family_id", "family_id", "id"]);
                if (famIdCol) familyIdSql = `(SELECT ${famIdCol} FROM core_tffamily WHERE ${famNameCol}='${esc(tf.family)}' LIMIT 1)`;
              }
            }
          }

          // Insert TF if not exists
          const insertCols = [tfNameCol];
          const selectParts = [`'${esc(tf.name)}'`];

          if (tfFamilyIdCol) {
            insertCols.push(tfFamilyIdCol);
            selectParts.push(familyIdSql);
          }
          if (tfDescCol) {
            insertCols.push(tfDescCol);
            selectParts.push(`'${esc(tf.description || "")}'`);
          }

          sql.push(
            buildInsertIfNotExistsSql({
              table: "core_tf",
              insertCols,
              selectSql: selectParts.join(", "),
              whereNotExistsSql: `SELECT 1 FROM core_tf WHERE ${tfNameCol}='${esc(tf.name)}'`,
            })
          );
        }
      }

      // --- Ensure Experimental Techniques exist (core_experimentaltechnique) if provided
      // Techniques array may contain strings (ECO:xxxx) or objects
      if (hasExperimentalTechnique && Array.isArray(techniques) && techniques.length > 0) {
        const ecoCol = pickCol(etCols, ["EO_term", "eco_id", "eco", "code", "id"]);
        const nameCol = pickCol(etCols, ["name", "label"]);
        const descCol = pickCol(etCols, ["description"]);
        if (ecoCol) {
          techniques.forEach((t) => {
            const eco = typeof t === "string" ? t : (t.ecoId || t.eco || t.EO_term || t.code || "");
            const nm = typeof t === "string" ? "" : (t.name || t.label || "");
            if (!eco) return;

            const insertCols = [ecoCol];
            const selectParts = [`'${esc(eco)}'`];
            if (nameCol && nm) {
              insertCols.push(nameCol);
              selectParts.push(`'${esc(nm)}'`);
            } else if (nameCol) {
              // keep NULL if no name
              insertCols.push(nameCol);
              selectParts.push("NULL");
            }
            if (descCol) {
              insertCols.push(descCol);
              selectParts.push("NULL");
            }

            sql.push(
              buildInsertIfNotExistsSql({
                table: "core_experimentaltechnique",
                insertCols,
                selectSql: selectParts.join(", "),
                whereNotExistsSql: `SELECT 1 FROM core_experimentaltechnique WHERE ${ecoCol}='${esc(eco)}'`,
              })
            );
          });
        }
      }

      // --- Create curation row (core_curation)
      const curationIdCol = pickCol(curCols, ["curation_id", "id"]);
      const curationPubIdCol = pickCol(curCols, ["publication_id"]);
      if (!curationIdCol || !curationPubIdCol) {
        setStatusMsg("core_curation missing curation_id or publication_id.");
        setSubmitting(false);
        return;
      }

      const requiresRevisionCol = pickCol(curCols, ["requires_revision"]);
      const notesCol = pickCol(curCols, ["notes"]);
      const createdCol = pickCol(curCols, ["created"]);
      const lastModifiedCol = pickCol(curCols, ["last_modified"]);
      const experimentalProcessCol = pickCol(curCols, ["experimental_process"]); // optional in your ERD

      const requiresRevision01 = revisionRequired === "None" ? 0 : 1;

      // Build INSERT for core_curation using existing columns
      const curInsert = {};
      curInsert[curationPubIdCol] = `(SELECT ${pubIdCol} FROM core_publication WHERE ${pmidCol}='${esc(publication.pmid)}' LIMIT 1)`;
      if (curCols.has("curator_id")) curInsert["curator_id"] = curatorIdSql;
      if (requiresRevisionCol) curInsert[requiresRevisionCol] = requiresRevision01;
      if (experimentalProcessCol) curInsert[experimentalProcessCol] = `'${esc(revisionRequired)}'`; // storing reason text if schema supports
      if (notesCol) curInsert[notesCol] = `'${esc(notes || "")}'`;
      if (createdCol) curInsert[createdCol] = "datetime('now')";
      if (lastModifiedCol) curInsert[lastModifiedCol] = "datetime('now')";

      const curInsertSql = buildInsertSql("core_curation", curCols, curInsert);
      if (!curInsertSql) {
        setStatusMsg("Could not build core_curation INSERT with current schema.");
        setSubmitting(false);
        return;
      }
      sql.push(curInsertSql);

      const curationIdSql = `(SELECT ${curationIdCol} FROM core_curation WHERE ${curationPubIdCol}=(SELECT ${pubIdCol} FROM core_publication WHERE ${pmidCol}='${esc(publication.pmid)}' LIMIT 1) ORDER BY ${curationIdCol} DESC LIMIT 1)`;

      // --- Link TF instances (if schema supports)
      if (hasTFInstance && hasCurationTFInstances) {
        const tfiIdCol = pickCol(tfiCols, ["TF_instance_id", "tfinstance_id", "instance_id", "id"]);
        const tfiUniCol = pickCol(tfiCols, ["uniprot_accession"]);
        const tfiRefCol = pickCol(tfiCols, ["refseq_accession"]);
        const tfiTfIdCol = pickCol(tfiCols, ["TF_id", "tf_id"]);
        const coreTfIdCol = hasTF ? pickCol(tfCols, ["TF_id", "tf_id", "id"]) : null;
        const coreTfNameCol = hasTF ? pickCol(tfCols, ["name"]) : null;

        // link-table columns (unknown naming)
        const ctfiCurationCol = pickCol(ctfiCols, ["curation_id"]);
        const ctfiInstanceCol = pickCol(ctfiCols, ["tfinstance_id", "TF_instance_id", "instance_id"]);
        if (tfiIdCol && ctfiCurationCol && ctfiInstanceCol) {
          // ensure a TF row exists and get TF_id
          const tfIdSql =
            hasTF && coreTfIdCol && coreTfNameCol
              ? `(SELECT ${coreTfIdCol} FROM core_tf WHERE ${coreTfNameCol}='${esc(tf.name)}' LIMIT 1)`
              : "NULL";

          const uniAccs = (uniprotList || []).map((x) => x.accession).filter(Boolean);
          const refAccs = (refseqList || []).map((x) => x.accession).filter(Boolean);

          // create minimal TF instances for each UniProt (and match a RefSeq if same index exists)
          uniAccs.forEach((uAcc, idx) => {
            const rAcc = refAccs[idx] || null;

            // insert TF instance if possible (only columns that exist)
            const insertCols = [];
            const selectParts = [];

            if (tfiTfIdCol) {
              insertCols.push(tfiTfIdCol);
              selectParts.push(tfIdSql);
            }
            if (tfiUniCol) {
              insertCols.push(tfiUniCol);
              selectParts.push(`'${esc(uAcc)}'`);
            }
            if (tfiRefCol) {
              insertCols.push(tfiRefCol);
              selectParts.push(rAcc ? `'${esc(rAcc)}'` : "NULL");
            }

            if (insertCols.length > 0) {
              const whereNE = [];
              if (tfiUniCol) whereNE.push(`${tfiUniCol}='${esc(uAcc)}'`);
              // if UniProt exists, treat that as unique key
              const notExistsSql = `SELECT 1 FROM core_tfinstance WHERE ${whereNE.join(" AND ")} LIMIT 1`;

              sql.push(
                buildInsertIfNotExistsSql({
                  table: "core_tfinstance",
                  insertCols,
                  selectSql: selectParts.join(", "),
                  whereNotExistsSql: notExistsSql,
                })
              );

              // link to curation
              sql.push(
                buildInsertIfNotExistsSql({
                  table: "core_curation_TF_instances",
                  insertCols: [ctfiCurationCol, ctfiInstanceCol],
                  selectSql: `${curationIdSql}, (SELECT ${tfiIdCol} FROM core_tfinstance WHERE ${tfiUniCol}='${esc(uAcc)}' ORDER BY ${tfiIdCol} DESC LIMIT 1)`,
                  whereNotExistsSql: `SELECT 1 FROM core_curation_TF_instances WHERE ${ctfiCurationCol}=${curationIdSql} AND ${ctfiInstanceCol}=(SELECT ${tfiIdCol} FROM core_tfinstance WHERE ${tfiUniCol}='${esc(uAcc)}' ORDER BY ${tfiIdCol} DESC LIMIT 1)`,
                })
              );
            }
          });
        }
      }

      // --- Motif “Not specified” (only if core_motif exists AND curation_siteinstance has motif_id NOT NULL)
      let motifIdSql = "NULL";
      const motifIdCol = pickCol(motifCols, ["motif_id", "id"]);
      const motifNameCol = pickCol(motifCols, ["name"]);
      const csiMotifCol = pickCol(csiCols, ["motif_id"]);
      const motifNotNull = !!(csiInfo || []).find((r) => r.name === "motif_id" && Number(r.notnull) === 1);

      if (hasMotif && motifIdCol && motifNameCol && csiMotifCol && motifNotNull) {
        // ensure motif exists
        sql.push(
          buildInsertIfNotExistsSql({
            table: "core_motif",
            insertCols: [motifNameCol],
            selectSql: `'Not specified'`,
            whereNotExistsSql: `SELECT 1 FROM core_motif WHERE ${motifNameCol}='Not specified'`,
          })
        );
        motifIdSql = `(SELECT ${motifIdCol} FROM core_motif WHERE ${motifNameCol}='Not specified' ORDER BY ${motifIdCol} DESC LIMIT 1)`;
      }

      // --- Store site mappings (step4 -> siteinstance + curation_siteinstance), best effort
      if (hasGenome && hasSiteInstance && hasCurationSiteInstance && step4Data?.sites?.length) {
        const genomeIdCol = pickCol(genomeCols, ["genome_id", "id"]);
        const genomeAccCol = pickCol(genomeCols, ["genome_accession", "accession"]);
        const siIdCol = pickCol(siCols, ["site_id", "siteinstance_id", "id"]);
        const siGenomeIdCol = pickCol(siCols, ["genome_id"]);
        const siStartCol = pickCol(siCols, ["start"]);
        const siEndCol = pickCol(siCols, ["end"]);
        const siStrandCol = pickCol(siCols, ["strand"]);
        const siSeqCol = pickCol(siCols, ["seq", "sequence", "site_seq"]); // adapt to real schema

        const csiIdCol = pickCol(csiCols, ["id", "curation_siteinstance_id"]);
        const csiCurationCol = pickCol(csiCols, ["curation_id"]);
        const csiSiteCol = pickCol(csiCols, ["site_instance_id", "site_id", "siteinstance_id"]);
        const csiTfTypeCol = pickCol(csiCols, ["TF_type", "tf_type"]);
        const csiTfFuncCol = pickCol(csiCols, ["TF_function", "tf_function"]);
        const csiNotesCol = pickCol(csiCols, ["notes"]);

        if (genomeIdCol && genomeAccCol && siIdCol && siGenomeIdCol && siStartCol && siEndCol && siStrandCol && csiCurationCol && csiSiteCol) {
          const choice = step4Data.choice || {};
          const exactHits = step4Data.exactHits || {};
          const fuzzyHits = step4Data.fuzzyHits || {};
          const annotations = step5Data?.annotations || {};

          const getSelectedHit = (site) => {
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
          };

          step4Data.sites.forEach((site) => {
            const hit = getSelectedHit(site);
            if (!hit?.acc) return;

            const ann = annotations?.[site] || {};
            const tfType = ann.tfType || "not specified";
            const tfFunc = ann.tfFunc || "not specified";

            const genomeIdSql = `(SELECT ${genomeIdCol} FROM core_genome WHERE ${genomeAccCol}='${esc(hit.acc)}' LIMIT 1)`;

            // siteinstance insert (avoid missing columns)
            const siData = {};
            siData[siGenomeIdCol] = genomeIdSql;
            siData[siStartCol] = Number(hit.start) + 1; // store 1-based
            siData[siEndCol] = Number(hit.end) + 1;
            siData[siStrandCol] = `'${esc(hit.strand || "+")}'`;
            if (siSeqCol) siData[siSeqCol] = `'${esc(hit.match || hit.site || site)}'`;

            const siInsert = buildInsertSql("core_siteinstance", siCols, siData);
            if (siInsert) {
              // insert only if not exists by (genome_id,start,end,strand)
              const existsWhere = [
                `${siGenomeIdCol}=${genomeIdSql}`,
                `${siStartCol}=${Number(hit.start) + 1}`,
                `${siEndCol}=${Number(hit.end) + 1}`,
                `${siStrandCol}='${esc(hit.strand || "+")}'`,
              ].join(" AND ");

              sql.push(
                buildInsertIfNotExistsSql({
                  table: "core_siteinstance",
                  insertCols: Object.keys(siData).filter((k) => siCols.has(k)),
                  selectSql: Object.keys(siData)
                    .filter((k) => siCols.has(k))
                    .map((k) => siData[k])
                    .join(", "),
                  whereNotExistsSql: `SELECT 1 FROM core_siteinstance WHERE ${existsWhere}`,
                })
              );
            }

            const siteInstanceIdSql = `(SELECT ${siIdCol} FROM core_siteinstance WHERE ${siGenomeIdCol}=${genomeIdSql} AND ${siStartCol}=${Number(hit.start) + 1} AND ${siEndCol}=${Number(hit.end) + 1} AND ${siStrandCol}='${esc(hit.strand || "+")}' ORDER BY ${siIdCol} DESC LIMIT 1)`;

            // curation_siteinstance insert (motif if required and available)
            const csiData = {};
            csiData[csiCurationCol] = curationIdSql;
            csiData[csiSiteCol] = siteInstanceIdSql;
            if (csiTfTypeCol) csiData[csiTfTypeCol] = `'${esc(tfType)}'`;
            if (csiTfFuncCol) csiData[csiTfFuncCol] = `'${esc(tfFunc)}'`;
            if (csiNotesCol) csiData[csiNotesCol] = "NULL";

            if (csiMotifCol && motifNotNull && motifIdSql !== "NULL") {
              csiData[csiMotifCol] = motifIdSql;
            }

            // Only insert if we won't violate NOT NULL motif_id
            const willFailMotif = motifNotNull && csiMotifCol && (!csiData[csiMotifCol] || csiData[csiMotifCol] === "NULL");
            if (!willFailMotif) {
              const csiInsert = buildInsertSql("core_curation_siteinstance", csiCols, csiData);
              if (csiInsert) sql.push(csiInsert);
            }

            // Link techniques to curation_siteinstance if that table exists (best effort)
            if (hasCsiTech && hasExperimentalTechnique && Array.isArray(techniques) && techniques.length > 0) {
              const csitCsiCol = pickCol(csitCols, ["curation_siteinstance_id", "curation_site_instance_id", "curation_siteinstance"]);
              const csitTechCol = pickCol(csitCols, ["experimentaltechnique_id", "experimental_technique_id"]);
              const techIdCol = pickCol(etCols, ["technique_id", "experimentaltechnique_id", "id"]);
              const techEcoCol = pickCol(etCols, ["EO_term", "eco", "eco_id", "code"]);

              const csiIdLookup =
                csiIdCol
                  ? `(SELECT ${csiIdCol} FROM core_curation_siteinstance WHERE ${csiCurationCol}=${curationIdSql} AND ${csiSiteCol}=${siteInstanceIdSql} ORDER BY ${csiIdCol} DESC LIMIT 1)`
                  : null;

              if (csitCsiCol && csitTechCol && techIdCol && techEcoCol && csiIdLookup) {
                techniques.forEach((t) => {
                  const eco = typeof t === "string" ? t : (t.ecoId || t.eco || t.EO_term || t.code || "");
                  if (!eco) return;

                  const techIdSql = `(SELECT ${techIdCol} FROM core_experimentaltechnique WHERE ${techEcoCol}='${esc(eco)}' LIMIT 1)`;

                  sql.push(
                    buildInsertIfNotExistsSql({
                      table: "core_curation_siteinstance_experimental_techniques",
                      insertCols: [csitCsiCol, csitTechCol],
                      selectSql: `${csiIdLookup}, ${techIdSql}`,
                      whereNotExistsSql: `SELECT 1 FROM core_curation_siteinstance_experimental_techniques WHERE ${csitCsiCol}=${csiIdLookup} AND ${csitTechCol}=${techIdSql}`,
                    })
                  );
                });
              }
            }

            // Regulation (Step6) best effort
            if (hasRegulation && hasGene && step6Data?.[site]?.regulatedGenes?.length) {
              const regCsiCol = pickCol(regCols, ["curation_site_instance_id", "curation_siteinstance_id"]);
              const regGeneCol = pickCol(regCols, ["gene_id"]);
              const geneIdCol = pickCol(geneCols, ["gene_id", "id"]);
              const geneGenomeIdCol = pickCol(geneCols, ["genome_id"]);
              const geneLocusCol = pickCol(geneCols, ["locus_tag", "locus"]);

              const csiIdLookup =
                csiIdCol
                  ? `(SELECT ${csiIdCol} FROM core_curation_siteinstance WHERE ${csiCurationCol}=${curationIdSql} AND ${csiSiteCol}=${siteInstanceIdSql} ORDER BY ${csiIdCol} DESC LIMIT 1)`
                  : null;

              if (regCsiCol && regGeneCol && geneIdCol && geneGenomeIdCol && geneLocusCol && csiIdLookup) {
                step6Data[site].regulatedGenes.forEach((g) => {
                  if (!g?.locus) return;

                  const geneIdSql = `(SELECT ${geneIdCol} FROM core_gene WHERE ${geneGenomeIdCol}=${genomeIdSql} AND ${geneLocusCol}='${esc(g.locus)}' LIMIT 1)`;

                  sql.push(
                    buildInsertIfNotExistsSql({
                      table: "core_regulation",
                      insertCols: [regCsiCol, regGeneCol],
                      selectSql: `${csiIdLookup}, ${geneIdSql}`,
                      whereNotExistsSql: `SELECT 1 FROM core_regulation WHERE ${regCsiCol}=${csiIdLookup} AND ${regGeneCol}=${geneIdSql}`,
                    })
                  );
                });
              }
            }
          });
        }
      }

      // -----------------------------
      // 4) Dispatch workflow
      // -----------------------------
      const sqlString = sql.filter(Boolean).join("\n");
      const res = await dispatchWorkflow({ inputs: { queries: sqlString } });

      if (!res?.ok) {
        const txt = await res.text().catch(() => "");
        setStatusMsg(`Submission sent, but server returned an error: ${res.status} ${txt}`);
      } else {
        setStatusMsg("Curation submitted. The database will update after the workflow and redeploy.");
      }
    } catch (e) {
      setStatusMsg(`Error while preparing submission: ${e?.message || String(e)}`);
    } finally {
      setSubmitting(false);
    }
  }

  // -----------------------------
  // Render
  // -----------------------------
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Step 7 – Curation information</h2>

      <div className="bg-surface border border-border rounded p-4 space-y-4">
        {/* Revision required */}
        <div className="space-y-2">
          <label className="block font-medium">Revision required</label>
          <select
            className="form-control w-full"
            value={revisionRequired}
            onChange={(e) => setRevisionRequired(e.target.value)}
          >
            {REVISION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted">
            Select, if needed, the reason why this curation may require revision.
          </p>
        </div>

        {/* Curation complete */}
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={curationComplete}
            onChange={(e) => setCurationComplete(e.target.checked)}
          />
          <span>
            Curation for this paper is complete.
            <div className="text-xs text-muted">
              Check this box if there are no more curations pending for this paper.
            </div>
          </span>
        </label>

        {/* Notes */}
        <div className="space-y-2">
          <label className="block font-medium">Notes</label>
          <textarea
            className="form-control w-full min-h-[180px]"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Include any relevant notes (e.g., why sites were left out, surrogate genome choice, etc.)."
          />
        </div>

        {/* Submit toggle */}
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={submitChecked}
            onChange={(e) => setSubmitChecked(e.target.checked)}
          />
          <span>
            I want to submit this curation
            <div className="text-xs text-muted">
              Check to submit when you click “Submit curation”.
            </div>
          </span>
        </label>

        <button
          className="btn"
          onClick={handleSubmit}
          disabled={submitting || !submitChecked || !canSubmit}
          title={!canSubmit ? "Missing required data from previous steps." : ""}
        >
          {submitting ? "Submitting..." : "Submit curation"}
        </button>

        {statusMsg && (
          <div className="text-sm">
            {statusMsg.includes("submitted") ? (
              <span className="text-emerald-400">{statusMsg}</span>
            ) : (
              <span className="text-yellow-300">{statusMsg}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

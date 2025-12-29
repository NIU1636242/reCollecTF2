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

async function tableExists(name) {
  const rows = await runQuery(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1;`,
    [name]
  );
  return rows.length > 0;
}
async function pragmaTableInfo(name) {
  return await runQuery(`PRAGMA table_info(${name});`);
}
async function pragmaForeignKeys(name) {
  return await runQuery(`PRAGMA foreign_key_list(${name});`);
}
async function getCols(name) {
  const info = await pragmaTableInfo(name);
  return new Set(info.map((r) => r.name));
}
async function getNotNullCols(name) {
  const info = await pragmaTableInfo(name);
  return new Set(info.filter((r) => r.notnull === 1).map((r) => r.name));
}
async function getColTypes(name) {
  const info = await pragmaTableInfo(name);
  const m = new Map();
  info.forEach((r) => m.set(r.name, (r.type || "").toUpperCase()));
  return m;
}
function defaultForType(type) {
  const t = (type || "").toUpperCase();
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

  const [revisionReason, setRevisionReason] = useState("None");
  const [curationComplete, setCurationComplete] = useState(true);
  const [notes, setNotes] = useState("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  // sin checkbox extra
  const canSubmit = useMemo(() => {
    return (
      !!publication &&
      !!tf &&
      (step4Data?.sites?.length ?? 0) > 0 &&
      !!step5Data?.annotations &&
      !loading
    );
  }, [publication, tf, step4Data, step5Data, loading]);

  function normalizeTechList(raw) {
    const list = (raw || []).map((t) =>
      typeof t === "string"
        ? { eco: normalizeEco(t) }
        : { ...t, eco: normalizeEco(t.eco || t.EO_term || t.code) }
    );
    return list.filter((x) => x.eco);
  }

  async function resolveMotifTable() {
    // Si core_curation_siteinstance tiene FK en motif_id, lo leemos
    if (!(await tableExists("core_curation_siteinstance"))) return null;

    const fks = await pragmaForeignKeys("core_curation_siteinstance");
    const motifFk = fks.find((fk) => fk.from === "motif_id");
    if (motifFk?.table) return motifFk.table;

    // Fallback: intenta nombres típicos (por si no hay FK declarado pero sí NOT NULL)
    const candidates = ["core_motif", "core_metasite", "core_meta_site"];
    for (const c of candidates) {
      if (await tableExists(c)) return c;
    }
    return null;
  }

  async function buildSqlScript(normalizedTechniques) {
    if (!publication) throw new Error("Falta Step1 (publication).");
    if (!tf) throw new Error("Falta Step2 (TF).");
    if (!step4Data?.sites?.length) throw new Error("Falta Step4 (reported sites).");
    if (!step5Data?.annotations) throw new Error("Falta Step5 (site annotation).");

    // --- columns we will touch
    const pubCols = await getCols("core_publication");
    const curCols = await getCols("core_curation");
    const curNN = await getNotNullCols("core_curation");
    const curTypes = await getColTypes("core_curation");

    const genomeCols = await getCols("core_genome");
    const siteCols = await getCols("core_siteinstance");

    const csiCols = await getCols("core_curation_siteinstance");
    const csiNN = await getNotNullCols("core_curation_siteinstance");
    const csiTypes = await getColTypes("core_curation_siteinstance");

    const tfiCols = await getCols("core_tfinstance");
    const regTableExists = await tableExists("core_regulation");
    const regCols = regTableExists ? await getCols("core_regulation") : new Set();

    // --- publication identification (prefer PMID)
    const pmid = publication?.pmid ? String(publication.pmid).trim() : "";
    const doi = publication?.doi && publication.doi !== "No DOI" ? String(publication.doi).trim() : "";

    const hasValidPmid = pmid && isPmid(pmid) && pubCols.has("pmid");
    const hasValidDoi = doi && isDoi(doi) && pubCols.has("doi");

    if (!hasValidPmid && !hasValidDoi) {
      throw new Error(
        "No puedo identificar la publicación para crear la curation. Necesito PMID numérico o DOI válido (y que existan esas columnas en core_publication)."
      );
    }

    const pubWhere = hasValidPmid
      ? `pmid='${esc(pmid)}'`
      : `doi='${esc(doi)}'`;

    // --- curation notes
    const requiresRevision = revisionReason !== "None";
    const revisionText = requiresRevision ? revisionReason : "";
    const combinedNotes = [revisionText ? `Revision reason: ${revisionText}` : null, notes ? notes : null]
      .filter(Boolean)
      .join("\n");

    // --- species (NOT NULL en core_curation en tu workflow)
    const firstGenomeOrg = genomeList?.[0]?.organism || genomeList?.[0]?.description || "";
    const tfSpecies =
      (strainData?.sameStrainTF ? firstGenomeOrg : strainData?.organismReportedTF) || "Unknown";
    const siteSpecies =
      (strainData?.sameStrainGenome ? firstGenomeOrg : strainData?.organismTFBindingSites) || "Unknown";

    const containsPromoter = truthyBool(strainData?.promoterInfo);
    const containsExpression = truthyBool(strainData?.expressionInfo);

    // --- motif requirement
    const motifIdIsNN = csiNN.has("motif_id");
    const motifTable = motifIdIsNN ? await resolveMotifTable() : null;

    if (motifIdIsNN && !motifTable) {
      // esto evita que el workflow reviente sin saber por qué
      throw new Error(
        "Tu DB requiere core_curation_siteinstance.motif_id (NOT NULL), pero no puedo resolver la tabla a la que apunta motif_id. " +
          "Necesito que exista la FK o una tabla conocida (p.ej. core_motif/core_metasite) en la DB."
      );
    }

    const motifCols = motifTable ? await getCols(motifTable) : null;
    const motifNN = motifTable ? await getNotNullCols(motifTable) : null;
    const motifTypes = motifTable ? await getColTypes(motifTable) : null;

    // --- gather all genomes we MUST ensure (genomeList + hit.acc)
    const genomes = genomeList || [];
    const sites = step4Data.sites || [];
    const needGenomeAcc = new Set(genomes.map((g) => g?.accession).filter(Boolean));
    for (const s of sites) {
      const hit = getSelectedHitForSite(s, step4Data);
      if (hit?.acc) needGenomeAcc.add(hit.acc);
    }

    const uni = uniprotList || [];
    const ref = refseqList || [];
    const annotations = step5Data.annotations || {};
    const regulation = step6Data || {};

    const tfName = String(tf?.name || "").trim();
    if (!tfName) throw new Error("TF inválido: falta nombre.");

    const sql = [];
    sql.push("BEGIN TRANSACTION;");

    // temp ids
    sql.push("DROP TABLE IF EXISTS _tmp_pub;");
    sql.push("CREATE TEMP TABLE _tmp_pub(publication_id INTEGER NOT NULL);");

    sql.push("DROP TABLE IF EXISTS _tmp_curation;");
    sql.push("CREATE TEMP TABLE _tmp_curation(curation_id INTEGER NOT NULL);");

    sql.push("DROP TABLE IF EXISTS _tmp_sites;");
    sql.push(
      "CREATE TEMP TABLE _tmp_sites(site TEXT PRIMARY KEY, site_instance_id INTEGER, curation_siteinstance_id INTEGER, motif_id INTEGER);"
    );

    // 1) ensure publication exists
    {
      const cols = [];
      const vals = [];

      if (hasValidPmid) {
        cols.push("pmid");
        vals.push(`'${esc(pmid)}'`);
      }
      if (hasValidDoi) {
        cols.push("doi");
        vals.push(`'${esc(doi)}'`);
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
      }

      sql.push(
        cols.length
          ? `INSERT OR IGNORE INTO core_publication (${cols.join(",")}) VALUES (${vals.join(",")});`
          : `INSERT OR IGNORE INTO core_publication DEFAULT VALUES;`
      );

      // update flags (si existen)
      const ups = [];
      if (pubCols.has("contains_promoter_data")) ups.push(`contains_promoter_data=${containsPromoter}`);
      if (pubCols.has("contains_expression_data")) ups.push(`contains_expression_data=${containsExpression}`);
      if (pubCols.has("submission_notes")) ups.push(`submission_notes='${esc(notes)}'`);
      if (pubCols.has("curation_complete")) ups.push(`curation_complete=${truthyBool(curationComplete)}`);

      if (ups.length) {
        sql.push(`UPDATE core_publication SET ${ups.join(", ")} WHERE ${pubWhere};`);
      }

      // store publication_id for later (this avoids NULL publication_id)
      sql.push(`
        INSERT INTO _tmp_pub(publication_id)
        SELECT publication_id
        FROM core_publication
        WHERE ${pubWhere}
        LIMIT 1;
      `);
    }

    // 2) ensure genomes exist (including step4 hits)
    for (const acc of Array.from(needGenomeAcc)) {
      if (!acc) continue;
      const g = genomes.find((x) => x?.accession === acc);
      const organism = g?.organism || g?.description || "";

      const cols = [];
      const vals = [];
      if (genomeCols.has("genome_accession")) {
        cols.push("genome_accession");
        vals.push(`'${esc(acc)}'`);
      }
      if (genomeCols.has("organism")) {
        cols.push("organism");
        vals.push(`'${esc(organism)}'`);
      }

      sql.push(
        cols.length
          ? `INSERT OR IGNORE INTO core_genome (${cols.join(",")}) VALUES (${vals.join(",")});`
          : `INSERT OR IGNORE INTO core_genome DEFAULT VALUES;`
      );
    }

    // 3) ensure TF instances exist (optional but helps FK later)
    {
      const maxLen = Math.max(uni.length, ref.length);
      for (let i = 0; i < maxLen; i++) {
        const u = uni[i];
        const r = ref[i];
        const uniprotAcc = String(u?.accession || "").trim();
        const refseqAcc = String(r?.accession || "").trim();
        if (!uniprotAcc && !refseqAcc) continue;

        const desc = String(u?.description || r?.description || "").trim();

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

        sql.push(
          cols.length
            ? `INSERT OR IGNORE INTO core_tfinstance (${cols.join(",")}) VALUES (${vals.join(",")});`
            : `INSERT OR IGNORE INTO core_tfinstance DEFAULT VALUES;`
        );
      }
    }

    // 4) techniques (solo si las tablas existen)
    if (await tableExists("core_experimentaltechnique")) {
      const techCols = await getCols("core_experimentaltechnique");

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

        sql.push(
          cols.length
            ? `INSERT OR IGNORE INTO core_experimentaltechnique (${cols.join(",")}) VALUES (${vals.join(",")});`
            : `INSERT OR IGNORE INTO core_experimentaltechnique DEFAULT VALUES;`
        );

        // category bridge (si existe)
        if (await tableExists("core_experimentaltechnique_categories")) {
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
      }
    }

    // 5) create curation (rellena NOT NULL con defaults)
    {
      const cols = [];
      const vals = [];

      if (curCols.has("publication_id")) {
        cols.push("publication_id");
        vals.push(`(SELECT publication_id FROM _tmp_pub LIMIT 1)`);
      }

      if (curCols.has("TF_species")) {
        cols.push("TF_species");
        vals.push(`'${esc(tfSpecies)}'`);
      }
      if (curCols.has("site_species")) {
        cols.push("site_species");
        vals.push(`'${esc(siteSpecies)}'`);
      }

      if (curCols.has("requires_revision")) {
        cols.push("requires_revision");
        vals.push(`${truthyBool(requiresRevision)}`);
      }
      if (curCols.has("forms_complex")) {
        cols.push("forms_complex");
        vals.push("0");
      }
      if (curCols.has("notes")) {
        cols.push("notes");
        vals.push(`'${esc(combinedNotes)}'`);
      }

      // completa cualquier otro NOT NULL desconocido
      for (const nn of curNN) {
        if (nn === "curation_id") continue;
        if (cols.includes(nn)) continue;
        cols.push(nn);
        vals.push(defaultForType(curTypes.get(nn)));
      }

      sql.push(`INSERT INTO core_curation (${cols.join(",")}) VALUES (${vals.join(",")});`);
      sql.push(`INSERT INTO _tmp_curation(curation_id) VALUES (last_insert_rowid());`);
    }

    // 6) link curation <-> TF_instances (solo si existe la tabla puente)
    if (await tableExists("core_curation_TF_instances")) {
      for (const u of uni) {
        const acc = String(u?.accession || "").trim();
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
        const acc = String(r?.accession || "").trim();
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

    // 7) sites: siteinstance + motif + curation_siteinstance + techniques + regulation
    for (const site of sites) {
      const hit = getSelectedHitForSite(site, step4Data);
      if (!hit) continue;

      const genomeAcc = hit.acc;
      const start = Number(hit.start) + 1;
      const end = Number(hit.end) + 1;
      const strand = hit.strand || "+";
      const mappedSeq = hit.match || site;

      // 7.1 insert siteinstance
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
        }

        sql.push(`INSERT INTO core_siteinstance (${cols.join(",")}) VALUES (${vals.join(",")});`);
        sql.push(`
          INSERT OR REPLACE INTO _tmp_sites(site, site_instance_id, curation_siteinstance_id, motif_id)
          VALUES ('${esc(site)}', last_insert_rowid(), NULL, NULL);
        `);
      }

      // 7.2 ensure motif row if needed
      if (motifIdIsNN && motifTable) {
        // crea una fila mínima cumpliendo NOT NULL
        const mCols = [];
        const mVals = [];

        // intenta usar algún campo típico para “identidad”
        if (motifCols?.has("name")) {
          mCols.push("name");
          mVals.push(`'${esc(site)}'`);
        } else if (motifCols?.has("sequence")) {
          mCols.push("sequence");
          mVals.push(`'${esc(site)}'`);
        } else if (motifCols?.has("consensus")) {
          mCols.push("consensus");
          mVals.push(`'${esc(site)}'`);
        } else if (motifCols?.has("delegate_id")) {
          // en core_metasite existe delegate_id (según tu ER)
          mCols.push("delegate_id");
          mVals.push("NULL");
        }

        if (motifNN && motifTypes) {
          for (const nn of motifNN) {
            // evita PK autoincrement típica
            if (nn.endsWith("_id") || nn === "id") continue;
            if (mCols.includes(nn)) continue;
            mCols.push(nn);
            mVals.push(defaultForType(motifTypes.get(nn)));
          }
        }

        if (mCols.length) {
          sql.push(`INSERT INTO ${motifTable} (${mCols.join(",")}) VALUES (${mVals.join(",")});`);
        } else {
          sql.push(`INSERT INTO ${motifTable} DEFAULT VALUES;`);
        }

        sql.push(`
          UPDATE _tmp_sites
          SET motif_id = last_insert_rowid()
          WHERE site='${esc(site)}';
        `);
      }

      // 7.3 insert curation_siteinstance
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
        if (csiCols.has("annotated_seq")) {
          cols.push("annotated_seq");
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

        if (motifIdIsNN && csiCols.has("motif_id")) {
          cols.push("motif_id");
          vals.push(`(SELECT motif_id FROM _tmp_sites WHERE site='${esc(site)}')`);
        }

        // completar otros NOT NULL
        for (const nn of csiNN) {
          if (nn === "id" || nn === "curation_siteinstance_id") continue;
          if (cols.includes(nn)) continue;
          cols.push(nn);
          vals.push(defaultForType(csiTypes.get(nn)));
        }

        sql.push(`INSERT INTO core_curation_siteinstance (${cols.join(",")}) VALUES (${vals.join(",")});`);
        sql.push(`
          UPDATE _tmp_sites
          SET curation_siteinstance_id = last_insert_rowid()
          WHERE site='${esc(site)}';
        `);
      }

      // 7.4 link techniques to site (si la tabla existe)
      if (annotations[site]?.useTechniques && (await tableExists("core_curation_siteinstance_experimental_techniques"))) {
        for (const t of normalizedTechniques) {
          const eco = normalizeEco(t.eco);
          if (!eco) continue;
          sql.push(`
            INSERT OR IGNORE INTO core_curation_siteinstance_experimental_techniques
              (curation_siteinstance_id, experimentaltechnique_id)
            SELECT
              (SELECT curation_siteinstance_id FROM _tmp_sites WHERE site='${esc(site)}'),
              technique_id
            FROM core_experimentaltechnique
            WHERE EO_term='${esc(eco)}'
            LIMIT 1;
          `);
        }
      }

      // 7.5 regulation (solo inserta si gene existe -> evita FK fail)
      if (regTableExists) {
        const regGenes = regulation?.[site]?.regulatedGenes || [];
        for (const g of regGenes) {
          const locus = String(g?.locus || "").trim();
          if (!locus) continue;

          const csiCol =
            regCols.has("curation_site_instance_id")
              ? "curation_site_instance_id"
              : regCols.has("curation_siteinstance_id")
                ? "curation_siteinstance_id"
                : null;

          if (!csiCol || !regCols.has("gene_id")) continue;

          sql.push(`
            INSERT OR IGNORE INTO core_regulation (${csiCol}, gene_id)
            SELECT
              (SELECT curation_siteinstance_id FROM _tmp_sites WHERE site='${esc(site)}'),
              gene_id
            FROM core_gene
            WHERE locus_tag='${esc(locus)}'
            LIMIT 1;
          `);
        }
      }
    }

    // 8) update publication completion flag again
    if (pubCols.has("curation_complete")) {
      sql.push(`UPDATE core_publication SET curation_complete=${truthyBool(curationComplete)} WHERE ${pubWhere};`);
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
      const sqlString = await buildSqlScript(normalized);

      await dispatchWorkflow({ inputs: { queries: sqlString } });

      setMsg("✅ Curación enviada. La base de datos se actualizará automáticamente tras el workflow y redeploy.");
    } catch (e) {
      console.error(e);
      setMsg(`❌ Error al enviar: ${e?.message || String(e)}`);
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

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

// Reconstruct selected hit from step4Data
function getSelectedHitForSite(site, step4Data) {
    const sel = step4Data?.choice?.[site];
    if (!sel) return null;

    if (sel.startsWith("ex-")) {
        const idx = Number(sel.split("-")[1]);
        const hit = step4Data.exactHits?.[site]?.[idx];
        return hit && hit !== "none" ? hit : null;
    }
    if (sel.startsWith("fz-")) {
        const idx = Number(sel.split("-")[1]);
        const hit = step4Data.fuzzyHits?.[site]?.[idx];
        return hit && hit !== "none" ? hit : null;
    }
    return null;
}

// --- SQLite introspection helpers
async function getTableInfo(table) {
    return await runQuery(`PRAGMA table_info(${table});`); // [{cid,name,type,notnull,dflt_value,pk}]
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

async function tableExists(name) {
    const rows = await runQuery(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1;`,
        [name]
    );
    return rows.length > 0;
}

function pickDefaultForType(type) {
    if (!type) return "''";
    const t = String(type).toUpperCase();
    if (t.includes("INT") || t.includes("REAL") || t.includes("NUM")) return "0";
    // sqlite stores booleans as ints typically; but text default is ok as empty string
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

    // Normalize techniques: supports strings or objects from Step3
    function normalizeTechList(raw) {
        const list = (raw || [])
            .map((t) => {
                if (typeof t === "string") return { ecoId: normalizeEco(t), name: t };
                const ecoId = normalizeEco(t.ecoId || t.eco || t.EO_term || t.code || t.id);
                if (!ecoId) return null;
                return { ...t, ecoId, name: t.name || t.label || ecoId };
            })
            .filter(Boolean);

        // de-duplicate by ecoId
        const seen = new Set();
        return list.filter((x) => {
            if (seen.has(x.ecoId)) return false;
            seen.add(x.ecoId);
            return true;
        });
    }

    async function buildSqlScript(normalizedTechniques) {
        if (!publication) throw new Error("Missing publication (Step 1).");
        if (!tf) throw new Error("Missing TF (Step 2).");
        if (!step4Data?.sites?.length) throw new Error("Missing reported sites (Step 4).");
        if (!step5Data?.annotations) throw new Error("Missing site annotations (Step 5).");

        // -------------------------
        // Introspect schema
        // -------------------------
        const pubCols = await getCols("core_publication");
        const curCols = await getCols("core_curation");
        const curNN = await getNotNullCols("core_curation");
        const curTypes = await getColTypes("core_curation");

        const genomeCols = await getCols("core_genome");
        const tfiCols = await getCols("core_tfinstance");
        const techCols = await getCols("core_experimentaltechnique");

        const hasCurationTfBridge = await tableExists("core_curation_TF_instances");

        const siteCols = await getCols("core_siteinstance");

        const csiExists = await tableExists("core_curation_siteinstance");
        if (!csiExists) throw new Error("Table core_curation_siteinstance not found.");

        const csiCols = await getCols("core_curation_siteinstance");
        const csiNN = await getNotNullCols("core_curation_siteinstance");
        const csiTypes = await getColTypes("core_curation_siteinstance");

        const hasMetaSite = await tableExists("core_metasite");
        const metaCols = hasMetaSite ? await getCols("core_metasite") : new Set();

        const hasTechBridge = await tableExists("core_curation_siteinstance_experimental_techniques");

        const hasReg = await tableExists("core_regulation");
        const hasGene = await tableExists("core_gene");
        const regCols = hasReg ? await getCols("core_regulation") : new Set();

        // -------------------------
        // Publication identifier clause
        // -------------------------
        const doiUrl =
            publication.doi && publication.doi !== "No DOI" && isDoi(publication.doi)
                ? `https://doi.org/${publication.doi}`
                : "";

        const pubClause =
            (publication.pmid && pubCols.has("pmid") && isPmid(publication.pmid) && `pmid='${esc(publication.pmid)}'`) ||
            (publication.doi && pubCols.has("doi") && isDoi(publication.doi) && `doi='${esc(publication.doi)}'`) ||
            (doiUrl && pubCols.has("url") && `url='${esc(doiUrl)}'`);

        if (!pubClause) {
            throw new Error("Cannot identify publication row (no PMID/DOI/URL supported in schema).");
        }

        // -------------------------
        // Species fields
        // -------------------------
        const firstGenomeOrg =
            genomeList?.[0]?.organism ||
            genomeList?.[0]?.description ||
            "";

        const tfSpecies = strainData?.sameStrainTF ? firstGenomeOrg : (strainData?.organismReportedTF || "");
        const siteSpecies = strainData?.sameStrainGenome ? firstGenomeOrg : (strainData?.organismTFBindingSites || "");

        // -------------------------
        // Notes / revision
        // -------------------------
        const requiresRevision = revisionReason !== "None";
        const revisionText = requiresRevision ? revisionReason : "";

        const combinedNotes = [
            revisionText ? `Revision reason: ${revisionText}` : null,
            notes ? notes : null,
        ].filter(Boolean).join("\n");

        const containsPromoter = truthyBool(strainData?.promoterInfo);
        const containsExpression = truthyBool(strainData?.expressionInfo);

        // -------------------------
        // Collected step data
        // -------------------------
        const tfName = String(tf?.name || "").trim();
        if (!tfName) throw new Error("TF name missing.");

        const genomes = genomeList || [];
        const uni = uniprotList || [];
        const ref = refseqList || [];

        const sites = step4Data.sites || [];
        const annotations = step5Data.annotations || {};
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
        // NOTE: your DB uses meta_site_id / motif_id; keep meta_site_id temp for convenience
        sql.push("CREATE TEMP TABLE _tmp_sites(site TEXT PRIMARY KEY, site_instance_id INTEGER, curation_siteinstance_id INTEGER, meta_site_id INTEGER);");

        // 1) Publication upsert (minimal columns)
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
            }
            if (pubCols.has("url") && doiUrl) {
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

            if (cols.length) {
                sql.push(`
          INSERT OR IGNORE INTO core_publication (${cols.join(",")})
          VALUES (${vals.join(",")});
        `);
            } else {
                sql.push(`INSERT OR IGNORE INTO core_publication DEFAULT VALUES;`);
            }

            // Guardar publication_id en temp (robusto)
            sql.push(`
                DELETE FROM _tmp_pub;
                INSERT INTO _tmp_pub(publication_id)
                SELECT publication_id
                FROM core_publication
                WHERE ${pubClause}
                ORDER BY publication_id DESC
                LIMIT 1;
            `);

            const upd = [];
            if (pubCols.has("contains_promoter_data")) upd.push(`contains_promoter_data=${containsPromoter}`);
            if (pubCols.has("contains_expression_data")) upd.push(`contains_expression_data=${containsExpression}`);
            if (pubCols.has("submission_notes")) upd.push(`submission_notes='${esc(combinedNotes)}'`);
            if (pubCols.has("curation_complete")) upd.push(`curation_complete=${truthyBool(curationComplete)}`);
            if (pubCols.has("reported_TF")) upd.push(`reported_TF='${esc(tfName)}'`);
            if (pubCols.has("reported_species") && (siteSpecies || tfSpecies)) upd.push(`reported_species='${esc(siteSpecies || tfSpecies)}'`);

            if (upd.length) {
                sql.push(`
          UPDATE core_publication
          SET ${upd.join(", ")}
          WHERE ${pubClause};
        `);
            }
        }

        // 2) Ensure genomes exist
        for (const g of genomes) {
            const acc = (g?.accession || "").trim();
            if (!acc) continue;
            const organism = (g?.organism || g?.description || "").trim();

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

            if (cols.length) {
                sql.push(`
          INSERT OR IGNORE INTO core_genome (${cols.join(",")})
          VALUES (${vals.join(",")});
        `);
            } else {
                sql.push(`INSERT OR IGNORE INTO core_genome DEFAULT VALUES;`);
            }
        }

        // 3) Ensure TF instances exist and are linked to TF
        {
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

                if (cols.length) {
                    sql.push(`
            INSERT OR IGNORE INTO core_tfinstance (${cols.join(",")})
            VALUES (${vals.join(",")});
          `);
                } else {
                    sql.push(`INSERT OR IGNORE INTO core_tfinstance DEFAULT VALUES;`);
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
        }

        // 4) Ensure experimental techniques exist (minimal)
        for (const t of normalizedTechniques) {
            const eco = normalizeEco(t.ecoId);
            if (!eco) continue;

            const cols = [];
            const vals = [];

            if (techCols.has("EO_term")) {
                cols.push("EO_term");
                vals.push(`'${esc(eco)}'`);
            }
            if (techCols.has("name")) {
                cols.push("name");
                vals.push(t.name ? `'${esc(t.name)}'` : "NULL");
            }
            if (techCols.has("description") && t.description) {
                cols.push("description");
                vals.push(`'${esc(t.description)}'`);
            }

            if (cols.length) {
                sql.push(`
          INSERT OR IGNORE INTO core_experimentaltechnique (${cols.join(",")})
          VALUES (${vals.join(",")});
        `);
            } else {
                sql.push(`INSERT OR IGNORE INTO core_experimentaltechnique DEFAULT VALUES;`);
            }
        }

        // 5) Create curation (fill NOT NULL, including confidence)
        {
            const cols = [];
            const vals = [];

            if (curCols.has("TF_species")) {
                cols.push("TF_species");
                vals.push(`'${esc((tfSpecies || "").trim() || "Unknown")}'`);
            }
            if (curCols.has("site_species")) {
                cols.push("site_species");
                vals.push(`'${esc((siteSpecies || "").trim() || "Unknown")}'`);
            }
            if (curCols.has("requires_revision")) {
                cols.push("requires_revision");
                vals.push(`${truthyBool(requiresRevision)}`);
            }
            if (curCols.has("notes")) {
                cols.push("notes");
                vals.push(`'${esc(combinedNotes)}'`);
            }
            if (curCols.has("forms_complex")) {
                cols.push("forms_complex");
                vals.push("0");
            }
            if (curCols.has("experimental_process")) {
                cols.push("experimental_process");
                vals.push(`''`);
            }
            if (curCols.has("created")) {
                cols.push("created");
                vals.push(`datetime('now')`);
            }
            if (curCols.has("last_modified")) {
                cols.push("last_modified");
                vals.push(`datetime('now')`);
            }
            if (curCols.has("publication_id")) {
                cols.push("publication_id");
                vals.push(`(SELECT publication_id FROM _tmp_pub LIMIT 1)`);
            }

            // ✅ critical fix: confidence NOT NULL in your DB
            if (curCols.has("confidence") && !cols.includes("confidence")) {
                cols.push("confidence");
                vals.push(`'not specified'`);
            }

            // ✅ Fill ANY remaining NOT NULL columns with safe defaults
            for (const nn of curNN) {
                if (cols.includes(nn)) continue;
                if (nn === "curation_id") continue; // PK
                cols.push(nn);
                vals.push(pickDefaultForType(curTypes.get(nn)));
            }

            sql.push(`
        INSERT INTO core_curation (${cols.join(",")})
        VALUES (${vals.join(",")});
      `);

            // ✅ safer than last_insert_rowid() if later inserts happen
            sql.push(`
        DELETE FROM _tmp_curation;
        INSERT INTO _tmp_curation(curation_id)
        SELECT curation_id FROM core_curation
        ORDER BY curation_id DESC
        LIMIT 1;
      `);
        }

        // 6) Link curation ↔ TF_instances (safe)
        if (hasCurationTfBridge) {
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
            AND TF_instance_id IS NOT NULL;
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
            AND TF_instance_id IS NOT NULL;
        `);
            }
        }

        // 7) Sites: siteinstance + metasite + curation_siteinstance + techniques + regulation
        for (const site of sites) {
            const hit = getSelectedHitForSite(site, step4Data);
            if (!hit) continue;

            const genomeAcc = hit.acc;
            const start = Number(hit.start) + 1;
            const end = Number(hit.end) + 1;
            const strand = hit.strand || "+";

            // --- Insert siteinstance (must have genome_id in your schema)
            {
                const cols = [];
                const vals = [];

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
                if (siteCols.has("genome_id")) {
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

            // --- Insert metasite (your schema requires meta_site_id & delegate_id NOT NULL)
            if (hasMetaSite) {
                const hasName = metaCols.has("name");
                sql.push(`
          INSERT INTO core_metasite (meta_site_id, delegate_id${hasName ? ", name" : ""})
          SELECT
            (SELECT IFNULL(MAX(meta_site_id),0)+1 FROM core_metasite),
            (SELECT IFNULL(MAX(meta_site_id),0)+1 FROM core_metasite)
            ${hasName ? `, '${esc(site)}'` : ""};
        `);

                sql.push(`
          UPDATE _tmp_sites
          SET meta_site_id = (SELECT MAX(meta_site_id) FROM core_metasite)
          WHERE site='${esc(site)}';
        `);
            }

            // --- Insert curation_siteinstance (fill NOT NULL defaults)
            {
                const ann = annotations?.[site] || {};
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
                } else if (csiCols.has("annotated_sequence")) {
                    cols.push("annotated_sequence");
                    vals.push(`'${esc(site)}'`);
                }

                if (csiCols.has("site_type")) {
                    // You store in step4Data.siteType: motif / variable / nonmotif
                    cols.push("site_type");
                    vals.push(`'${esc(step4Data.siteType || "variable")}'`);
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

                // Your DB has both meta_site_id and motif_id, and in your working SQL you used meta_site_id for both.
                if (hasMetaSite && csiCols.has("meta_site_id")) {
                    cols.push("meta_site_id");
                    vals.push(`(SELECT meta_site_id FROM _tmp_sites WHERE site='${esc(site)}')`);
                }
                if (hasMetaSite && csiCols.has("motif_id")) {
                    cols.push("motif_id");
                    vals.push(`(SELECT meta_site_id FROM _tmp_sites WHERE site='${esc(site)}')`);
                }

                // ✅ Fill any remaining NOT NULL columns with defaults
                for (const nn of csiNN) {
                    if (cols.includes(nn)) continue;
                    if (nn === "id" || nn === "curation_siteinstance_id") continue;
                    cols.push(nn);
                    vals.push(pickDefaultForType(csiTypes.get(nn)));
                }

                sql.push(`
          INSERT INTO core_curation_siteinstance (${cols.join(",")})
          VALUES (${vals.join(",")});
        `);

                sql.push(`
          UPDATE _tmp_sites
          SET curation_siteinstance_id = (SELECT last_insert_rowid())
          WHERE site='${esc(site)}';
        `);
            }

            // --- Link techniques selected for this site (Step5 new format)
            if (hasTechBridge) {
                const techMap = annotations?.[site]?.techniques || {};
                for (const t of normalizedTechniques) {
                    const eco = normalizeEco(t.ecoId);
                    if (!eco) continue;
                    if (!techMap?.[eco]) continue;

                    sql.push(`
            INSERT OR IGNORE INTO core_curation_siteinstance_experimental_techniques
              (curation_siteinstance_id, experimentaltechnique_id)
            SELECT
              (SELECT curation_siteinstance_id FROM _tmp_sites WHERE site='${esc(site)}'),
              technique_id
            FROM core_experimentaltechnique
            WHERE EO_term='${esc(eco)}'
              AND technique_id IS NOT NULL;
          `);
                }
            }

            // --- Regulation (only if your Step2 expressionInfo was true, but safe regardless)
            if (hasReg && hasGene) {
                const regGenes = regulation?.[site]?.regulatedGenes || [];
                for (const g of regGenes) {
                    const locus = (g?.locus || "").trim();
                    if (!locus) continue;

                    // Choose correct FK column name for curation_siteinstance_id in regulation table
                    const csiFkCol =
                        (regCols.has("curation_site_instance_id") && "curation_site_instance_id") ||
                        (regCols.has("curation_siteinstance_id") && "curation_siteinstance_id") ||
                        null;

                    if (!csiFkCol) continue; // schema doesn't support linking

                    sql.push(`
            INSERT OR IGNORE INTO core_regulation (${csiFkCol}, gene_id)
            SELECT
              (SELECT curation_siteinstance_id FROM _tmp_sites WHERE site='${esc(site)}'),
              gene_id
            FROM core_gene
            WHERE locus_tag='${esc(locus)}'
              AND gene_id IS NOT NULL;
          `);
                }
            }
        }

        // 8) Update publication completion flag again (optional)
        if (pubCols.has("curation_complete")) {
            sql.push(`
        UPDATE core_publication
        SET curation_complete=${truthyBool(curationComplete)}
        WHERE ${pubClause};
      `);
        }

        sql.push("COMMIT;");
        return sql.join("\n");
    }

    async function handleSubmit() {
        setMsg("");

        if (!publication) return setMsg("Missing Step 1 (publication).");
        if (!tf) return setMsg("Missing Step 2 (TF).");
        if (!step4Data?.sites?.length) return setMsg("Missing Step 4 (reported sites).");
        if (!step5Data?.annotations) return setMsg("Missing Step 5 (site annotation).");

        setLoading(true);
        try {
            const normalized = normalizeTechList(techniques);
            const sqlString = await buildSqlScript(normalized);

            await dispatchWorkflow({
                inputs: { queries: sqlString },
            });

            setMsg("✅ Curación enviada. La base de datos se actualizará automáticamente tras el workflow y redeploy.");
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

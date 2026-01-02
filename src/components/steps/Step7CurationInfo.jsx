// src/components/steps/Step7CurationInformation.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useCuration } from "../../context/CurationContext";
import { runQuery } from "../../db/queryExecutor";
import { dispatchWorkflow } from "../../utils/serverless";

const REVISION_OPTIONS = [
  { value: "None", label: "None" },
  { value: "No comparable genome in NCBI", label: "No comparable genome in NCBI" },
  { value: "Matching genome still in progress", label: "Matching genome still in progress" },
  { value: "No comparable TF protein sequence in NCBI", label: "No comparable TF protein sequence in NCBI" },
  { value: "Other reason (specify in notes)", label: "Other reason (specify in notes)" },
];

function esc(str) {
  return String(str ?? "").replace(/'/g, "''");
}

async function tableColumns(tableName) {
  // returns Set of column names that exist in that table
  const rows = await runQuery(`PRAGMA table_info(${tableName});`);
  return new Set((rows || []).map((r) => r.name));
}

async function tableExists(tableName) {
  const rows = await runQuery(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1;`,
    [tableName]
  );
  return (rows || []).length > 0;
}

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

  const [revisionRequired, setRevisionRequired] = useState("None");
  const [curationComplete, setCurationComplete] = useState(false);
  const [notes, setNotes] = useState("");
  const [submitChecked, setSubmitChecked] = useState(false);

  const [statusMsg, setStatusMsg] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // ---------- helpers to derive species ----------
  const defaultSiteSpecies = useMemo(() => {
    // prefer user input if "not same strain genome"
    const s = strainData?.organismTFBindingSites?.trim();
    if (s) return s;
    // else try first genome organism/description
    const g0 = genomeList?.[0];
    return (g0?.organism || g0?.description || "").trim();
  }, [strainData, genomeList]);

  const defaultTfSpecies = useMemo(() => {
    const s = strainData?.organismReportedTF?.trim();
    if (s) return s;
    // fallback: first genome organism
    const g0 = genomeList?.[0];
    return (g0?.organism || g0?.description || "").trim();
  }, [strainData, genomeList]);

  // ---------- maps UniProt/RefSeq -> core_tfinstance ids (if possible) ----------
  async function resolveTfInstanceIds() {
    // Try to map current uniprot/refseq lists to existing TF_instance_id in DB
    // (works if your DB already contains those accessions in core_tfinstance)
    const ids = new Set();

    const uniAccs = (uniprotList || []).map((x) => x?.accession).filter(Boolean);
    const refAccs = (refseqList || []).map((x) => x?.accession).filter(Boolean);

    if (uniAccs.length === 0 && refAccs.length === 0) return [];

    // UniProt mapping
    if (uniAccs.length) {
      const placeholders = uniAccs.map(() => "?").join(",");
      const rows = await runQuery(
        `SELECT TF_instance_id FROM core_tfinstance WHERE uniprot_accession IN (${placeholders});`,
        uniAccs
      );
      (rows || []).forEach((r) => ids.add(r.TF_instance_id));
    }

    // RefSeq mapping
    if (refAccs.length) {
      const placeholders = refAccs.map(() => "?").join(",");
      const rows = await runQuery(
        `SELECT TF_instance_id FROM core_tfinstance WHERE refseq_accession IN (${placeholders});`,
        refAccs
      );
      (rows || []).forEach((r) => ids.add(r.TF_instance_id));
    }

    return Array.from(ids);
  }

  // ---------- main submit ----------
  async function handleSubmit() {
    setStatusMsg("");

    if (!publication?.publication_id && !publication?.id && !publication?.pmid) {
      setStatusMsg("Publication not found. Please complete Step 1 first.");
      return;
    }

    if (!submitChecked) {
      setStatusMsg("Please check “I want to submit this curation” before submitting.");
      return;
    }

    setSubmitting(true);

    try {
      // 1) pick publication_id safely
      // In your DB diagram it's publication_id.
      // In your Step1 you likely store it as publication.publication_id.
      const publicationId =
        publication?.publication_id ?? publication?.id ?? null;

      if (!publicationId) {
        setStatusMsg("Could not determine publication_id. Ensure Step 1 returns publication_id.");
        setSubmitting(false);
        return;
      }

      // 2) get a curator_id that exists (first row)
      let curatorId = null;
      const curatorRows = await runQuery(
        `SELECT curator_id FROM core_curator ORDER BY curator_id ASC LIMIT 1;`
      );
      if (curatorRows?.length) curatorId = curatorRows[0].curator_id;

      if (!curatorId) {
        setStatusMsg("No curator found in core_curator. Insert at least one curator row first.");
        setSubmitting(false);
        return;
      }

      // 3) inspect schema (columns) to avoid “no such column”
      const hasCorePublication = await tableExists("core_publication");
      const hasCoreCuration = await tableExists("core_curation");
      if (!hasCorePublication || !hasCoreCuration) {
        setStatusMsg("Missing required tables (core_publication/core_curation) in DB.");
        setSubmitting(false);
        return;
      }

      const pubCols = await tableColumns("core_publication");
      const curationCols = await tableColumns("core_curation");

      const hasLinkTfInstances = await tableExists("core_curation_TF_instances");
      const linkTfCols = hasLinkTfInstances ? await tableColumns("core_curation_TF_instances") : new Set();

      // 4) Build SQL safely
      const sql = [];

      sql.push("PRAGMA foreign_keys=ON;");

      // 4a) UPDATE core_publication flags if those columns exist
      const pubUpdates = [];

      // diagram suggests: contains_promoter_data, contains_expression_data, curation_complete, submission_note
      if (pubCols.has("contains_promoter_data")) {
        pubUpdates.push(`contains_promoter_data=${strainData?.promoterInfo ? 1 : 0}`);
      }
      if (pubCols.has("contains_expression_data")) {
        pubUpdates.push(`contains_expression_data=${strainData?.expressionInfo ? 1 : 0}`);
      }
      if (pubCols.has("curation_complete")) {
        pubUpdates.push(`curation_complete=${curationComplete ? 1 : 0}`);
      }
      // only update if the column really exists (your error showed it might NOT)
      if (pubCols.has("submission_note")) {
        const note = revisionRequired !== "None" ? revisionRequired : "";
        pubUpdates.push(`submission_note='${esc(note)}'`);
      }

      if (pubUpdates.length) {
        sql.push(
          `UPDATE core_publication SET ${pubUpdates.join(", ")} WHERE publication_id=${Number(publicationId)};`
        );
      }

      // 4b) INSERT core_curation (ONLY columns that exist; ensure NOT NULL filled)
      // We always include the “must-have” if present: curator_id, publication_id
      const cCols = [];
      const cVals = [];

      // required-ish fields
      if (curationCols.has("curator_id")) {
        cCols.push("curator_id");
        cVals.push(String(Number(curatorId)));
      }
      if (curationCols.has("publication_id")) {
        cCols.push("publication_id");
        cVals.push(String(Number(publicationId)));
      }

      // NOT NULL errors you saw: TF_species
      if (curationCols.has("TF_species")) {
        const v = defaultTfSpecies || "Unknown";
        cCols.push("TF_species");
        cVals.push(`'${esc(v)}'`);
      }
      if (curationCols.has("site_species")) {
        const v = defaultSiteSpecies || "Unknown";
        cCols.push("site_species");
        cVals.push(`'${esc(v)}'`);
      }

      // revision flag / notes (only if exist)
      if (curationCols.has("requires_revision")) {
        cCols.push("requires_revision");
        cVals.push(revisionRequired !== "None" ? "1" : "0");
      }

      if (curationCols.has("submission_note")) {
        const v = revisionRequired !== "None" ? revisionRequired : "";
        cCols.push("submission_note");
        cVals.push(`'${esc(v)}'`);
      }

      // free text notes
      if (curationCols.has("curation_notes")) {
        cCols.push("curation_notes");
        cVals.push(`'${esc(notes)}'`);
      } else if (curationCols.has("notes")) {
        cCols.push("notes");
        cVals.push(`'${esc(notes)}'`);
      }

      // timestamps (optional)
      if (curationCols.has("created")) {
        cCols.push("created");
        cVals.push("CURRENT_TIMESTAMP");
      }
      if (curationCols.has("last_modified")) {
        cCols.push("last_modified");
        cVals.push("CURRENT_TIMESTAMP");
      }

      // If for some reason we ended with no columns (shouldn't), abort
      if (cCols.length < 2) {
        setStatusMsg("core_curation does not expose expected columns. Check schema.");
        setSubmitting(false);
        return;
      }

      sql.push(`INSERT INTO core_curation (${cCols.join(", ")}) VALUES (${cVals.join(", ")});`);

      // 4c) OPTIONAL: link TF instances (only if table + columns exist)
      // This avoids NOT NULL core_curation_TF_instances.curation_id by using last_insert_rowid()
      if (hasLinkTfInstances && linkTfCols.has("curation_id")) {
        const tfInstanceIds = await resolveTfInstanceIds();

        // Column could be tfinstance_id or TF_instance_id or instance_id depending on your schema.
        const tfIdCol =
          linkTfCols.has("tfinstance_id")
            ? "tfinstance_id"
            : linkTfCols.has("TF_instance_id")
            ? "TF_instance_id"
            : linkTfCols.has("instance_id")
            ? "instance_id"
            : null;

        if (tfIdCol && tfInstanceIds.length) {
          tfInstanceIds.forEach((id) => {
            sql.push(
              `INSERT OR IGNORE INTO core_curation_TF_instances (curation_id, ${tfIdCol}) VALUES (last_insert_rowid(), ${Number(id)});`
            );
          });
        }
      }

      // NOTE:
      // We intentionally DO NOT insert core_curation_siteinstance / experimental technique links / regulation
      // because your schema requires motif_id, curation_siteinstance_id, etc. that you can’t provide yet.

      const sqlString = sql.join("\n");

      // 5) Dispatch workflow
      const res = await dispatchWorkflow({ inputs: { queries: sqlString } });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        setStatusMsg(`Submission failed: ${res.status} ${res.statusText}\n${txt}`);
        setSubmitting(false);
        return;
      }

      setStatusMsg(
        "Curation submitted. The database will be updated automatically after the workflow and redeploy."
      );
    } catch (e) {
      console.error(e);
      setStatusMsg(`Error: ${e?.message || String(e)}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Step 7 – Curation information</h2>

      {/* REVISION REQUIRED */}
      <div className="bg-surface border border-border rounded p-4 space-y-2">
        <label className="block font-medium">Revision required</label>
        <select
          className="form-control"
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

        <label className="flex items-start gap-2 text-sm mt-2">
          <input
            type="checkbox"
            checked={curationComplete}
            onChange={(e) => setCurationComplete(e.target.checked)}
          />
          <span>
            Curation for this paper is complete.
            <br />
            <span className="text-xs text-muted">
              Check this box if there are no more curations pending for this paper.
            </span>
          </span>
        </label>

        <div className="mt-2">
          <label className="block font-medium">Notes</label>
          <textarea
            className="form-control h-40"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Include any relevant notes (e.g., why sites were left out, surrogate genome choice, etc.)."
          />
          <p className="text-xs text-muted mt-1">
            Used for additional context and for “Other reason”.
          </p>
        </div>

        <label className="flex items-start gap-2 text-sm mt-2">
          <input
            type="checkbox"
            checked={submitChecked}
            onChange={(e) => setSubmitChecked(e.target.checked)}
          />
          <span>
            I want to submit this curation
            <br />
            <span className="text-xs text-muted">
              Check to submit when you click “Submit curation”.
            </span>
          </span>
        </label>
      </div>

      <button className="btn" onClick={handleSubmit} disabled={submitting}>
        {submitting ? "Submitting..." : "Submit curation"}
      </button>

      {statusMsg && (
        <div className="text-sm whitespace-pre-wrap">
          {statusMsg.startsWith("Error") || statusMsg.startsWith("Submission failed") ? (
            <span className="text-red-400">{statusMsg}</span>
          ) : (
            <span className="text-emerald-300">{statusMsg}</span>
          )}
        </div>
      )}
    </div>
  );
}

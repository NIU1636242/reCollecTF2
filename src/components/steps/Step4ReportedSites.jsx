import React, { useState, useEffect } from "react";
import JSZip from "jszip";
import { useCuration } from "../../context/CurationContext";

// ======================================================================
// REVERSE COMPLEMENT
// ======================================================================
function revComp(seq) {
  const map = { A: "T", T: "A", C: "G", G: "C" };
  return seq
    .split("")
    .reverse()
    .map((n) => map[n] || "N")
    .join("");
}

// ======================================================================
// SEARCH EXACT MATCHES (forward + reverse)
// ======================================================================
function findMatches(genomeSeq, reportedSeq) {
  const seq = reportedSeq.toUpperCase();
  const rev = revComp(seq);
  const len = seq.length;

  const results = [];

  // forward
  let i = genomeSeq.indexOf(seq);
  while (i !== -1) {
    results.push({
      seq,
      reportedSeq,
      start: i,
      end: i + len - 1,
      strand: "+",
    });
    i = genomeSeq.indexOf(seq, i + 1);
  }

  // reverse
  let j = genomeSeq.indexOf(rev);
  while (j !== -1) {
    results.push({
      seq: rev,
      reportedSeq,
      start: j,
      end: j + len - 1,
      strand: "-",
    });
    j = genomeSeq.indexOf(rev, j + 1);
  }

  return results;
}

// ======================================================================
// FIND NEARBY GENES
// (very simple heuristic)
// ======================================================================
function findNearbyGenes(match, genes, dist = 150) {
  if (!genes) return [];

  return genes.filter((g) => {
    const near =
      Math.abs(g.start - match.start) < dist ||
      Math.abs(g.end - match.end) < dist;
    return near;
  });
}

// ======================================================================
// DOWNLOAD FASTA SEQUENCE FROM NCBI DATASETS API
// ======================================================================
async function fetchGenomeSequence(accession) {
  const url = `https://api.ncbi.nlm.nih.gov/datasets/v2alpha/genome/accession/${accession}/download?include=sequence&filename=fasta.zip`;

  try {
    const r = await fetch(url);
    if (!r.ok) {
      throw new Error("Failed to download FASTA zip");
    }

    const blob = await r.blob();
    const zip = await JSZip.loadAsync(blob);

    // look for .fa or .fna
    const fileName = Object.keys(zip.files).find(
      (f) => f.endsWith(".fa") || f.endsWith(".fna")
    );
    if (!fileName) throw new Error("No FASTA file found in zip");

    const text = await zip.file(fileName).async("string");

    const seq = text
      .split("\n")
      .filter((l) => !l.startsWith(">"))
      .join("")
      .toUpperCase();

    return seq;
  } catch (err) {
    console.error("Error fetching genome FASTA", accession, err);
    return null;
  }
}

// ======================================================================
// DOWNLOAD GENE ANNOTATION FROM NCBI DATASETS API
// ======================================================================
async function fetchGenomeGenes(accession) {
  const url = `https://api.ncbi.nlm.nih.gov/datasets/v2alpha/genome/accession/${accession}/annotation_report?filters=gene`;

  try {
    const r = await fetch(url);
    if (!r.ok) {
      throw new Error("Failed to fetch annotation report");
    }

    const json = await r.json();
    if (!json?.data) return [];

    return json.data.map((g) => ({
      start: g.location.start,
      end: g.location.end,
      strand: g.location.strand === "minus" ? -1 : 1,
      locus: g.gene_id,
      gene: g.gene_name || "",
      product: g.product || "",
    }));
  } catch (err) {
    console.error("Error fetching genome genes", accession, err);
    return [];
  }
}

// ======================================================================
// COMPONENT
// ======================================================================
export default function Step4ReportedSites() {
  const { genomeList } = useCuration();

  const [accordionOpen, setAccordionOpen] = useState({
    step1: true,
    step2: false,
    step3: false,
    step4: false,
  });

  const [siteType, setSiteType] = useState("motif");
  const [rawInput, setRawInput] = useState("");
  const [sites, setSites] = useState([]);

  const [matches, setMatches] = useState([]);

  const [loadedGenomes, setLoadedGenomes] = useState({});

  // ======================================================================
  // LOAD GENOMES FROM NCBI
  // ======================================================================
  useEffect(() => {
    async function load() {
      if (!genomeList?.length) return;

      const result = {};

      for (const g of genomeList) {
        const acc = g.accession;

        const seq = await fetchGenomeSequence(acc);
        const genes = await fetchGenomeGenes(acc);

        if (seq) {
          result[acc] = { seq, genes };
        }
      }

      setLoadedGenomes(result);
      console.log("Loaded genomes:", result);
    }

    load();
  }, [genomeList]);

  // ======================================================================
  // STEP1: Parse input + auto run matches
  // ======================================================================
  function handleParse() {
    const seqs = rawInput
      .split(/\r?\n/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0);

    setSites(seqs);

    runExactMatchSearch(seqs);

    setAccordionOpen({
      step1: true, // keep open
      step2: true,
      step3: false,
      step4: false,
    });
  }

  // ======================================================================
  // STEP2: Run exact search
  // ======================================================================
  function runExactMatchSearch(seqs) {
    if (!Object.keys(loadedGenomes).length) {
      console.log("No genomes loaded yet");
      setMatches([]);
      return;
    }

    const collected = [];

    for (const seq of seqs) {
      for (const [acc, { seq: genomeSeq, genes }] of Object.entries(
        loadedGenomes
      )) {
        const hits = findMatches(genomeSeq, seq);

        hits.forEach((h) => {
          const near = findNearbyGenes(h, genes);
          collected.push({
            accession: acc,
            ...h,
            nearbyGenes: near,
          });
        });
      }
    }

    setMatches(collected);
  }

  // ======================================================================
  // UI
  // ======================================================================
  function toggleAccordion(step) {
    setAccordionOpen((prev) => ({
      ...prev,
      [step]: !prev[step],
    }));
  }

  // ======================================================================
  // RENDER
  // ======================================================================
  return (
    <div className="space-y-8">

      <h2 className="text-2xl font-bold">Step 4 – Reported sites</h2>

      {/* ===============================================================
          ACCORDION 1
      =============================================================== */}
      <div className="bg-surface border border-border rounded p-4">
        <button
          className="flex justify-between w-full text-lg font-semibold mb-3"
          onClick={() => toggleAccordion("step1")}
        >
          <span>1. Enter reported sites</span>
          <span>{accordionOpen.step1 ? "▲" : "▼"}</span>
        </button>

        {accordionOpen.step1 && (
          <div className="space-y-4">

            {/* SITE TYPE */}
            <div>
              <label className="block font-medium mb-1">Site type</label>

              <div className="space-y-1 text-sm">
                <label className="flex gap-2 items-center">
                  <input
                    type="radio"
                    checked={siteType === "motif"}
                    onChange={() => setSiteType("motif")}
                  />
                  motif-associated (new motif)
                </label>

                <label className="flex gap-2 items-center">
                  <input
                    type="radio"
                    checked={siteType === "variable"}
                    onChange={() => setSiteType("variable")}
                  />
                  variable motif associated
                </label>

                <label className="flex gap-2 items-center">
                  <input
                    type="radio"
                    checked={siteType === "nonmotif"}
                    onChange={() => setSiteType("nonmotif")}
                  />
                  non-motif associated
                </label>
              </div>
            </div>

            {/* INPUT */}
            <div>
              <label className="block font-medium mb-1">Sites</label>
              <textarea
                className="form-control w-full h-40"
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
                placeholder="AAGATTACATT&#10;AAGATAACATT"
              />
            </div>

            <button className="btn" onClick={handleParse}>
              Save
            </button>
          </div>
        )}
      </div>

      {/* ===============================================================
          ACCORDION 2
      =============================================================== */}
      <div className="bg-surface border border-border rounded p-4">
        <button
          className="flex justify-between w-full text-lg font-semibold mb-3"
          onClick={() => toggleAccordion("step2")}
        >
          <span>2. Exact site matches</span>
          <span>{accordionOpen.step2 ? "▲" : "▼"}</span>
        </button>

        {accordionOpen.step2 && (
          <div className="space-y-3 text-sm">

            {matches.length === 0 && (
              <p className="text-muted">No matches found.</p>
            )}

            {matches.map((m, i) => (
              <div key={i} className="p-2 border border-border rounded bg-muted">

                <p className="font-semibold">{m.reportedSeq}</p>
                <p>
                  <b>{m.accession}</b> [{m.start} – {m.end}] ({m.strand})
                </p>

                {m.nearbyGenes?.length > 0 && (
                  <table className="text-xs mt-2 w-full">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left">locus tag</th>
                        <th className="text-left">gene</th>
                        <th className="text-left">function</th>
                      </tr>
                    </thead>

                    <tbody>
                      {m.nearbyGenes.map((g, idx) => (
                        <tr key={idx} className="border-b border-border">
                          <td>{g.locus}</td>
                          <td>{g.gene}</td>
                          <td>{g.product}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===============================================================
          ACCORDION 3
      =============================================================== */}
      <div className="bg-surface border border-border rounded p-4 opacity-40">
        <button
          className="flex justify-between w-full text-lg font-semibold mb-3"
          onClick={() => toggleAccordion("step3")}
        >
          <span>3. Inexact matches</span>
          <span>{accordionOpen.step3 ? "▲" : "▼"}</span>
        </button>

        {accordionOpen.step3 && (
          <p className="text-sm text-muted">Not implemented yet.</p>
        )}
      </div>

      {/* ===============================================================
          ACCORDION 4
      =============================================================== */}
      <div className="bg-surface border border-border rounded p-4 opacity-40">
        <button
          className="flex justify-between w-full text-lg font-semibold mb-3"
          onClick={() => toggleAccordion("step4")}
        >
          <span>4. Annotate sites</span>
          <span>{accordionOpen.step4 ? "▲" : "▼"}</span>
        </button>

        {accordionOpen.step4 && (
          <p className="text-sm text-muted">Not implemented yet.</p>
        )}
      </div>
    </div>
  );
}

import React, { useState, useEffect } from "react";
import { runQuery } from "../../db/queryExecutor";
import { useCuration } from "../../context/CurationContext";

// ------------------------------------------------------------
// REVERSE COMPLEMENT
// ------------------------------------------------------------
function revComp(seq) {
  const map = { A: "T", T: "A", C: "G", G: "C" };
  return seq
    .split("")
    .reverse()
    .map((n) => map[n] || "N")
    .join("");
}

// ------------------------------------------------------------
// SEARCH EXACT MATCHES
// ------------------------------------------------------------
function findMatches(genomeSeq, reportedSeq) {
  const seq = reportedSeq.toUpperCase();
  const rev = revComp(seq);
  const len = seq.length;

  const results = [];

  // forward strand
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

  // reverse strand
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

  // ------------------------------------------------------------
  // LOAD FASTA for selected genomes
  // ------------------------------------------------------------
  async function fetchGenome(accession) {
    const url = `https://api.ncbi.nlm.nih.gov/datasets/v2alpha/genome/accession/${accession}/download?include=sequence&filename=seq.fasta`;

    try {
      const r = await fetch(url);
      const blob = await r.blob();
      const text = await blob.text();

      // parse FASTA
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

  useEffect(() => {
    async function loadGenomes() {
      if (!genomeList?.length) return;

      const store = {};

      for (const g of genomeList) {
        const acc = g.accession;
        const seq = await fetchGenome(acc);
        if (seq) store[acc] = seq;
      }

      setLoadedGenomes(store);
      console.log("Loaded genomes:", store);
    }

    loadGenomes();
  }, [genomeList]);

  // ------------------------------------------------------------
  // Step1: Parse input + auto search matches
  // ------------------------------------------------------------
  function handleParse() {
    const seqs = rawInput
      .split(/\r?\n/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0);

    setSites(seqs);

    // search automatically
    runExactMatchSearch(seqs);

    // open accordion 2 automatically
    setAccordionOpen({
      step1: true, // or false if you want collapse
      step2: true,
      step3: false,
      step4: false,
    });
  }

  // ------------------------------------------------------------
  // Step 2: Find matches
  // ------------------------------------------------------------
  function runExactMatchSearch(seqs) {
    if (!Object.keys(loadedGenomes).length) {
      console.log("No genomes loaded yet");
      return;
    }

    const allMatches = [];

    for (const seq of seqs) {
      for (const [acc, genomeSeq] of Object.entries(loadedGenomes)) {
        const hits = findMatches(genomeSeq, seq);

        hits.forEach((hit) => {
          allMatches.push({
            accession: acc,
            ...hit,
          });
        });
      }
    }

    setMatches(allMatches);
  }

  // ------------------------------------------------------------
  // UI HELPERS
  // ------------------------------------------------------------
  function toggleAccordion(step) {
    setAccordionOpen((prev) => ({
      ...prev,
      [step]: !prev[step],
    }));
  }

  // ------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------
  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold">Step 4 – Reported sites</h2>

      {/* ---------------------------------------------------------
          ACCORDION 1
      ---------------------------------------------------------- */}
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

            {/* SITES INPUT */}
            <div>
              <label className="block font-medium mb-1">Sites</label>
              <textarea
                className="form-control w-full h-40"
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
                placeholder="AAGATTACATT\nAAGATAACATT"
              />
            </div>

            <button className="btn" onClick={handleParse}>
              Save
            </button>
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------
          ACCORDION 2
      ---------------------------------------------------------- */}
      <div className="bg-surface border border-border rounded p-4">
        <button
          className="flex justify-between w-full text-lg font-semibold mb-3"
          onClick={() => toggleAccordion("step2")}
        >
          <span>2. Exact site matches</span>
          <span>{accordionOpen.step2 ? "▲" : "▼"}</span>
        </button>

        {accordionOpen.step2 && (
          <div className="space-y-2 text-sm">
            {matches.length === 0 && (
              <p className="text-muted">No matches found.</p>
            )}

            {matches.map((m, i) => (
              <div
                key={i}
                className="p-2 border border-border rounded bg-muted"
              >
                <p className="font-medium">{m.reportedSeq}</p>
                <p>
                  {m.accession}: [{m.start} – {m.end}] ({m.strand})
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------
          ACCORDION 3 (PLACEHOLDER)
      ---------------------------------------------------------- */}
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

      {/* ---------------------------------------------------------
          ACCORDION 4 (PLACEHOLDER)
      ---------------------------------------------------------- */}
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

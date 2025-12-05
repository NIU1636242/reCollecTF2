import React, { useState, useEffect } from "react";
import { useCuration } from "../../context/CurationContext";
import { parseGenbank } from "genbank-parser";

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
// FIND CLOSEST GENE (±150bp)
// ------------------------------------------------------------
function nearestGene(genes, start, end) {
  if (!genes?.length) return null;

  const center = (start + end) / 2;
  let best = null;
  let bestDist = Infinity;

  for (const g of genes) {
    const gc = (g.start + g.end) / 2;
    const dist = Math.abs(gc - center);
    if (dist < bestDist) {
      best = g;
      bestDist = dist;
    }
  }

  if (bestDist > 150) return null;
  return best;
}

// ------------------------------------------------------------
// EXACT MATCH SEARCH (ONE GENOME)
// ------------------------------------------------------------
function findMatches(genomeSeq, genes, reportedSeq, accession) {
  const seq = reportedSeq.toUpperCase();
  const rev = revComp(seq);
  const len = seq.length;

  const results = [];

  // forward strand
  let i = genomeSeq.indexOf(seq);
  while (i !== -1) {
    const g = nearestGene(genes, i, i + len - 1);

    results.push({
      accession,
      seq,
      reportedSeq,
      start: i,
      end: i + len - 1,
      strand: "+",
      locus: g?.locus,
      gene: g?.gene,
      product: g?.product
    });

    i = genomeSeq.indexOf(seq, i + 1);
  }

  // reverse strand
  let j = genomeSeq.indexOf(rev);
  while (j !== -1) {
    const g = nearestGene(genes, j, j + len - 1);

    results.push({
      accession,
      seq: rev,
      reportedSeq,
      start: j,
      end: j + len - 1,
      strand: "-",
      locus: g?.locus,
      gene: g?.gene,
      product: g?.product
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

  const [loadedGenomes, setLoadedGenomes] = useState({}); // { acc: {seq, genes} }

  // ------------------------------------------------------------
  // LOAD GENBANK for selected genomes
  // ------------------------------------------------------------
  async function fetchGenomeGenbank(accession) {
    const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?
      db=nuccore&id=${accession}&rettype=gb&retmode=text`;

    try {
      const text = await fetch(url).then((r) => r.text());
      const gb = parseGenbank(text);

      const seq = gb.sequence.toUpperCase();

      // extract gene features
      const genes = gb.features
        .filter((f) => f.type === "gene" && f.location)
        .map((f) => ({
          start: f.location[0],
          end: f.location[1],
          strand: f.strand,
          locus: f.qualifiers?.locus_tag || "",
          gene: f.qualifiers?.gene || "",
          product: f.qualifiers?.product || "",
        }));

      return { seq, genes };
    } catch (err) {
      console.error("Error fetching genome", accession, err);
      return null;
    }
  }

  useEffect(() => {
    async function load() {
      if (!genomeList?.length) return;

      const store = {};

      for (const g of genomeList) {
        const acc = g.accession;
        const data = await fetchGenomeGenbank(acc);
        if (data) store[acc] = data;
      }

      setLoadedGenomes(store);
      console.log("Loaded genomes:", store);
    }

    load();
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

    runExactMatchSearch(seqs);

    // open accordion 2 automatically
    setAccordionOpen({
      step1: true,
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

    const all = [];

    for (const seq of seqs) {
      for (const [acc, data] of Object.entries(loadedGenomes)) {
        const hits = findMatches(data.seq, data.genes, seq, acc);
        all.push(...hits);
      }
    }

    setMatches(all);
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
  // UI
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
                placeholder="AAGATTACATT ..."
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
      --------------------------------------------------------- */}
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
                <div className="font-mono text-accent">
                  {m.reportedSeq}
                </div>

                <div>
                  {m.accession}: [{m.start} – {m.end}] ({m.strand})
                </div>

                {m.locus && (
                  <div className="mt-1">
                    <strong>{m.locus}</strong> | {m.gene} | {m.product}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------
          ACCORDION 3 placeholder
      --------------------------------------------------------- */}
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
          ACCORDION 4 placeholder
      --------------------------------------------------------- */}
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

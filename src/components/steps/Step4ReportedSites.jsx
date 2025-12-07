import React, { useState, useEffect } from "react";
import { useCuration } from "../../context/CurationContext";
import parseGenbank from "genbank-parser";

// ============================================================
// REVERSE COMPLEMENT
// ============================================================
function revComp(seq) {
  const map = { A: "T", T: "A", C: "G", G: "C" };
  return seq
    .split("")
    .reverse()
    .map((n) => map[n] || "N")
    .join("");
}

// ============================================================
// FETCH GENBANK + PARSE
// ============================================================
async function fetchGenbank(accession) {
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=${accession}&rettype=gb&retmode=text`;

  try {
    const r = await fetch(url);
    const text = await r.text();

    const gb = parseGenbank(text);

    const seq = gb.sequence?.toUpperCase() || "";

    const genes = [];

    for (const f of gb.features || []) {
      if (!["gene", "CDS"].includes(f.type)) continue;
      if (!f.location) continue;

      const start = Number(f.location?.start);
      const end = Number(f.location?.end);
      const strand = f.location?.strand === "-" ? -1 : 1;

      let locus_tag = null;
      let gene = null;
      let product = null;

      for (const q of f.qualifiers || []) {
        if (q.key === "locus_tag") locus_tag = q.value;
        if (q.key === "gene") gene = q.value;
        if (q.key === "product") product = q.value;
      }

      genes.push({ start, end, strand, locus_tag, gene, product });
    }

    return { seq, genes };
  } catch (err) {
    console.error("Error fetching GenBank", accession, err);
    return null;
  }
}

// ============================================================
// EXACT MATCHES
// ============================================================
function findMatches(genomeSeq, reportedSeq) {
  const seq = reportedSeq.toUpperCase();
  const rev = revComp(seq);
  const len = seq.length;

  const results = [];

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

// ============================================================
// NEARBY GENES (±150bp)
// ============================================================
function nearbyGenes(genes, match, dist = 150) {
  return genes.filter((g) => {
    return (
      Math.abs(g.start - match.start) <= dist ||
      Math.abs(g.end - match.end) <= dist
    );
  });
}

// ============================================================
// COMPONENT
// ============================================================
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
  const [results, setResults] = useState([]);

  const [loadedGenomes, setLoadedGenomes] = useState({});

  // ============================================================
  // LOAD GENOMES
  // ============================================================
  useEffect(() => {
    async function load() {
      if (!genomeList?.length) return;

      const data = {};

      for (const g of genomeList) {
        const acc = g.accession;
        const gb = await fetchGenbank(acc);
        if (gb) {
          data[acc] = gb;
        }
      }

      setLoadedGenomes(data);

      console.log("Loaded genomes:", data);
    }

    load();
  }, [genomeList]);

  // ============================================================
  // PARSE + SEARCH
  // ============================================================
  function handleParse() {
    const seqs = rawInput
      .split(/\r?\n/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0);

    setSites(seqs);

    runSearch(seqs);

    setAccordionOpen({
      step1: true,
      step2: true,
      step3: false,
      step4: false,
    });
  }

  // ============================================================
  // RUN SEARCH
  // ============================================================
  function runSearch(seqs) {
    if (!Object.keys(loadedGenomes).length) return;

    const all = [];

    for (const seq of seqs) {
      for (const [acc, obj] of Object.entries(loadedGenomes)) {
        const hits = findMatches(obj.seq, seq);

        hits.forEach((hit) => {
          all.push({
            accession: acc,
            ...hit,
            nearby: nearbyGenes(obj.genes, hit),
          });
        });
      }
    }

    setResults(all);
  }

  // ============================================================
  // UI
  // ============================================================
  function toggleAccordion(step) {
    setAccordionOpen((p) => ({ ...p, [step]: !p[step] }));
  }

  // ============================================================
  // RENDER
  // ============================================================
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
          <div className="space-y-4 text-sm">
            {results.length === 0 && (
              <p className="text-muted">No matches found.</p>
            )}

            {results.map((m, i) => (
              <div
                key={i}
                className="p-3 border border-border rounded bg-muted"
              >
                <p className="font-medium">{m.reportedSeq}</p>
                <p>
                  {m.accession}: [{m.start} – {m.end}] ({m.strand})
                </p>

                {m.nearby?.length > 0 && (
                  <table className="text-sm mt-2 w-full">
                    <thead>
                      <tr className="text-left border-b border-border">
                        <th className="pr-2">locus</th>
                        <th className="pr-2">gene</th>
                        <th>function</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.nearby.map((g, ix) => (
                        <tr key={ix} className="border-b border-border/30">
                          <td>{g.locus_tag || "-"}</td>
                          <td>{g.gene || "-"}</td>
                          <td>{g.product || "-"}</td>
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

      {/* ---------------------------------------------------------
          ACCORDION 3 (placeholder)
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
          ACCORDION 4 (placeholder)
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

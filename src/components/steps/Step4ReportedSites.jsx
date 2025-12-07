import React, { useState, useEffect } from "react";
import parseGenbank from "genbank-parser";
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
// EXTRACT SEQUENCE FROM GENBANK (ORIGIN)
// ------------------------------------------------------------
function extractSequence(text) {
  const m = text.match(/ORIGIN([\s\S]*?)\/\//i);
  if (!m) return "";

  return m[1]
    .replace(/[0-9\s\/]/g, "")
    .toUpperCase();
}

// ------------------------------------------------------------
// FETCH GENBANK & PARSE FEATURES + SEQUENCE
// ------------------------------------------------------------
async function fetchGenome(acc) {
  const url =
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nucleotide&id=${acc}&rettype=gb&retmode=text`;

  try {
    const r = await fetch(url);
    const text = await r.text();

    if (!text) throw new Error("Empty text");

    // parse features
    const parsed = parseGenbank(text);

    const record = parsed[0];
    if (!record) throw new Error("No record parsed");

    // extract sequence
    const seq = extractSequence(text);

    // extract genes
    const genes = record.features
      .filter((f) => f.type === "gene")
      .map((f) => ({
        start: f.start ?? 0,
        end: f.end ?? 0,
        strand: f.strand ?? 1,
        locus_tag: f.notes?.locus_tag?.[0] ?? "",
        name: f.notes?.gene?.[0] ?? "",
        function: f.notes?.product?.[0] ?? "",
      }));

    return { seq, genes };

  } catch (err) {
    console.error(`Error fetching genome ${acc}`, err);
    return null;
  }
}

// ------------------------------------------------------------
// FIND EXACT MATCHES + NEARBY GENES
// ------------------------------------------------------------
function findMatches(genome, reportedSeq) {
  const genomeSeq = genome.seq.toUpperCase();
  const seq = reportedSeq.toUpperCase();
  const rev = revComp(seq);
  const len = seq.length;

  const results = [];

  // forward strand
  let i = genomeSeq.indexOf(seq);
  while (i !== -1) {
    results.push({
      genome,
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
      genome,
      seq: rev,
      reportedSeq,
      start: j,
      end: j + len - 1,
      strand: "-",
    });
    j = genomeSeq.indexOf(rev, j + 1);
  }

  // annotate genes around site
  results.forEach((m) => {
    m.nearbyGenes = genome.genes.filter(
      (g) => !(g.end < m.start || g.start > m.end)
    );
  });

  return results;
}

export default function Step4ReportedSites() {
  const { genomeList } = useCuration();

  const [accordionOpen, setAccordionOpen] = useState({
    step1: true,
    step2: false,
  });

  const [siteType, setSiteType] = useState("motif");
  const [rawInput, setRawInput] = useState("");
  const [sites, setSites] = useState([]);
  const [genomes, setGenomes] = useState({});
  const [matches, setMatches] = useState([]);

  // ------------------------------------------------------------
  // LOAD GENOMES ONCE
  // ------------------------------------------------------------
  useEffect(() => {
    async function loadGenomes() {
      if (!genomeList?.length) return;

      const result = {};
      for (const g of genomeList) {
        const acc = g.accession;
        const data = await fetchGenome(acc);
        if (data) result[acc] = data;
      }

      setGenomes(result);
      console.log("Loaded genomes:", result);
    }

    loadGenomes();
  }, [genomeList]);

  // ------------------------------------------------------------
  // ON SAVE
  // ------------------------------------------------------------
  function handleSave() {
    const seqs = rawInput
      .split(/\r?\n/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0);

    setSites(seqs);

    runSearch(seqs);

    setAccordionOpen({
      step1: true,
      step2: true,
    });
  }

  // ------------------------------------------------------------
  // RUN MATCHES
  // ------------------------------------------------------------
  function runSearch(seqs) {
    if (!Object.keys(genomes).length) {
      console.log("No genomes loaded");
      return;
    }

    const all = [];

    for (const seq of seqs) {
      for (const acc of Object.keys(genomes)) {
        const genome = genomes[acc];

        if (!genome.seq) continue;

        const hits = findMatches(genome, seq);

        hits.forEach((h) => {
          all.push({
            ...h,
            accession: acc,
          });
        });
      }
    }

    setMatches(all);
  }

  // ------------------------------------------------------------
  // UI TOGGLE
  // ------------------------------------------------------------
  function toggleAccordion(step) {
    setAccordionOpen((p) => ({
      ...p,
      [step]: !p[step],
    }));
  }

  // ------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------
  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold">Step 4 – Reported sites</h2>

      {/** -------------------------------------------------------
       *  ACCORDION 1
       -------------------------------------------------------- */}
      <div className="bg-surface border border-border rounded p-4">
        <button
          className="flex justify-between w-full text-lg font-semibold mb-3"
          onClick={() => toggleAccordion("step1")}
        >
          <span>1. Enter reported sites</span>
          <span>{accordionOpen.step1 ? "▲" : "▼"}</span>
        </button>

        {accordionOpen.step1 && (
          <div className="space-y-4 text-sm">

            {/** SITE TYPE */}
            <div>
              <label className="block font-medium mb-1">Site type</label>

              <div className="space-y-1">
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

            {/** TEXTAREA */}
            <div>
              <label className="block font-medium mb-1">Sites</label>
              <textarea
                className="form-control w-full h-40"
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
                placeholder="AAGATTACATT\nAAGATAACATT"
              />
            </div>

            <button className="btn" onClick={handleSave}>
              Save
            </button>
          </div>
        )}
      </div>

      {/** -------------------------------------------------------
       *  ACCORDION 2
       -------------------------------------------------------- */}
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
            {matches.length === 0 && (
              <p className="text-muted">No matches found.</p>
            )}

            {matches.map((m, i) => (
              <div key={i} className="p-2 border border-border rounded bg-muted">
                <p className="font-medium">{m.reportedSeq}</p>
                <p>
                  {m.accession}: [{m.start} – {m.end}] ({m.strand})
                </p>

                {m.nearbyGenes?.length > 0 && (
                  <table className="text-xs mt-2 w-full">
                    <thead>
                      <tr>
                        <th>locus tag</th>
                        <th>gene name</th>
                        <th>function</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.nearbyGenes.map((g, j) => (
                        <tr key={j}>
                          <td>{g.locus_tag}</td>
                          <td>{g.name}</td>
                          <td>{g.function}</td>
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
    </div>
  );
}

import React, { useState, useEffect } from "react";
import { useCuration } from "../../context/CurationContext";
import genbankParser from "genbank-parser";

// ============================================================
// Reverse complement
// ============================================================
function revComp(seq) {
  const map = { A: "T", T: "A", C: "G", G: "C" };
  return seq
    .toUpperCase()
    .split("")
    .reverse()
    .map((n) => map[n] || "N")
    .join("");
}

// ============================================================
// Exact matches (+/- strand)
// ============================================================
function findExactMatches(genomeSeq, reportedSeq) {
  const seq = reportedSeq.toUpperCase();
  const rev = revComp(seq);
  const len = seq.length;

  const matches = [];

  // Forward
  let i = genomeSeq.indexOf(seq);
  while (i !== -1) {
    matches.push({
      siteSeq: seq,
      genomeSeq: seq,
      start: i,
      end: i + len - 1,
      strand: "+",
    });
    i = genomeSeq.indexOf(seq, i + 1);
  }

  // Reverse
  let j = genomeSeq.indexOf(rev);
  while (j !== -1) {
    matches.push({
      siteSeq: seq,
      genomeSeq: rev,
      start: j,
      end: j + len - 1,
      strand: "-",
    });
    j = genomeSeq.indexOf(rev, j + 1);
  }

  return matches;
}

// ============================================================
// Count mismatches
// ============================================================
function mismatches(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

// ============================================================
// Build bars for alignment
// ============================================================
function buildBars(a, b) {
  return a
    .split("")
    .map((c, i) => (c === b[i] ? "|" : " "))
    .join("");
}

// ============================================================
// Search with up to N mismatches
// ============================================================
function findFuzzyMatches(genome, reported, max = 2) {
  const res = [];
  const rc = revComp(reported);
  const len = reported.length;

  for (let i = 0; i <= genome.length - len; i++) {
    const sub = genome.slice(i, i + len);

    // forward
    const mm1 = mismatches(sub, reported);
    if (mm1 > 0 && mm1 <= max) {
      res.push({
        siteSeq: reported,
        genomeSeq: sub,
        bars: buildBars(reported, sub),
        start: i,
        end: i + len - 1,
        strand: "+",
      });
    }

    // reverse
    const mm2 = mismatches(sub, rc);
    if (mm2 > 0 && mm2 <= max) {
      res.push({
        siteSeq: rc,
        genomeSeq: sub,
        bars: buildBars(rc, sub),
        start: i,
        end: i + len - 1,
        strand: "-",
      });
    }
  }

  return res;
}

// ============================================================
// Gene annotation helper
// ============================================================
function findNearbyGenes(genes, site) {
  if (!genes || genes.length === 0) return [];

  function dist(g) {
    return Math.max(g.start, site.start) - Math.min(g.end, site.end);
  }

  const withDist = genes.map((g) => ({
    ...g,
    _dist: dist(g),
  }));

  const min = Math.min(...withDist.map((g) => g._dist));

  return withDist.filter((g) => g._dist === min);
}

// ============================================================
// Alignment component (used only for mismatches)
// ============================================================
function Alignment({ reported, bars, genome, start, end, strand, acc }) {
  return (
    <p className="font-mono text-xs leading-4 whitespace-pre">
      {reported}
      {"\n"}
      {bars}
      {"\n"}
      {genome} {strand}[{start + 1}, {end + 1}] {acc}
    </p>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================
export default function Step4ReportedSites() {
  const { genomeList } = useCuration();

  const [accordionOpen, setAccordionOpen] = useState({
    step1: true,
    step2: true,
    step3: false,
    step4: false,
  });

  const [rawInput, setRawInput] = useState("");
  const [sites, setSites] = useState([]);

  const [loadedGenomes, setLoadedGenomes] = useState({});
  const [matches, setMatches] = useState([]);
  const [selectedMatch, setSelectedMatch] = useState({});
  const [fuzzyMatches, setFuzzyMatches] = useState({});

  const [loadingGenomes, setLoadingGenomes] = useState(false);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const PROXY = "https://corsproxy.io/?";
  const ENTREZ_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

  // ============================================================
  // FETCH GENOMES AND FEATURES (igual que tu versión)
  // ============================================================

  useEffect(() => {
    async function loadGenomes() {
      if (!genomeList || genomeList.length === 0) return;

      setLoadingGenomes(true);
      const store = {};

      for (const g of genomeList) {
        const acc = g.accession;
        if (!acc) continue;

        try {
          const fastaURL = `${ENTREZ_BASE}/efetch.fcgi?db=nuccore&id=${acc}&rettype=fasta&retmode=text`;
          const fastaRes = await fetch(PROXY + encodeURIComponent(fastaURL));
          const fastaTxt = await fastaRes.text();

          const seq = fastaTxt
            .split("\n")
            .filter((l) => !l.startsWith(">"))
            .join("")
            .toUpperCase();

          store[acc] = {
            sequence: seq,
            genes: g.genes || [],
          };
        } catch (err) {
          console.error(err);
        }
      }

      setLoadedGenomes(store);
      setLoadingGenomes(false);
    }

    loadGenomes();
  }, [genomeList]);

  // ============================================================
  // STEP 1: parse sites and search exact matches
  // ============================================================

  function handleParseAndSearch() {
    setErrorMsg("");

    const seqs = rawInput
      .split(/\r?\n/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    if (seqs.length === 0) {
      setErrorMsg("Enter at least one sequence.");
      return;
    }

    if (!Object.keys(loadedGenomes).length) {
      setErrorMsg("Genomes not loaded yet.");
      return;
    }

    setSites(seqs);

    setLoadingMatches(true);

    const all = [];

    seqs.forEach((site) => {
      for (const [acc, data] of Object.entries(loadedGenomes)) {
        const hits = findExactMatches(data.sequence, site);

        hits.forEach((h) => {
          const nearby = findNearbyGenes(data.genes, h);
          all.push({
            ...h,
            siteSeq: site,
            genomeAcc: acc,
            nearbyGenes: nearby,
          });
        });
      }
    });

    setMatches(all);

    const initial = {};
    seqs.forEach((s) => (initial[s] = "none"));
    setSelectedMatch(initial);

    setLoadingMatches(false);

    setAccordionOpen((s) => ({ ...s, step2: true }));
  }

  // ============================================================
  // SEARCH MISMATCHES WHEN USER SELECTS "NONE"
  // ============================================================

  function computeFuzzy(siteSeq) {
    if (!Object.keys(loadedGenomes).length) return;

    const res = [];

    for (const [acc, data] of Object.entries(loadedGenomes)) {
      const fuzzy = findFuzzyMatches(data.sequence, siteSeq, 2);

      fuzzy.forEach((f) => {
        const nearby = findNearbyGenes(data.genes, f);
        res.push({
          ...f,
          genomeAcc: acc,
          nearbyGenes: nearby,
        });
      });
    }

    setFuzzyMatches((p) => ({
      ...p,
      [siteSeq]: res,
    }));

    setAccordionOpen((p) => ({ ...p, step3: true }));
  }

  // ============================================================
  // UI helpers
  // ============================================================

  function toggleAccordion(step) {
    setAccordionOpen((prev) => ({
      ...prev,
      [step]: !prev[step],
    }));
  }

  function AlignmentBlock({ m }) {
    return (
      <Alignment
        reported={m.siteSeq}
        bars={m.bars}
        genome={m.genomeSeq}
        strand={m.strand}
        start={m.start}
        end={m.end}
        acc={m.genomeAcc}
      />
    );
  }

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold">Step 4 – Reported sites</h2>

      {errorMsg && <p className="text-sm text-red-400">{errorMsg}</p>}

      {/* ============================================================
          1. ENTER SITES  (SIN CAMBIOS)
      ============================================================ */}
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

            <textarea
              className="form-control w-full h-40"
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              placeholder={"AAGATTACAT\nAAGATAACATT"}
            />

            <button
              className="btn"
              onClick={handleParseAndSearch}
              disabled={loadingGenomes}
            >
              {loadingGenomes ? "Loading genomes..." : "Save"}
            </button>
          </div>
        )}
      </div>


      {/* ============================================================
          2. EXACT MATCHES
      ============================================================ */}
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

            {matches.length === 0 && <p>No matches found.</p>}

            {sites.map((site) => {
              const siteHits = matches.filter((m) => m.siteSeq === site);
              const selected = selectedMatch[site];

              return (
                <div
                  key={site}
                  className="border border-border rounded bg-muted p-3 space-y-2"
                >
                  <h4 className="font-semibold text-accent">{site}</h4>

                  {/* Show each exact match */}
                  {siteHits.map((m, i) => (
                    <label
                      key={`${site}-${i}`}
                      className="flex items-start gap-2 cursor-pointer"
                    >
                      <input
                        type="radio"
                        name={`match-${site}`}
                        checked={selected === i}
                        onChange={() =>
                          setSelectedMatch((p) => ({ ...p, [site]: i }))
                        }
                      />

                      <div className="mt-0.5 flex-1 space-y-1 text-xs font-mono leading-4">
                        {m.siteSeq} {m.strand}[{m.start + 1},{m.end + 1}] {m.genomeAcc}

                        {m.nearbyGenes.length > 0 && (
                          <table className="text-xs w-full border-collapse mt-2">
                            <thead>
                              <tr className="border-b border-border">
                                <th className="text-left pr-4">locus tag</th>
                                <th className="text-left pr-4">gene name</th>
                                <th className="text-left">function</th>
                              </tr>
                            </thead>
                            <tbody>
                              {m.nearbyGenes.map((g, gi) => (
                                <tr key={gi}>
                                  <td className="pr-4">{g.locus_tag}</td>
                                  <td className="pr-4">{g.gene}</td>
                                  <td>{g.product}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </label>
                  ))}

                  {/* No match option */}
                  <label className="flex items-center gap-2 mt-2 cursor-pointer text-xs">
                    <input
                      type="radio"
                      name={`match-${site}`}
                      checked={selected === "none"}
                      onChange={() => {
                        setSelectedMatch((p) => ({ ...p, [site]: "none" }));
                        computeFuzzy(site);
                      }}
                    />
                    <span>No valid match.</span>
                  </label>
                </div>
              );
            })}
          </div>
        )}
      </div>


      {/* ============================================================
          3. FUZZY MATCHES (MISMATCHES)
      ============================================================ */}
      <div className="bg-surface border border-border rounded p-4">
        <button
          className="flex justify-between w-full text-lg font-semibold mb-3"
          onClick={() => toggleAccordion("step3")}
        >
          <span>3. Inexact matches (mismatches)</span>
          <span>{accordionOpen.step3 ? "▲" : "▼"}</span>
        </button>

        {accordionOpen.step3 && (
          <div className="space-y-4 text-sm">
            {sites.map((site) => {
              const fz = fuzzyMatches[site] || [];
              const selected = selectedMatch[site];

              if (selected !== "none") return null;

              return (
                <div
                  key={site}
                  className="border border-border rounded bg-muted p-3 space-y-2"
                >
                  <h4 className="font-semibold text-accent">{site}</h4>

                  {fz.length === 0 && (
                    <p className="text-xs">No mismatches found</p>
                  )}

                  {fz.map((m, i) => (
                    <div key={i} className="space-y-2">

                      <AlignmentBlock m={m} />

                      {m.nearbyGenes.length > 0 && (
                        <table className="text-xs w-full border-collapse">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="text-left pr-4">locus tag</th>
                              <th className="text-left pr-4">gene name</th>
                              <th className="text-left">function</th>
                            </tr>
                          </thead>
                          <tbody>
                            {m.nearbyGenes.map((g, gi) => (
                              <tr key={gi}>
                                <td className="pr-4">{g.locus_tag}</td>
                                <td className="pr-4">{g.gene}</td>
                                <td>{g.product}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>


      {/* ============================================================
          4. PLACEHOLDER
      ============================================================ */}
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

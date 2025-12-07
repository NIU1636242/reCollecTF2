import React, { useState, useEffect } from "react";
import { useCuration } from "../../context/CurationContext";


// -----------------------------------------------------
// Helpers
// -----------------------------------------------------

function revComp(seq) {
  const map = { A: "T", T: "A", C: "G", G: "C" };
  return seq
    .toUpperCase()
    .split("")
    .reverse()
    .map((n) => map[n] || "N")
    .join("");
}

function mismatches(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

function buildBars(a, b) {
  return a
    .split("")
    .map((c, i) => (c === b[i] ? "|" : " "))
    .join("");
}

// -----------------------------------------------------
// NORMALIZAR GENES A FORMATO ESTÁNDAR
// -----------------------------------------------------

function normalizeGene(g) {
  return {
    locus_tag: g.locus_tag || g.locusTag || g.tag || "",
    gene_name: g.gene || g.gene_name || g.geneName || "",
    function: g.product || g.function || g.annotation || "",
  };
}

// -----------------------------------------------------
// Encontrar genes más cercanos
// -----------------------------------------------------

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

  return withDist
    .filter((g) => g._dist === min)
    .map(normalizeGene);
}


// -----------------------------------------------------
// EXACT MATCHES
// -----------------------------------------------------

function findExactMatches(genomeSeq, reportedSeq) {
  const seq = reportedSeq.toUpperCase();
  const rev = revComp(seq);
  const len = seq.length;

  const matches = [];

  // forward
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

  // reverse
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


// -----------------------------------------------------
// FUZZY MATCHES
// -----------------------------------------------------

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



// -----------------------------------------------------
// COMPONENTE PRINCIPAL
// -----------------------------------------------------

export default function Step4ReportedSites() {
  const { genomeList } = useCuration();

  const [siteType, setSiteType] = useState("variable");
  const [rawInput, setRawInput] = useState("");

  const [sites, setSites] = useState([]);
  const [loadedGenomes, setLoadedGenomes] = useState({});
  const [matches, setMatches] = useState([]);
  const [selectedMatch, setSelectedMatch] = useState({});
  const [fuzzyMatches, setFuzzyMatches] = useState({});
  const [selectedSiteMatch, setSelectedSiteMatch] = useState({});

  const [loadingGenomes, setLoadingGenomes] = useState(false);
  const PROXY = "https://corsproxy.io/?";
  const ENTREZ_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";



  // -----------------------------------------------------
  // Cargar genomas
  // -----------------------------------------------------

  useEffect(() => {
    async function loadGenomes() {
      setLoadingGenomes(true);

      const store = {};

      for (const g of genomeList) {
        try {
          const fastaURL = `${ENTREZ_BASE}/efetch.fcgi?db=nuccore&id=${g.accession}&rettype=fasta&retmode=text`;
          const res = await fetch(PROXY + encodeURIComponent(fastaURL));
          const txt = await res.text();

          const seq = txt
            .split("\n")
            .filter((l) => !l.startsWith(">"))
            .join("")
            .toUpperCase();

          store[g.accession] = {
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

    if (genomeList?.length) loadGenomes();
  }, [genomeList]);



  // -----------------------------------------------------
  // Procesar secuencias
  // -----------------------------------------------------

  function handleSaveSites() {
    const seqs = rawInput
      .split(/\r?\n/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    setSites(seqs);

    const all = [];

    seqs.forEach((site) => {
      for (const [acc, data] of Object.entries(loadedGenomes)) {
        const hits = findExactMatches(data.sequence, site);

        hits.forEach((h) => {
          const nearby = findNearbyGenes(data.genes, h);
          all.push({
            ...h,
            genomeAcc: acc,
            nearbyGenes: nearby,
          });
        });
      }
    });

    setMatches(all);

    const init = {};
    seqs.forEach((s) => (init[s] = "none"));
    setSelectedMatch(init);
  }



  // -----------------------------------------------------
  // Buscar mismatches
  // -----------------------------------------------------

  function computeFuzzy(site) {
    const res = [];

    for (const [acc, data] of Object.entries(loadedGenomes)) {
      const fz = findFuzzyMatches(data.sequence, site, 2);

      fz.forEach((m) => {
        const nearby = findNearbyGenes(data.genes, m);

        res.push({
          ...m,
          genomeAcc: acc,
          nearbyGenes: nearby,
        });
      });
    }

    setFuzzyMatches((p) => ({
      ...p,
      [site]: res,
    }));
  }



  // -----------------------------------------------------
  // RENDER
  // -----------------------------------------------------

  return (
    <div className="space-y-8">

      {/* ------------------------------------------- */}
      {/* ACCORDION 1 */}
      {/* ------------------------------------------- */}

      <div className="bg-surface border border-border rounded p-4 space-y-4">

        <h3 className="text-lg font-semibold">1. Reported sites</h3>

        {/* site type */}
        <div className="space-y-2 text-sm">

          <p className="font-medium text-sm">Site type</p>

          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={siteType === "motif"}
              onChange={() => setSiteType("motif")}
            />
            <span>motif-associated (new motif)</span>
          </label>

          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={siteType === "variable"}
              onChange={() => setSiteType("variable")}
            />
            <span>variable motif associated</span>
          </label>

          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={siteType === "nonmotif"}
              onChange={() => setSiteType("nonmotif")}
            />
            <span>non-motif associated</span>
          </label>

        </div>

        {/* textarea */}
        <textarea
          className="form-control w-full h-40 text-sm"
          value={rawInput}
          onChange={(e) => setRawInput(e.target.value)}
        />

        <button className="btn" onClick={handleSaveSites}>
          {loadingGenomes ? "Loading genomes..." : "Save"}
        </button>

      </div>





      {/* ------------------------------------------- */}
      {/* ACCORDION 2 EXAC
      T MATCHES */}
      {/* ------------------------------------------- */}

      <div className="bg-surface border border-border rounded p-4 space-y-4">

        <h3 className="text-lg font-semibold">2. Exact site matches</h3>

        {sites.map((site) => {
          const siteHits = matches.filter((m) => m.siteSeq === site);
          const selected = selectedMatch[site];

          return (
            <div
              key={site}
              className="border border-border rounded p-3 space-y-2"
            >

              <h4 className="font-semibold text-accent">{site}</h4>

              {siteHits.map((m, i) => (
                <label
                  key={i}
                  className="flex items-start gap-2 cursor-pointer"
                >
                  <input
                    type="radio"
                    name={`match-${site}`}
                    checked={selected === i}
                    onChange={() => {
                      setSelectedMatch((p) => ({ ...p, [site]: i }));
                      setSelectedSiteMatch((p) => ({
                        ...p,
                        [site]: { type: "exact", data: m }
                      }));
                    }}
                  />

                  <div className="font-mono text-xs flex-1 leading-4">
                    {m.siteSeq} {m.strand}[{m.start + 1},{m.end + 1}] {m.genomeAcc}

                    {m.nearbyGenes?.length > 0 && (
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
                              <td className="pr-4">{g.gene_name}</td>
                              <td>{g.function}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </label>
              ))}

              {/* no match */}
              <label className="flex items-center gap-2 text-xs cursor-pointer mt-2">
                <input
                  type="radio"
                  name={`match-${site}`}
                  checked={selected === "none"}
                  onChange={() => {
                    setSelectedMatch((p) => ({ ...p, [site]: "none" }));
                    setSelectedSiteMatch((p) => ({
                      ...p,
                      [site]: { type: "none" }
                    }));
                    computeFuzzy(site);
                  }}
                />
                <span>No valid match.</span>
              </label>
            </div>
          );
        })}
      </div>






      {/* ------------------------------------------- */}
      {/* ACCORDION 3 – FUZZY MATCHES */}
      {/* ------------------------------------------- */}

      <div className="bg-surface border border-border rounded p-4 space-y-4">

        <h3 className="text-lg font-semibold">3. Inexact matches (mismatches)</h3>

        {sites.map((site) => {
          const fz = fuzzyMatches[site] || [];
          const selected = selectedMatch[site];

          if (selected !== "none") return null;

          return (
            <div
              key={site}
              className="border border-border rounded p-3 space-y-2"
            >
              <h4 className="font-semibold text-accent">{site}</h4>

              {fz.map((m, i) => (
                <label
                  key={i}
                  className="flex items-start gap-2 cursor-pointer"
                >
                  <input
                    type="radio"
                    name={`fuzzy-${site}`}
                    checked={selectedMatch[site] === `fuzzy-${i}`}
                    onChange={() => {
                      setSelectedMatch((p) => ({
                        ...p,
                        [site]: `fuzzy-${i}`
                      }));

                      setSelectedSiteMatch((p) => ({
                        ...p,
                        [site]: { type: "fuzzy", data: m }
                      }));
                    }}
                  />

                  <div className="font-mono text-xs flex-1 leading-4 whitespace-pre">
                    {m.siteSeq}
                    {"\n"}
                    {m.bars}
                    {"\n"}
                    {m.genomeSeq} {m.strand}[{m.start + 1},{m.end + 1}] {m.genomeAcc}

                    {m.nearbyGenes?.length > 0 && (
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
                              <td className="pr-4">{g.gene_name}</td>
                              <td>{g.function}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </label>
              ))}
            </div>
          );
        })}
      </div>




      {/* ------------------------------------------- */}
      {/* ACCORDION 4 – FINAL SUMMARY */}
      {/* ------------------------------------------- */}

      <div className="bg-surface border border-border rounded p-4 space-y-4">

        <h3 className="text-lg font-semibold">4. Site annotation</h3>

        {sites.map((site) => {
          const sel = selectedSiteMatch[site];

          if (!sel || sel.type === "none") {
            return (
              <p key={site} className="font-mono text-xs">{site}</p>
            );
          }

          if (sel.type === "exact") {
            const m = sel.data;
            return (
              <div key={site} className="space-y-2 font-mono text-xs leading-4">
                {m.siteSeq} {m.strand}[{m.start+1},{m.end+1}] {m.genomeAcc}

                {m.nearbyGenes?.length > 0 && (
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
                          <td className="pr-4">{g.gene_name}</td>
                          <td>{g.function}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          }

          if (sel.type === "fuzzy") {
            const m = sel.data;
            return (
              <div key={site} className="space-y-2 font-mono text-xs leading-4 whitespace-pre">
                {m.siteSeq}
                {"\n"}
                {m.bars}
                {"\n"}
                {m.genomeSeq} {m.strand}[{m.start+1},{m.end+1}] {m.genomeAcc}

                {m.nearbyGenes?.length > 0 && (
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
                          <td className="pr-4">{g.gene_name}</td>
                          <td>{g.function}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}

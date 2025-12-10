import React, { useState, useEffect } from "react";
import { useCuration } from "../../context/CurationContext";

// =======================================================
// Sequence utilities
// =======================================================

function revComp(seq) {
  const map = { A: "T", T: "A", C: "G", G: "C" };
  return seq
    .split("")
    .reverse()
    .map((c) => map[c] || "N")
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

function parseGenBankGenes(gb) {
  const lines = gb.split("\n");
  const genes = [];
  let current = null;
  let insideFeature = false;

  const regionRegex = /^\s{5}(gene|CDS)\s+(complement\()?<?(\d+)>?\.\.<?(\d+)>(\))?/;

  for (let line of lines) {
    // MATCH region lines
    const region = line.match(regionRegex);
    if (region) {
      // Save previous feature
      if (current) genes.push(current);

      current = {
        start: parseInt(region[3]),
        end: parseInt(region[4]),
        gene: "",
        locus: "",
        function: "",
        product: ""
      };

      insideFeature = true;
      continue;
    }

    if (!insideFeature || !current) continue;

    // /gene="xxx"
    let m = line.match(/\/gene="([^"]+)"/);
    if (m) current.gene = m[1];

    // /locus_tag="xxx"
    m = line.match(/\/locus_tag="([^"]+)"/);
    if (m) current.locus = m[1];

    // /function="xxx"
    m = line.match(/\/function="([^"]+)"/);
    if (m) current.function = m[1];

    // /product="xxx"
    m = line.match(/\/product="([^"]+)"/);
    if (m) current.product = m[1];
  }

  // push last feature
  if (current) genes.push(current);

  return genes;
}


// =======================================================
// MAIN COMPONENT
// =======================================================

export default function Step4ReportedSites() {
  const { genomeList, techniques } = useCuration();

  // Accordion states
  const [accordion, setAccordion] = useState({
    a1: true,
    a2: true,
    a3: false,
    a4: true,
  });

  function toggleAcc(k) {
    setAccordion((p) => ({ ...p, [k]: !p[k] }));
  }

  // User input
  const [siteType, setSiteType] = useState("variable");
  const [rawSites, setRawSites] = useState("");

  // Processed sites
  const [sites, setSites] = useState([]);

  // Loaded genomes
  const [genomes, setGenomes] = useState([]);

  // Matches
  const [exactHits, setExactHits] = useState({});
  const [fuzzyHits, setFuzzyHits] = useState({});

  // User choice per site
  const [choice, setChoice] = useState({});

  // Show fuzzy accordion?
  const [showFuzzy, setShowFuzzy] = useState(false);

  // Acordeon 4 annotation data
  const [annotations, setAnnotations] = useState({});

  // Bulk apply selects (acordeón 4)
  const TF_TYPES = ["monomer", "dimer", "tetramer", "other", "not specified"];
  const TF_FUNCS = ["activator", "repressor", "dual", "not specified"];

  const [bulkTfType, setBulkTfType] = useState("monomer");
  const [bulkTfFunc, setBulkTfFunc] = useState("activator");

  // =======================================================
  // LOAD GENOMES (FASTA AND GENBANK)
  // =======================================================

  useEffect(() => {
    if (!genomeList || genomeList.length === 0) return;

    async function load() {
      const out = [];

      for (const g of genomeList) {
        try {
          // 1. FASTA
          const fastaURL = `https://corsproxy.io/?https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=${g.accession}&rettype=fasta&retmode=text`;
          const fastaRes = await fetch(fastaURL);
          const fastaText = await fastaRes.text();

          const seq = fastaText
            .replace(/>.*/g, "")
            .replace(/[^ATCGatcg]/g, "")
            .toUpperCase();

          // 2. GENBANK
          const gbURL = `https://corsproxy.io/?https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=${g.accession}&rettype=gb&retmode=text`;
          const gbRes = await fetch(gbURL);
          const gbText = await gbRes.text();

          // Parse GenBank features
          const genes = parseGenBankGenes(gbText);

          out.push({
            acc: g.accession,
            sequence: seq,
            genes
          });

        } catch (err) {
          console.error("Error loading genome:", err);
        }
      }

      setGenomes(out);

      console.log("GENOMES LOADED:", out.map(g => ({
        acc: g.acc,
        genes: g.genes.length,
        example: g.genes.slice(0, 3)
      })));
    }

    load();
  }, [genomeList]);

  // =======================================================
  // SEARCH EXACT MATCHES
  // =======================================================

  function findExact() {
    const arr = rawSites
      .split(/\r?\n/g)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    setSites(arr);

    const all = {};

    arr.forEach((site) => {
      const rc = revComp(site);
      const L = site.length;
      all[site] = [];

      genomes.forEach((g) => {
        const seq = g.sequence;

        // +
        let i = seq.indexOf(site);
        while (i !== -1) {
          all[site].push({
            type: "exact",
            site,
            match: site,
            start: i,
            end: i + L - 1,
            acc: g.acc,
            strand: "+",
          });
          i = seq.indexOf(site, i + 1);
        }

        // -
        let j = seq.indexOf(rc);
        while (j !== -1) {
          all[site].push({
            type: "exact",
            site,
            match: rc,
            start: j,
            end: j + L - 1,
            acc: g.acc,
            strand: "-",
          });
          j = seq.indexOf(rc, j + 1);
        }
      });

      if (all[site].length === 0) {
        all[site] = ["none"];
      }
    });

    setExactHits(all);

    // reset choices
    const ch = {};
    arr.forEach((s) => (ch[s] = null));
    setChoice(ch);

    // reset fuzzy
    setFuzzyHits({});
    setShowFuzzy(false);
  }

  // =======================================================
  // SEARCH FUZZY (1–2 mismatches)
  // =======================================================

  function findFuzzy(site) {
    const L = site.length;
    const rc = revComp(site);
    const found = [];

    genomes.forEach((g) => {
      const seq = g.sequence;
      for (let i = 0; i <= seq.length - L; i++) {
        const sub = seq.slice(i, i + L);

        const mmF = mismatches(sub, site);
        if (mmF > 0 && mmF <= 2) {
          found.push({
            type: "fuzzy",
            site,
            match: sub,
            bars: buildBars(site, sub),
            start: i,
            end: i + L - 1,
            acc: g.acc,
            strand: "+",
          });
        }

        const mmR = mismatches(sub, rc);
        if (mmR > 0 && mmR <= 2) {
          found.push({
            type: "fuzzy",
            site,
            match: sub,
            bars: buildBars(rc, sub),
            start: i,
            end: i + L - 1,
            acc: g.acc,
            strand: "-",
          });
        }
      }
    });

    if (found.length === 0) found.push("none");

    setFuzzyHits((p) => ({ ...p, [site]: found }));
    setShowFuzzy(true);
  }

  function findGeneForHit(acc, hitStart, hitEnd) {
    const genome = genomes.find(g => g.acc === acc);
    if (!genome || !genome.genes) return null;

    // 1. Try genes that fully contain the hit
    for (const gene of genome.genes) {
      if (gene.start <= hitStart && gene.end >= hitEnd) {
        return gene;
      }
    }

    // 2. Otherwise, return nearest gene
    let best = null;
    let bestDist = Infinity;

    for (const gene of genome.genes) {
      const dist =
        hitStart < gene.start
          ? gene.start - hitStart
          : hitStart - gene.end;

      if (dist < bestDist) {
        bestDist = dist;
        best = gene;
      }
    }

    return best;
  }

  // =======================================================
  // RENDER
  // =======================================================

  return (
    <div className="space-y-8">

      {/* =======================================================
          ACCORDION 1 — INPUT
      ======================================================= */}
      <div className="bg-surface border border-border rounded p-4">
        <button className="flex justify-between w-full font-semibold mb-3"
          onClick={() => toggleAcc("a1")}>
          <span>Reported sites</span>
          <span>{accordion.a1 ? "▲" : "▼"}</span>
        </button>

        {accordion.a1 && (
          <div className="space-y-3 text-sm">

            <div className="space-y-1">
              <label className="flex gap-2">
                <input type="radio" checked={siteType === "motif"}
                  onChange={() => setSiteType("motif")} />
                motif-associated (new motif)
              </label>

              <label className="flex gap-2">
                <input type="radio" checked={siteType === "variable"}
                  onChange={() => setSiteType("variable")} />
                variable motif associated
              </label>

              <label className="flex gap-2">
                <input type="radio" checked={siteType === "nonmotif"}
                  onChange={() => setSiteType("nonmotif")} />
                non-motif associated
              </label>
            </div>

            <textarea
              className="form-control w-full h-40 text-sm"
              value={rawSites}
              placeholder="AAGATTTCTTT"
              onChange={(e) => setRawSites(e.target.value)}
            />

            <button className="btn" onClick={findExact}>
              Save
            </button>
          </div>
        )}
      </div>

      {/* =======================================================
          ACCORDION 2 — EXACT MATCHES
      ======================================================= */}

      <div className="bg-surface border border-border rounded p-4">
        <button className="flex justify-between w-full font-semibold mb-3"
          onClick={() => toggleAcc("a2")}>
          <span>Exact site matches</span>
          <span>{accordion.a2 ? "▲" : "▼"}</span>
        </button>

        {accordion.a2 && (
          <div className="space-y-4 text-sm">
            {sites.map((site) => {
              const arr = exactHits[site] || [];

              return (
                <div key={site} className="border border-border rounded p-3 space-y-2">
                  <div className="font-semibold text-accent">{site}</div>

                  {arr.map((hit, i) =>
                    hit !== "none" ? (
                      <label key={i} className="flex gap-2 text-xs cursor-pointer">
                        <input
                          type="radio"
                          name={`ex-${site}`}
                          checked={choice[site] === `ex-${i}`}
                          onChange={() => {
                            setChoice((p) => ({ ...p, [site]: `ex-${i}` }));
                            setAccordion((p) => ({ ...p, a4: true }));
                          }}
                        />
                        <div className="font-mono">
                          {(() => {
                            const gene = findGeneForHit(hit.acc, hit.start + 1, hit.end + 1);
                            return (
                              <div className="font-mono">
                                {hit.site} {hit.strand}[{hit.start + 1},{hit.end + 1}] {hit.acc}
                                {gene && (
                                  <div className="ml-4 text-[11px] text-blue-300">
                                    locus_tag: {gene.locus || "—"} <br />
                                    gene: {gene.gene || "—"} <br />
                                    function: {gene.function || "—"}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      </label>
                    ) : null
                  )}

                  {/* no match */}
                  <label className="flex gap-2 text-xs cursor-pointer mt-2">
                    <input
                      type="radio"
                      name={`ex-${site}`}
                      checked={choice[site] === "none"}
                      onChange={() => {
                        setChoice((p) => ({ ...p, [site]: "none" }));
                        findFuzzy(site);
                        setAccordion((p) => ({ ...p, a3: true }));
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

      {/* =======================================================
          ACCORDION 3 — MISMATCHES
      ======================================================= */}

      {showFuzzy && (
        <div className="bg-surface border border-border rounded p-4">
          <button className="flex justify-between w-full font-semibold mb-3"
            onClick={() => toggleAcc("a3")}>
            <span>Inexact matches (mismatches)</span>
            <span>{accordion.a3 ? "▲" : "▼"}</span>
          </button>

          {accordion.a3 && (
            <div className="space-y-4 text-sm">
              {sites.map((site) => {
                const arr = fuzzyHits[site];
                if (!arr) return null;

                return (
                  <div key={site}
                    className="border border-border rounded p-3 space-y-2">
                    <div className="font-semibold text-accent">{site}</div>

                    {arr.map((hit, i) =>
                      hit !== "none" ? (
                        <label key={i} className="flex gap-2 text-xs cursor-pointer">
                          <input
                            type="radio"
                            name={`fz-${site}`}
                            checked={choice[site] === `fz-${i}`}
                            onChange={() => {
                              setChoice((p) => ({ ...p, [site]: `fz-${i}` }));
                              setAccordion((p) => ({ ...p, a4: true }));
                            }}
                          />
                          <div className="font-mono whitespace-pre leading-4">
                            {hit.site}
                            {"\n"}
                            {hit.bars}
                            {"\n"}
                            {(() => {
                              const gene = findGeneForHit(hit.acc, hit.start + 1, hit.end + 1);
                              return (
                                <div className="font-mono">
                                  {hit.site} {hit.strand}[{hit.start + 1},{hit.end + 1}] {hit.acc}
                                  {gene && (
                                    <div className="ml-4 text-[11px] text-blue-300">
                                      locus_tag: {gene.locus || "—"} <br />
                                      gene: {gene.gene || "—"} <br />
                                      function: {gene.function || "—"}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        </label>
                      ) : null
                    )}

                    {/* no match */}
                    <label className="flex gap-2 text-xs cursor-pointer mt-2">
                      <input
                        type="radio"
                        name={`fz-${site}`}
                        checked={choice[site] === "none-both"}
                        onChange={() => {
                          setChoice((p) => ({ ...p, [site]: "none-both" }));
                          setAccordion((p) => ({ ...p, a4: true }));
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
      )}

      {/* =======================================================
          ACCORDION 4 — SITE ANNOTATION
      ======================================================= */}

      <div className="bg-surface border border-border rounded p-4">
        <button className="flex justify-between w-full font-semibold mb-3"
          onClick={() => toggleAcc("a4")}>
          <span>Site annotation</span>
          <span>{accordion.a4 ? "▲" : "▼"}</span>
        </button>

        {accordion.a4 && (
          <div className="text-sm">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-2 py-1">Site</th>
                  <th className="text-left px-2 py-1">TF-type</th>
                  <th className="text-left px-2 py-1">TF-function</th>
                  <th className="text-left px-2 py-1">Experimental techniques</th>
                </tr>
              </thead>

              <tbody>

                {/* BULK ROW */}
                <tr className="border-b border-border bg-muted/40">
                  <td className="px-2 py-1">
                    <button
                      className="text-blue-400 hover:text-blue-300 underline"
                      onClick={() => {
                        const any = sites.some((s) => annotations[s]?.selected);
                        const a = {};
                        sites.forEach((s) => {
                          a[s] = {
                            ...(annotations[s] || {
                              tfType: "monomer",
                              tfFunc: "activator",
                              useTechniques: false,
                            }),
                            selected: !any,
                          };
                        });
                        setAnnotations(a);
                      }}
                    >
                      Select/Unselect all
                    </button>
                  </td>

                  <td className="px-2 py-1">
                    <div className="flex flex-col gap-1">
                      <select
                        className="form-control h-7 text-xs"
                        value={bulkTfType}
                        onChange={(e) => setBulkTfType(e.target.value)}
                      >
                        {TF_TYPES.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>

                      <button
                        className="text-blue-400 hover:text-blue-300 underline text-[11px]"
                        onClick={() => {
                          const a = {};
                          sites.forEach((s) => {
                            const p = annotations[s] || {};
                            a[s] = {
                              ...p,
                              tfType: p.selected ? bulkTfType : p.tfType,
                            };
                          });
                          setAnnotations(a);
                        }}
                      >
                        Apply to selected
                      </button>
                    </div>
                  </td>

                  <td className="px-2 py-1">
                    <div className="flex flex-col gap-1">
                      <select
                        className="form-control h-7 text-xs"
                        value={bulkTfFunc}
                        onChange={(e) => setBulkTfFunc(e.target.value)}
                      >
                        {TF_FUNCS.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>

                      <button
                        className="text-blue-400 hover:text-blue-300 underline text-[11px]"
                        onClick={() => {
                          const a = {};
                          sites.forEach((s) => {
                            const p = annotations[s] || {};
                            a[s] = {
                              ...p,
                              tfFunc: p.selected ? bulkTfFunc : p.tfFunc,
                            };
                          });
                          setAnnotations(a);
                        }}
                      >
                        Apply to selected
                      </button>
                    </div>
                  </td>

                  <td className="px-2 py-1">
                    <div className="flex flex-col gap-1">
                      {/* ✔️ SOLO NOMBRE DE LAS TÉCNICAS */}
                      <span className="text-xs">
                        {techniques?.map((t) => t.name).join(", ") || "—"}
                      </span>

                      {techniques?.length > 0 && (
                        <div className="flex gap-2 text-[11px]">
                          <button
                            className="text-blue-400 hover:text-blue-300 underline"
                            onClick={() => {
                              const a = {};
                              sites.forEach((s) => {
                                const p = annotations[s] || {};
                                a[s] = {
                                  ...p,
                                  useTechniques: p.selected || p.useTechniques,
                                };
                              });
                              setAnnotations(a);
                            }}
                          >
                            Apply to selected
                          </button>

                          <button
                            className="text-blue-400 hover:text-blue-300 underline"
                            onClick={() => {
                              const a = {};
                              sites.forEach((s) => {
                                const p = annotations[s] || {};
                                a[s] = { ...p, useTechniques: false };
                              });
                              setAnnotations(a);
                            }}
                          >
                            Clear all
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>

                {/* PER-SITE ROWS */}
                {sites.map((site) => {
                  const ann = annotations[site] || {
                    selected: false,
                    tfType: "monomer",
                    tfFunc: "activator",
                    useTechniques: false,
                  };

                  const sel = choice[site];

                  const ex = exactHits[site];
                  const fz = fuzzyHits[site];

                  let text = site;

                  // exact match
                  if (sel && sel.startsWith("ex-")) {
                    const idx = parseInt(sel.split("-")[1]);
                    const h = ex[idx];
                    if (h)
                      text = `${h.site} ${h.strand}[${h.start + 1},${h.end + 1
                        }] ${h.acc}`;
                  }

                  // fuzzy match
                  else if (sel && sel.startsWith("fz-")) {
                    const idx = parseInt(sel.split("-")[1]);
                    const h = fz[idx];
                    if (h)
                      text = `${h.site}\n${h.bars}\n${h.match} ${h.strand}[${h.start + 1
                        },${h.end + 1}] ${h.acc}`;
                  }

                  // both no match
                  else if (sel === "none-both") {
                    text = site;
                  }

                  return (
                    <tr key={site} className="border-b border-border">
                      <td className="px-2 py-2 align-top">
                        <label className="flex gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={ann.selected}
                            onChange={() =>
                              setAnnotations((p) => ({
                                ...p,
                                [site]: { ...ann, selected: !ann.selected },
                              }))
                            }
                          />
                          <span className="font-mono text-[11px] whitespace-pre-wrap">
                            {text}
                          </span>
                        </label>
                      </td>

                      <td className="px-2 py-2 align-top">
                        <select
                          className="form-control h-7 text-xs"
                          value={ann.tfType}
                          onChange={(e) =>
                            setAnnotations((p) => ({
                              ...p,
                              [site]: { ...ann, tfType: e.target.value },
                            }))
                          }
                        >
                          {TF_TYPES.map((t) => (
                            <option key={t}>{t}</option>
                          ))}
                        </select>
                      </td>

                      <td className="px-2 py-2 align-top">
                        <select
                          className="form-control h-7 text-xs"
                          value={ann.tfFunc}
                          onChange={(e) =>
                            setAnnotations((p) => ({
                              ...p,
                              [site]: { ...ann, tfFunc: e.target.value },
                            }))
                          }
                        >
                          {TF_FUNCS.map((t) => (
                            <option key={t}>{t}</option>
                          ))}
                        </select>
                      </td>

                      <td className="px-2 py-2 align-top">
                        {techniques?.length > 0 ? (
                          <label className="inline-flex gap-2 text-xs cursor-pointer">
                            <input
                              type="checkbox"
                              checked={ann.useTechniques}
                              onChange={(e) =>
                                setAnnotations((p) => ({
                                  ...p,
                                  [site]: {
                                    ...ann,
                                    useTechniques: e.target.checked,
                                  },
                                }))
                              }
                            />
                            {/* ✔️ SOLO NOMBRE DE LAS TÉCNICAS */}
                            {techniques.map((t) => t.name).join(", ")}
                          </label>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

          </div>
        )}
      </div>
    </div>
  );
}

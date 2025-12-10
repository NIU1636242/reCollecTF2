import React, { useState, useEffect } from "react";
import { useCuration } from "../../context/CurationContext";
import genbankParser from "genbank-parser";

/* ============================================================
   Sequence helpers
============================================================ */
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

/* ============================================================
   MAIN COMPONENT
============================================================ */
export default function Step4ReportedSites() {
  const { genomeList, techniques } = useCuration();

  /* UI state */
  const [accordion, setAccordion] = useState({
    a1: true,
    a2: true,
    a3: false,
    a4: true,
  });

  const toggleAcc = (k) =>
    setAccordion((p) => ({ ...p, [k]: !p[k] }));

  const [rawSites, setRawSites] = useState("");
  const [sites, setSites] = useState([]);

  const [genomes, setGenomes] = useState([]);
  const [exactHits, setExactHits] = useState({});
  const [fuzzyHits, setFuzzyHits] = useState({});
  const [choice, setChoice] = useState({});
  const [showFuzzy, setShowFuzzy] = useState(false);

  const [annotations, setAnnotations] = useState({});

  const TF_TYPES = ["monomer", "dimer", "tetramer", "other", "not specified"];
  const TF_FUNCS = ["activator", "repressor", "dual", "not specified"];

  const [bulkTfType, setBulkTfType] = useState("monomer");
  const [bulkTfFunc, setBulkTfFunc] = useState("activator");

  /* ============================================================
     Load genomes: FASTA + GenBank (gene extraction)
  ============================================================ */
  useEffect(() => {
    if (!genomeList || genomeList.length === 0) return;

    async function load() {
      const out = [];

      for (const g of genomeList) {
        try {
          /* -------- FASTA -------- */
          const fastaURL = `https://corsproxy.io/?https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=${g.accession}&rettype=fasta&retmode=text`;
          const fastaRes = await fetch(fastaURL);
          const fastaText = await fastaRes.text();

          const seq = fastaText
            .replace(/>.*/g, "")
            .replace(/[^ATCGatcg]/g, "")
            .toUpperCase();

          /* -------- GENBANK -------- */
          const gbURL = `https://corsproxy.io/?https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=${g.accession}&rettype=gbwithparts&retmode=text`;
          const gbRes = await fetch(gbURL);
          const gbText = await gbRes.text();

          const gbParsed = genbankParser(gbText) || [];
          const entry = gbParsed[0] || {};
          const features = entry.features || [];

          const genes = features
            .filter((f) => f.type === "gene" || f.type === "CDS")
            .map((f) => ({
              start: f.start,
              end: f.end,
              locus: f.notes?.locus_tag?.[0] || "",
              gene: f.notes?.gene?.[0] || "",
              function:
                f.notes?.function?.[0] ||
                f.notes?.product?.[0] ||
                "",
            }));

          out.push({
            acc: g.accession,
            sequence: seq,
            genes,
          });
        } catch (err) {
          console.error("Genome load error:", err);
        }
      }

      setGenomes(out);
    }

    load();
  }, [genomeList]);

  /* ============================================================
     Match: Exact search
  ============================================================ */
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

        /* forward strand */
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

        /* reverse strand */
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

      if (all[site].length === 0) all[site] = ["none"];
    });

    setExactHits(all);

    /* Reset states */
    const ch = {};
    arr.forEach((s) => (ch[s] = null));
    setChoice(ch);

    setFuzzyHits({});
    setShowFuzzy(false);
  }

  /* ============================================================
     Match: Fuzzy search (1–2 mismatches)
  ============================================================ */
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

  /* ============================================================
     Gene lookup: genes within ±150 bp
  ============================================================ */
  function findGenesForHit(acc, start, end) {
    const genome = genomes.find((g) => g.acc === acc);
    if (!genome) return [];

    const results = [];

    for (const gene of genome.genes) {
      const dist =
        start < gene.start
          ? gene.start - start
          : start - gene.end;

      if (Math.abs(dist) <= 150) {
        results.push({
          locus: gene.locus || "—",
          gene: gene.gene || "—",
          function: gene.function || "—",
          distance: Math.abs(dist),
        });
      }
    }

    results.sort((a, b) => a.distance - b.distance);
    return results;
  }

  /* ============================================================
     JSX: Render
  ============================================================ */
  return (
    <div className="space-y-8">

      {/* -------------------------------------------------------
           ACCORDION 1: Input sites
      -------------------------------------------------------- */}
      <div className="bg-surface border border-border rounded p-4">
        <button onClick={() => toggleAcc("a1")} className="flex justify-between w-full font-semibold mb-3">
          <span>Reported sites</span>
          <span>{accordion.a1 ? "▲" : "▼"}</span>
        </button>

        {accordion.a1 && (
          <div className="space-y-3 text-sm">
            <textarea
              className="form-control w-full h-40 text-sm"
              placeholder="AAGATTTCTTT"
              value={rawSites}
              onChange={(e) => setRawSites(e.target.value)}
            />

            <button className="btn" onClick={findExact}>
              Save
            </button>
          </div>
        )}
      </div>

      {/* -------------------------------------------------------
           ACCORDION 2: Exact matches
      -------------------------------------------------------- */}
      <div className="bg-surface border border-border rounded p-4">
        <button onClick={() => toggleAcc("a2")} className="flex justify-between w-full font-semibold mb-3">
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
                      <label key={i} className="flex flex-row gap-2 text-xs cursor-pointer">
                        <input
                          type="radio"
                          className="mt-1"
                          name={`ex-${site}`}
                          checked={choice[site] === `ex-${i}`}
                          onChange={() => {
                            setChoice((p) => ({ ...p, [site]: `ex-${i}` }));
                            setAccordion((p) => ({ ...p, a4: true }));
                          }}
                        />

                        {/* Match + nearby gene table */}
                        {(() => {
                          const nearby = findGenesForHit(hit.acc, hit.start + 1, hit.end + 1);

                          return (
                            <div className="font-mono leading-4">
                              {hit.site} {hit.strand}[{hit.start + 1},{hit.end + 1}] {hit.acc}

                              {nearby.length > 0 && (
                                <table className="ml-4 mt-1 text-[11px] text-blue-300">
                                  <thead>
                                    <tr>
                                      <th className="pr-4 text-left">locus tag</th>
                                      <th className="pr-4 text-left">gene</th>
                                      <th className="pr-4 text-left">function</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {nearby.map((g, idx) => (
                                      <tr key={idx}>
                                        <td className="pr-4">{g.locus}</td>
                                        <td className="pr-4">{g.gene}</td>
                                        <td className="pr-4">{g.function}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          );
                        })()}
                      </label>
                    ) : null
                  )}

                  {/* None */}
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

      {/* -------------------------------------------------------
           ACCORDION 3: Fuzzy matches
      -------------------------------------------------------- */}
      {showFuzzy && (
        <div className="bg-surface border border-border rounded p-4">
          <button onClick={() => toggleAcc("a3")} className="flex justify-between w-full font-semibold mb-3">
            <span>Inexact matches (mismatches)</span>
            <span>{accordion.a3 ? "▲" : "▼"}</span>
          </button>

          {accordion.a3 && (
            <div className="space-y-4 text-sm">
              {sites.map((site) => {
                const arr = fuzzyHits[site] || [];
                return (
                  <div key={site} className="border border-border rounded p-3 space-y-2">
                    <div className="font-semibold text-accent">{site}</div>

                    {arr.map((hit, i) =>
                      hit !== "none" ? (
                        <label key={i} className="flex flex-row gap-2 text-xs cursor-pointer">
                          <input
                            type="radio"
                            className="mt-1"
                            name={`fz-${site}`}
                            checked={choice[site] === `fz-${i}`}
                            onChange={() => {
                              setChoice((p) => ({ ...p, [site]: `fz-${i}` }));
                              setAccordion((p) => ({ ...p, a4: true }));
                            }}
                          />

                          {/* Info + mismatches + gene table */}
                          {(() => {
                            const nearby = findGenesForHit(hit.acc, hit.start + 1, hit.end + 1);

                            return (
                              <div className="font-mono whitespace-pre leading-4">
                                {hit.site}
                                {"\n"}
                                {hit.bars}
                                {"\n"}
                                {hit.match} {hit.strand}[{hit.start + 1},{hit.end + 1}] {hit.acc}

                                {nearby.length > 0 && (
                                  <table className="ml-4 mt-1 text-[11px] text-blue-300">
                                    <thead>
                                      <tr>
                                        <th className="pr-4 text-left">locus tag</th>
                                        <th className="pr-4 text-left">gene</th>
                                        <th className="pr-4 text-left">function</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {nearby.map((g, idx) => (
                                        <tr key={idx}>
                                          <td className="pr-4">{g.locus}</td>
                                          <td className="pr-4">{g.gene}</td>
                                          <td className="pr-4">{g.function}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            );
                          })()}
                        </label>
                      ) : null
                    )}

                    {/* None option */}
                    <label className="flex gap-2 text-xs cursor-pointer mt-2">
                      <input
                        type="radio"
                        name={`fz-${site}`}
                        checked={choice[site] === "none-both"}
                        onChange={() =>
                          setChoice((p) => ({ ...p, [site]: "none-both" }))
                        }
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

      {/* -------------------------------------------------------
           ACCORDION 4: Annotation table
      -------------------------------------------------------- */}
      <div className="bg-surface border border-border rounded p-4">
        <button onClick={() => toggleAcc("a4")} className="flex justify-between w-full font-semibold mb-3">
          <span>Site annotation</span>
          <span>{accordion.a4 ? "▲" : "▼"}</span>
        </button>

        {accordion.a4 && (
          <div className="text-sm">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-2 py-1 text-left">Site</th>
                  <th className="px-2 py-1 text-left">TF-type</th>
                  <th className="px-2 py-1 text-left">TF-function</th>
                  <th className="px-2 py-1 text-left">Experimental techniques</th>
                </tr>
              </thead>

              <tbody>
                {/* Bulk apply row */}
                <tr className="border-b border-border bg-muted/40">
                  <td className="px-2 py-1">
                    <button
                      className="text-blue-400 underline"
                      onClick={() => {
                        const allSelected = sites.some((s) => annotations[s]?.selected);
                        const out = {};

                        sites.forEach((s) => {
                          out[s] = {
                            ...(annotations[s] || {
                              tfType: "monomer",
                              tfFunc: "activator",
                              useTechniques: false,
                            }),
                            selected: !allSelected,
                          };
                        });

                        setAnnotations(out);
                      }}
                    >
                      Select/Unselect all
                    </button>
                  </td>

                  {/* Bulk TF-type */}
                  <td className="px-2 py-1">
                    <select
                      className="form-control h-7 text-xs w-28"
                      value={bulkTfType}
                      onChange={(e) => setBulkTfType(e.target.value)}
                    >
                      {TF_TYPES.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>

                    <button
                      className="text-blue-400 underline text-[11px]"
                      onClick={() => {
                        const out = {};
                        sites.forEach((s) => {
                          const p = annotations[s] || {};
                          out[s] = {
                            ...p,
                            tfType: p.selected ? bulkTfType : p.tfType,
                          };
                        });
                        setAnnotations(out);
                      }}
                    >
                      Apply to selected
                    </button>
                  </td>

                  {/* Bulk TF-func */}
                  <td className="px-2 py-1">
                    <select
                      className="form-control h-7 text-xs w-28"
                      value={bulkTfFunc}
                      onChange={(e) => setBulkTfFunc(e.target.value)}
                    >
                      {TF_FUNCS.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>

                    <button
                      className="text-blue-400 underline text-[11px]"
                      onClick={() => {
                        const out = {};
                        sites.forEach((s) => {
                          const p = annotations[s] || {};
                          out[s] = {
                            ...p,
                            tfFunc: p.selected ? bulkTfFunc : p.tfFunc,
                          };
                        });
                        setAnnotations(out);
                      }}
                    >
                      Apply to selected
                    </button>
                  </td>

                  {/* Bulk techniques */}
                  <td className="px-2 py-1">
                    <span className="text-xs">
                      {techniques?.map((t) => t.name).join(", ") || "—"}
                    </span>

                    <div className="flex gap-2 text-[11px]">
                      <button
                        className="text-blue-400 underline"
                        onClick={() => {
                          const out = {};
                          sites.forEach((s) => {
                            const p = annotations[s] || {};
                            out[s] = {
                              ...p,
                              useTechniques: p.selected ? true : p.useTechniques,
                            };
                          });
                          setAnnotations(out);
                        }}
                      >
                        Apply to selected
                      </button>

                      <button
                        className="text-blue-400 underline"
                        onClick={() => {
                          const out = {};
                          sites.forEach((s) => {
                            const p = annotations[s] || {};
                            out[s] = { ...p, useTechniques: false };
                          });
                          setAnnotations(out);
                        }}
                      >
                        Clear all
                      </button>
                    </div>
                  </td>
                </tr>

                {/* Per-site rows */}
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

                  if (sel && sel.startsWith("ex-")) {
                    const idx = parseInt(sel.split("-")[1]);
                    const hit = ex[idx];
                    if (hit)
                      text = `${hit.site} ${hit.strand}[${hit.start + 1},${hit.end + 1}] ${hit.acc}`;
                  }

                  if (sel && sel.startsWith("fz-")) {
                    const idx = parseInt(sel.split("-")[1]);
                    const hit = fz[idx];
                    if (hit)
                      text = `${hit.site}\n${hit.bars}\n${hit.match} ${hit.strand}[${hit.start + 1},${hit.end + 1}] ${hit.acc}`;
                  }

                  return (
                    <tr key={site} className="border-b border-border">
                      {/* Checkbox + site text */}
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

                      {/* TF Type */}
                      <td className="px-2 py-2 align-top">
                        <select
                          className="form-control h-7 text-xs w-28"
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

                      {/* TF Function */}
                      <td className="px-2 py-2 align-top">
                        <select
                          className="form-control h-7 text-xs w-28"
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

                      {/* Techniques */}
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

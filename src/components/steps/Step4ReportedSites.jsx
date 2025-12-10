import React, { useState, useEffect } from "react";
import { useCuration } from "../../context/CurationContext";
import genbankParser from "genbank-parser";

// =======================================================
// Small sequence helpers
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

// =======================================================
// MAIN COMPONENT
// =======================================================

export default function Step4ReportedSites() {
  const { genomeList, techniques } = useCuration();

  // Accordions open/closed
  const [accordion, setAccordion] = useState({
    a1: true,
    a2: true,
    a3: false,
    a4: true,
  });

  const toggleAcc = (k) =>
    setAccordion((p) => ({
      ...p,
      [k]: !p[k],
    }));

  // User input
  const [siteType, setSiteType] = useState("variable");
  const [rawSites, setRawSites] = useState("");

  // List of cleaned sequences
  const [sites, setSites] = useState([]);

  // Genomes: { acc, sequence, genes[] }
  const [genomes, setGenomes] = useState([]);

  // Matches
  const [exactHits, setExactHits] = useState({});
  const [fuzzyHits, setFuzzyHits] = useState({});

  // User choice por sitio:
  //  - "ex-0", "ex-1"...
  //  - "fz-0", "fz-1"...
  //  - "none" (no exact, se buscan mismatches)
  //  - "none-both" (ni exact ni mismatches)
  const [choice, setChoice] = useState({});

  // Mostrar acordeón de mismatches
  const [showFuzzy, setShowFuzzy] = useState(false);

  // Datos del acordeón 4 (Site annotation)
  const [annotations, setAnnotations] = useState({});

  const TF_TYPES = ["monomer", "dimer", "tetramer", "other", "not specified"];
  const TF_FUNCS = ["activator", "repressor", "dual", "not specified"];

  const [bulkTfType, setBulkTfType] = useState("monomer");
  const [bulkTfFunc, setBulkTfFunc] = useState("activator");

  // =======================================================
  // LOAD GENOMES (FASTA + GENBANK PARSED WITH genbank-parser)
  // =======================================================

  useEffect(() => {
    if (!genomeList || genomeList.length === 0) return;

    async function load() {
      const out = [];

      for (const g of genomeList) {
        try {
          // FASTA
          const fastaURL =
            "https://corsproxy.io/?" +
            encodeURIComponent(
              `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=${g.accession}&rettype=fasta&retmode=text`
            );
          const fastaRes = await fetch(fastaURL);
          const fastaText = await fastaRes.text();

          const seq = fastaText
            .replace(/>.*/g, "")
            .replace(/[^ATCGatcg]/g, "")
            .toUpperCase();

          // GENBANK
          const gbURL =
            "https://corsproxy.io/?" +
            encodeURIComponent(
              `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=${g.accession}&rettype=gbwithparts&retmode=text`
            );
          const gbRes = await fetch(gbURL);
          const gbText = await gbRes.text();

          const parsed = genbankParser(gbText);
          const entry = parsed?.[0];
          const features = entry?.features || [];

          // Nos quedamos con gene y CDS
          const genes = features
            .filter((f) => f.type === "gene" || f.type === "CDS")
            .map((f) => ({
              start: f.start,
              end: f.end,
              locus: f.notes?.locus_tag?.[0] || "",
              gene: f.notes?.gene?.[0] || "",
              // Si no hay función, dejamos string vacío (no "-")
              function: f.notes?.function?.[0] || f.notes?.product?.[0] || "",
            }));

          out.push({
            acc: g.accession,
            sequence: seq,
            genes,
          });

          console.log("GENES PARSED FOR", g.accession, genes.slice(0, 5));
        } catch (err) {
          console.error("Error loading genome:", err);
        }
      }

      setGenomes(out);

      console.log(
        "GENOMES LOADED:",
        out.map((g) => ({
          acc: g.acc,
          genes: g.genes.length,
          example: g.genes.slice(0, 3),
        }))
      );
    }

    load();
  }, [genomeList]);

  // =======================================================
  // GIVEN A HIT, FIND NEARBY GENES (<=150 nt)
  // =======================================================

  function findGenesForHit(acc, hitStart, hitEnd) {
    const genome = genomes.find((g) => g.acc === acc);
    if (!genome || !genome.genes) return [];

    const results = [];

    for (const gene of genome.genes) {
      const distStart = Math.abs(gene.start - hitStart);
      const distEnd = Math.abs(gene.end - hitEnd);
      const dist = Math.min(distStart, distEnd);

      if (dist <= 150) {
        results.push({
          locus: gene.locus || "",
          gene: gene.gene || "",
          function: gene.function || "",
          distance: dist,
        });
      }
    }

    results.sort((a, b) => a.distance - b.distance);
    return results;
  }

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

        // + strand
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

        // - strand
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

    // reset elecciones
    const ch = {};
    arr.forEach((s) => (ch[s] = null));
    setChoice(ch);

    // reset mismatches
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

  // =======================================================
  // RENDER
  // =======================================================

  return (
    <div className="space-y-8">
      {/* =======================================================
          ACCORDION 1 — INPUT
      ======================================================= */}
      <div className="bg-surface border border-border rounded p-4">
        <button
          className="flex justify-between w-full font-semibold mb-3"
          onClick={() => toggleAcc("a1")}
        >
          <span>Reported sites</span>
          <span>{accordion.a1 ? "▲" : "▼"}</span>
        </button>

        {accordion.a1 && (
          <div className="space-y-3 text-sm">
            {/* Site type (como en el pipeline original) */}
            <div className="space-y-1">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={siteType === "motif"}
                  onChange={() => setSiteType("motif")}
                />
                motif-associated (new motif)
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={siteType === "variable"}
                  onChange={() => setSiteType("variable")}
                />
                variable motif associated
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={siteType === "nonmotif"}
                  onChange={() => setSiteType("nonmotif")}
                />
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
        <button
          className="flex justify-between w-full font-semibold mb-3"
          onClick={() => toggleAcc("a2")}
        >
          <span>Exact site matches</span>
          <span>{accordion.a2 ? "▲" : "▼"}</span>
        </button>

        {accordion.a2 && (
          <div className="space-y-4 text-sm">
            {sites.map((site) => {
              const arr = exactHits[site] || [];

              return (
                <div
                  key={site}
                  className="border border-border rounded p-3 space-y-2"
                >
                  <div className="font-semibold text-accent">{site}</div>

                  {arr.map((hit, i) => {
                    if (hit === "none") return null;

                    const nearby = findGenesForHit(
                      hit.acc,
                      hit.start + 1,
                      hit.end + 1
                    );

                    return (
                      <label
                        key={i}
                        className="flex items-start gap-2 text-xs cursor-pointer"
                      >
                        {/* círculo alineado al texto */}
                        <input
                          type="radio"
                          name={`ex-${site}`}
                          className="mt-[3px]"
                          checked={choice[site] === `ex-${i}`}
                          onChange={() => {
                            setChoice((p) => ({ ...p, [site]: `ex-${i}` }));
                            setAccordion((p) => ({ ...p, a4: true }));
                          }}
                        />
                        <div>
                          <div className="font-mono">
                            {hit.site} {hit.strand}[{hit.start + 1},{hit.end + 1}]{" "}
                            {hit.acc}
                          </div>

                          {nearby.length > 0 && (
                            <table className="mt-1 text-[11px]">
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
                                    <td className="pr-4">
                                      {g.function || ""}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </label>
                    );
                  })}

                  {/* no match */}
                  <label className="flex items-center gap-2 text-xs cursor-pointer mt-2">
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
          <button
            className="flex justify-between w-full font-semibold mb-3"
            onClick={() => toggleAcc("a3")}
          >
            <span>Inexact matches (mismatches)</span>
            <span>{accordion.a3 ? "▲" : "▼"}</span>
          </button>

          {accordion.a3 && (
            <div className="space-y-4 text-sm">
              {sites.map((site) => {
                const arr = fuzzyHits[site];
                if (!arr) return null;

                return (
                  <div
                    key={site}
                    className="border border-border rounded p-3 space-y-2"
                  >
                    <div className="font-semibold text-accent">{site}</div>

                    {arr.map((hit, i) => {
                      if (hit === "none") return null;

                      const nearby = findGenesForHit(
                        hit.acc,
                        hit.start + 1,
                        hit.end + 1
                      );

                      return (
                        <label
                          key={i}
                          className="flex items-start gap-2 text-xs cursor-pointer"
                        >
                          <input
                            type="radio"
                            name={`fz-${site}`}
                            className="mt-[3px]"
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
                            {hit.match} {hit.strand}[{hit.start + 1},
                            {hit.end + 1}] {hit.acc}
                            {nearby.length > 0 && (
                              <table className="mt-1 text-[11px]">
                                <thead>
                                  <tr>
                                    <th className="pr-4 text-left">
                                      locus tag
                                    </th>
                                    <th className="pr-4 text-left">gene</th>
                                    <th className="pr-4 text-left">
                                      function
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {nearby.map((g, idx) => (
                                    <tr key={idx}>
                                      <td className="pr-4">{g.locus}</td>
                                      <td className="pr-4">{g.gene}</td>
                                      <td className="pr-4">
                                        {g.function || ""}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </label>
                      );
                    })}

                    {/* no mismatches tampoco */}
                    <label className="flex items-center gap-2 text-xs cursor-pointer mt-2">
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
        <button
          className="flex justify-between w-full font-semibold mb-3"
          onClick={() => toggleAcc("a4")}
        >
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
                  <th className="text-left px-2 py-1">
                    Experimental techniques
                  </th>
                </tr>
              </thead>

              <tbody>
                {/* FILA BULK */}
                <tr className="border-b border-border bg-muted/40">
                  <td className="px-2 py-1">
                    <button
                      className="text-blue-400 hover:text-blue-300 underline"
                      onClick={() => {
                        const any = sites.some(
                          (s) => annotations[s]?.selected
                        );
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
                        className="form-control text-xs"
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
                        className="form-control text-xs"
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
                                  useTechniques:
                                    p.selected || p.useTechniques,
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

                {/* FILAS POR SITIO */}
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
                    const idx = parseInt(sel.split("-")[1], 10);
                    const h = ex?.[idx];
                    if (h) {
                      text = `${h.site} ${h.strand}[${h.start + 1},${
                        h.end + 1
                      }] ${h.acc}`;
                    }
                  } else if (sel && sel.startsWith("fz-")) {
                    const idx = parseInt(sel.split("-")[1], 10);
                    const h = fz?.[idx];
                    if (h) {
                      text = `${h.site}\n${h.bars}\n${h.match} ${h.strand}[${
                        h.start + 1
                      },${h.end + 1}] ${h.acc}`;
                    }
                  } else if (sel === "none-both") {
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
                          className="form-control text-xs"
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
                          className="form-control text-xs"
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

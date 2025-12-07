import React, { useState, useEffect } from "react";
import { useCuration } from "../../context/CurationContext";

// =======================================================
// UTILS
// =======================================================

function revComp(seq) {
  const map = { A: "T", T: "A", C: "G", G: "C" };
  return seq
    .split("")
    .reverse()
    .map((b) => map[b] || "N")
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
    .map((c, i) => (a[i] === b[i] ? "|" : " "))
    .join("");
}

// =======================================================
// COMPONENTE
// =======================================================

export default function Step4ReportedSites() {
  const { genomeList, techniques } = useCuration();

  const [accordion, setAccordion] = useState({
    a1: true,
    a2: true,
    a3: false,
    a4: true,
  });

  const [siteType, setSiteType] = useState("variable");
  const [rawSites, setRawSites] = useState("");

  const [sites, setSites] = useState([]);

  const [genomes, setGenomes] = useState([]);
  const [exactHits, setExactHits] = useState({});
  const [fuzzyHits, setFuzzyHits] = useState({});

  const [choice, setChoice] = useState({});
  const [showFuzzy, setShowFuzzy] = useState(false);

  // Acordeón 4 data
  const [annotations, setAnnotations] = useState({});

  // =======================================================
  // CARGAR GENOMAS COMO ANTES (SOLO SECUENCIA)
  // =======================================================

  useEffect(() => {
    if (!genomeList || genomeList.length === 0) return;

    async function load() {
      const out = [];

      for (const g of genomeList) {
        try {
          // IMPORTANTE: usar tu proxy y endpoint original
          const url = `https://corsproxy.io/?https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=${g.accession}&rettype=fasta&retmode=text`;

          const res = await fetch(url);
          const txt = await res.text();

          const seq = txt
            .replace(/>.*/g, "")
            .replace(/[^ATCGatcg]/g, "")
            .toUpperCase();

          out.push({
            acc: g.accession,
            sequence: seq,
          });
        } catch (err) {
          console.error(err);
        }
      }

      setGenomes(out);
    }

    load();
  }, [genomeList]);

  // =======================================================
  // BUSCAR EXACT MATCHES (VERSIÓN ORIGINAL)
  // =======================================================

  function searchExact() {
    const arr = rawSites
      .split(/\r?\n/g)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    setSites(arr);

    const all = {};

    arr.forEach((site) => {
      const rc = revComp(site);
      all[site] = [];

      genomes.forEach((g) => {
        const seq = g.sequence;
        const L = site.length;

        // +
        let i = seq.indexOf(site);
        while (i !== -1) {
          all[site].push({
            seq: site,
            match: site,
            start: i,
            end: i + L - 1,
            strand: "+",
            acc: g.acc,
          });
          i = seq.indexOf(site, i + 1);
        }

        // -
        let j = seq.indexOf(rc);
        while (j !== -1) {
          all[site].push({
            seq: site,
            match: rc,
            start: j,
            end: j + L - 1,
            strand: "-",
            acc: g.acc,
          });
          j = seq.indexOf(rc, j + 1);
        }
      });

      if (all[site].length === 0) all[site].push("none");
    });

    setExactHits(all);

    // inicializar choice
    const ch = {};
    arr.forEach((s) => (ch[s] = null));
    setChoice(ch);

    // reset fuzzy
    setFuzzyHits({});
    setShowFuzzy(false);
  }

  // =======================================================
  // BUSCAR MISMATCHES (VERSIÓN ORIGINAL)
  // =======================================================

  function searchFuzzy(site) {
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
            site,
            match: sub,
            bars: buildBars(site, sub),
            start: i,
            end: i + L - 1,
            strand: "+",
            acc: g.acc,
          });
        }

        const mmR = mismatches(sub, rc);
        if (mmR > 0 && mmR <= 2) {
          found.push({
            site,
            match: sub,
            bars: buildBars(rc, sub),
            start: i,
            end: i + L - 1,
            strand: "-",
            acc: g.acc,
          });
        }
      }
    });

    if (found.length === 0) found.push("none");

    setFuzzyHits((p) => ({ ...p, [site]: found }));
    setShowFuzzy(true);
  }

  // =======================================================
  // UI
  // =======================================================

  return (
    <div className="space-y-8">

      {/* =======================================================
          1: REPORTED SITES
      ======================================================= */}
      <div className="bg-surface border border-border rounded p-4">
        <button className="flex justify-between w-full font-semibold mb-3"
          onClick={() => setAccordion(p => ({ ...p, a1: !p.a1 }))}>
          <span>Reported sites</span>
          <span>{accordion.a1 ? "▲" : "▼"}</span>
        </button>

        {accordion.a1 && (
          <div className="space-y-3 text-sm">
            <div>
              <label className="flex items-center gap-2">
                <input type="radio" checked={siteType === "motif"}
                  onChange={() => setSiteType("motif")} />
                <span>motif-associated (new motif)</span>
              </label>

              <label className="flex items-center gap-2">
                <input type="radio" checked={siteType === "variable"}
                  onChange={() => setSiteType("variable")} />
                <span>variable motif associated</span>
              </label>

              <label className="flex items-center gap-2">
                <input type="radio" checked={siteType === "nonmotif"}
                  onChange={() => setSiteType("nonmotif")} />
                <span>non-motif associated</span>
              </label>
            </div>

            <textarea
              className="form-control w-full h-40 text-sm"
              value={rawSites}
              onChange={(e) => setRawSites(e.target.value)}
            />

            <button className="btn" onClick={searchExact}>Save</button>
          </div>
        )}
      </div>

      {/* =======================================================
          2: EXACT MATCHES
      ======================================================= */}
      <div className="bg-surface border border-border rounded p-4">
        <button className="flex justify-between w-full font-semibold mb-3"
          onClick={() => setAccordion(p => ({ ...p, a2: !p.a2 }))}>
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

                  {arr.map((hit, i) => (
                    hit !== "none" ? (
                      <label key={i} className="flex items-center gap-2 text-xs cursor-pointer">
                        <input
                          type="radio"
                          name={`ex-${site}`}
                          checked={choice[site] === `ex-${i}`}
                          onChange={() => {
                            setChoice(p => ({ ...p, [site]: `ex-${i}` }));
                            setAccordion(p => ({ ...p, a4: true }));
                          }}
                        />
                        <span className="font-mono">
                          {hit.seq} {hit.strand}[{hit.start + 1},{hit.end + 1}] {hit.acc}
                        </span>
                      </label>
                    ) : null
                  ))}

                  <label className="flex items-center gap-2 text-xs cursor-pointer mt-2">
                    <input
                      type="radio"
                      name={`ex-${site}`}
                      checked={choice[site] === "none"}
                      onChange={() => {
                        setChoice(p => ({ ...p, [site]: "none" }));
                        searchFuzzy(site);
                        setAccordion(p => ({ ...p, a3: true }));
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
          3: INEXACT MATCHES (MISMATCHES)
      ======================================================= */}
      {showFuzzy && (
        <div className="bg-surface border border-border rounded p-4">
          <button className="flex justify-between w-full font-semibold mb-3"
            onClick={() => setAccordion(p => ({ ...p, a3: !p.a3 }))}>
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
                        <label key={i}
                          className="flex items-start gap-2 text-xs cursor-pointer">
                          <input
                            type="radio"
                            name={`fz-${site}`}
                            checked={choice[site] === `fz-${i}`}
                            onChange={() => {
                              setChoice(p => ({ ...p, [site]: `fz-${i}` }));
                              setAccordion(p => ({ ...p, a4: true }));
                            }}
                          />
                          <span className="font-mono whitespace-pre">
                            {hit.seq}
                            {"\n"}
                            {hit.bars}
                            {"\n"}
                            {hit.match} {hit.strand}[{hit.start + 1},{hit.end + 1}] {hit.acc}
                          </span>
                        </label>
                      ) : null
                    )}

                    <label className="flex items-center gap-2 text-xs cursor-pointer mt-2">
                      <input
                        type="radio"
                        name={`fz-${site}`}
                        checked={choice[site] === "fz-none"}
                        onChange={() => {
                          setChoice(p => ({ ...p, [site]: "fz-none" }));
                          setAccordion(p => ({ ...p, a4: true }));
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
          4: SITE ANNOTATION (el tuyo actual)
      ======================================================= */}
           <div className="bg-surface border border-border rounded p-4">
        <button
          className="flex justify-between w-full text-lg font-semibold mb-3"
          onClick={() => toggleAccordion("step4")}
        >
          <span>Site annotation</span>
          <span>{accordionOpen.step4 ? "▲" : "▼"}</span>
        </button>

        {accordionOpen.step4 && (
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
                {/* fila de controles globales */}
                <tr className="border-b border-border bg-muted/40">
                  <td className="px-2 py-1">
                    <button
                      type="button"
                      className="text-blue-400 hover:text-blue-300 underline"
                      onClick={selectUnselectAll}
                    >
                      Select/Unselect all
                    </button>
                  </td>

                  {/* TF-type global */}
                  <td className="px-2 py-1">
                    <div className="flex flex-col gap-1">
                      <select
                        className="form-control h-7 text-xs"
                        value={bulkTfType}
                        onChange={(e) => setBulkTfType(e.target.value)}
                      >
                        {TF_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="text-blue-400 hover:text-blue-300 underline text-[11px]"
                        onClick={applyTfTypeToSelected}
                      >
                        Apply to selected
                      </button>
                    </div>
                  </td>

                  {/* TF-function global */}
                  <td className="px-2 py-1">
                    <div className="flex flex-col gap-1">
                      <select
                        className="form-control h-7 text-xs"
                        value={bulkTfFunc}
                        onChange={(e) => setBulkTfFunc(e.target.value)}
                      >
                        {TF_FUNCS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="text-blue-400 hover:text-blue-300 underline text-[11px]"
                        onClick={applyTfFuncToSelected}
                      >
                        Apply to selected
                      </button>
                    </div>
                  </td>

                  {/* Técnicas global */}
                  <td className="px-2 py-1">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs">
                        {techniquesText || "—"}
                      </span>
                      {techniques && techniques.length > 0 && (
                        <div className="flex gap-2 text-[11px]">
                          <button
                            type="button"
                            className="text-blue-400 hover:text-blue-300 underline"
                            onClick={applyTechniquesToSelected}
                          >
                            Apply to selected
                          </button>
                          <button
                            type="button"
                            className="text-blue-400 hover:text-blue-300 underline"
                            onClick={clearTechniques}
                          >
                            Clear all
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>

                {/* filas por sitio */}
                {sites.map((site) => {
                  const sel = finalChoice[site];
                  const annot = siteAnnotations[site] || {
                    selected: false,
                    tfType: "monomer",
                    tfFunc: "activator",
                    useTechniques: false,
                  };

                  // texto del sitio (según se haya escogido exact, fuzzy o none)
                  let siteText = site;
                  if (sel && sel.type === "exact") {
                    const m = sel.data;
                    siteText = `${m.siteSeq} ${m.strand}[${m.start + 1},${
                      m.end + 1
                    }]  ${m.genomeAcc}`;
                  } else if (sel && sel.type === "fuzzy") {
                    const m = sel.data;
                    siteText = `${m.siteSeq}\n${m.bars}\n${m.genomeSeq} ${
                      m.strand
                    }[${m.start + 1},${m.end + 1}]  ${m.genomeAcc}`;
                  }

                  return (
                    <tr key={site} className="border-b border-border">
                      {/* SITE + checkbox */}
                      <td className="px-2 py-2 align-top">
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            className="mt-[2px]"
                            checked={annot.selected}
                            onChange={() => toggleSiteSelected(site)}
                          />
                          <span className="font-mono text-[11px] whitespace-pre-wrap">
                            {siteText}
                          </span>
                        </label>
                      </td>

                      {/* TF-type por sitio */}
                      <td className="px-2 py-2 align-top">
                        <select
                          className="form-control h-7 text-xs"
                          value={annot.tfType}
                          onChange={(e) =>
                            updateSiteTfType(site, e.target.value)
                          }
                        >
                          {TF_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* TF-function por sitio */}
                      <td className="px-2 py-2 align-top">
                        <select
                          className="form-control h-7 text-xs"
                          value={annot.tfFunc}
                          onChange={(e) =>
                            updateSiteTfFunc(site, e.target.value)
                          }
                        >
                          {TF_FUNCS.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* Experimental techniques: checkbox general para todas las técnicas */}
                      <td className="px-2 py-2 align-top">
                        {techniques && techniques.length > 0 ? (
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={annot.useTechniques}
                              onChange={(e) =>
                                updateSiteUseTech(site, e.target.checked)
                              }
                            />
                            <span className="text-[11px]">
                              {techniquesText}
                            </span>
                          </label>
                        ) : (
                          <span className="text-xs text-muted">—</span>
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

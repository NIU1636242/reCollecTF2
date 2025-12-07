import React, { useState, useEffect } from "react";
import { useCuration } from "../../context/CurationContext";

// ========================= Helpers básicos =========================

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
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) n++;
  }
  return n;
}

function buildBars(a, b) {
  return a
    .split("")
    .map((c, i) => (c === b[i] ? "|" : " "))
    .join("");
}

// ------------ Parser GenBank para sacar genes (más robusto) --------

function parseGenesFromGenBank(txt) {
  const genes = [];
  const lines = txt.split("\n");
  let current = null;

  for (const raw of lines) {
    const line = raw.trim();

    // FEATURE gene: puede ser "gene            190..255"
    // o "gene            complement(123..456)" etc.
    if (line.startsWith("gene")) {
      // quitamos "gene" + espacios
      let coords = line.replace(/^gene\s+/, "");

      // complement(123..456)
      if (coords.startsWith("complement(")) {
        coords = coords.slice("complement(".length, -1);
      }

      const [startStr, endStr] = coords.split("..");
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);

      current = {
        start: isNaN(start) ? 1 : start,
        end: isNaN(end) ? start : end,
        locus_tag: "",
        gene_name: "",
        function: "",
      };
      genes.push(current);
      continue;
    }

    if (!current) continue;

    if (line.startsWith("/locus_tag=")) {
      current.locus_tag = line.split("=")[1].replace(/"/g, "");
    }

    if (line.startsWith("/gene=")) {
      current.gene_name = line.split("=")[1].replace(/"/g, "");
    }

    if (line.startsWith("/product=") || line.startsWith("/function=")) {
      const value = line.split("=")[1].replace(/"/g, "");
      // Si ya había algo, concatenamos (suele haber varias /function)
      current.function = current.function
        ? `${current.function}; ${value}`
        : value;
    }
  }

  return genes;
}

// -------------------- Buscar matches exactos -----------------------

function findExactMatches(genomeSeq, site) {
  const seq = site.toUpperCase();
  const rc = revComp(seq);
  const len = seq.length;

  const hits = [];

  // hebra +
  let i = genomeSeq.indexOf(seq);
  while (i !== -1) {
    hits.push({
      siteSeq: seq,
      genomeSeq: seq,
      start: i,
      end: i + len - 1,
      strand: "+",
    });
    i = genomeSeq.indexOf(seq, i + 1);
  }

  // hebra -
  let j = genomeSeq.indexOf(rc);
  while (j !== -1) {
    hits.push({
      siteSeq: seq,
      genomeSeq: rc,
      start: j,
      end: j + len - 1,
      strand: "-",
    });
    j = genomeSeq.indexOf(rc, j + 1);
  }

  return hits;
}

// -------------------- Buscar matches con mismatches ----------------

function findFuzzyMatches(genomeSeq, site, max = 2) {
  const seq = site.toUpperCase();
  const rc = revComp(seq);
  const len = seq.length;
  const res = [];

  for (let i = 0; i <= genomeSeq.length - len; i++) {
    const sub = genomeSeq.slice(i, i + len);

    const mmF = mismatches(sub, seq);
    if (mmF > 0 && mmF <= max) {
      res.push({
        siteSeq: seq,
        genomeSeq: sub,
        bars: buildBars(seq, sub),
        start: i,
        end: i + len - 1,
        strand: "+",
      });
    }

    const mmR = mismatches(sub, rc);
    if (mmR > 0 && mmR <= max) {
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

// -------------------- Genes más cercanos a un sitio ----------------

function findNearbyGenes(genes, hit) {
  if (!genes || !genes.length) return [];

  const withDist = genes.map((g) => {
    const d = Math.max(g.start, hit.start) - Math.min(g.end, hit.end);
    return { ...g, _dist: d };
  });

  const min = Math.min(...withDist.map((g) => g._dist));
  return withDist.filter((g) => g._dist === min);
}

// Opciones de TF-type y TF-function
const TF_TYPES = ["monomer", "dimer", "tetramer", "other", "not specified"];
const TF_FUNCS = ["activator", "repressor", "dual", "not specified"];

// ===================================================================
// COMPONENTE PRINCIPAL
// ===================================================================

export default function Step4ReportedSites() {
  const { genomeList, techniques } = useCuration();

  // Estado de acordeones
  const [accordionOpen, setAccordionOpen] = useState({
    step1: true,
    step2: true,
    step3: false,
    step4: true,
  });

  const [fuzzyVisible, setFuzzyVisible] = useState(false); // <== para que no desaparezca el 3er acordeón

  const [siteType, setSiteType] = useState("variable");
  const [rawInput, setRawInput] = useState("");
  const [sites, setSites] = useState([]);

  const [genomeData, setGenomeData] = useState({});
  const [exactMatches, setExactMatches] = useState([]);
  const [fuzzyMatches, setFuzzyMatches] = useState({});
  const [selectedMatch, setSelectedMatch] = useState({});
  const [finalChoice, setFinalChoice] = useState({});

  const [loadingGenomes, setLoadingGenomes] = useState(false);

  // Anotación de cada sitio (acordeón 4)
  // { [site]: { selected:boolean, tfType, tfFunc, useTechniques:boolean } }
  const [siteAnnotations, setSiteAnnotations] = useState({});

  // selects globales (Apply to selected)
  const [bulkTfType, setBulkTfType] = useState("monomer");
  const [bulkTfFunc, setBulkTfFunc] = useState("activator");

  const PROXY = "https://corsproxy.io/?";
  const ENTREZ_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

  // ---------- helpers UI ----------

  function toggleAccordion(stepKey) {
    setAccordionOpen((prev) => ({
      ...prev,
      [stepKey]: !prev[stepKey],
    }));
  }

  const showFuzzy = fuzzyVisible; // ya no depende de selectedMatch

  function techniqueLabel(t) {
    if (!t) return "";
    if (typeof t === "string") return t;
    if (t.name) return t.name;
    if (t.eco) return t.eco;
    return "";
  }

  const techniquesText =
    techniques && techniques.length
      ? techniques.map((t) => techniqueLabel(t)).join(", ")
      : "(no techniques added in Step 3)";

  // ===================================================================
  // Cargar genomas (GenBank full) y parsear anotaciones
  // ===================================================================

  useEffect(() => {
    async function loadGenomes() {
      if (!genomeList || genomeList.length === 0) return;

      setLoadingGenomes(true);
      const store = {};

      for (const g of genomeList) {
        try {
          const url = `${ENTREZ_BASE}/efetch.fcgi?db=nuccore&id=${g.accession}&rettype=gb&retmode=text`;
          const res = await fetch(PROXY + encodeURIComponent(url));
          const txt = await res.text();

          // Secuencia: nos quedamos solo con la parte de ORIGIN
          const originIndex = txt.indexOf("ORIGIN");
          let seq = "";
          if (originIndex !== -1) {
            const originPart = txt.slice(originIndex);
            seq = originPart
              .split("\n")
              .slice(1) // saltar línea "ORIGIN"
              .join("")
              .replace(/[^ATCGatcg]/g, "")
              .toUpperCase();
          }

          const genes = parseGenesFromGenBank(txt);

          store[g.accession] = {
            acc: g.accession,
            sequence: seq,
            genes,
          };
        } catch (err) {
          console.error(err);
        }
      }

      setGenomeData(store);
      setLoadingGenomes(false);
    }

    loadGenomes();
  }, [genomeList]);

  // ===================================================================
  // Procesar sitios y buscar matches exactos
  // ===================================================================

  function handleSaveSites() {
    const seqs = rawInput
      .split(/\r?\n/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    setSites(seqs);

    const all = [];

    seqs.forEach((site) => {
      for (const g of Object.values(genomeData)) {
        const hits = findExactMatches(g.sequence, site);
        hits.forEach((h) => {
          const nearby = findNearbyGenes(g.genes, h);
          all.push({ ...h, genomeAcc: g.acc, nearbyGenes: nearby });
        });
      }
    });

    setExactMatches(all);

    // reset estados por sitio
    const sel = {};
    const annot = {};
    seqs.forEach((s) => {
      sel[s] = null;
      annot[s] = {
        selected: false,
        tfType: "monomer",
        tfFunc: "activator",
        useTechniques: false,
      };
    });

    setSelectedMatch(sel);
    setFinalChoice(sel);
    setSiteAnnotations(annot);
    setFuzzyMatches({});
    setFuzzyVisible(false);
  }

  // ===================================================================
  // Buscar mismatches (cuando se pulsa "No valid match" en exactos)
  // ===================================================================

  function computeFuzzy(site) {
    const all = [];

    for (const g of Object.values(genomeData)) {
      const hits = findFuzzyMatches(g.sequence, site, 2);
      hits.forEach((h) => {
        const nearby = findNearbyGenes(g.genes, h);
        all.push({ ...h, genomeAcc: g.acc, nearbyGenes: nearby });
      });
    }

    setFuzzyMatches((prev) => ({ ...prev, [site]: all }));
    setFuzzyVisible(true); // <- una vez activado, el acordeón 3 ya no desaparece
  }

  // ===================================================================
  // Helpers Site Annotation (acordeón 4)
  // ===================================================================

  function toggleSiteSelected(site) {
    setSiteAnnotations((prev) => ({
      ...prev,
      [site]: { ...prev[site], selected: !prev[site]?.selected },
    }));
  }

  function updateSiteTfType(site, value) {
    setSiteAnnotations((prev) => ({
      ...prev,
      [site]: { ...prev[site], tfType: value },
    }));
  }

  function updateSiteTfFunc(site, value) {
    setSiteAnnotations((prev) => ({
      ...prev,
      [site]: { ...prev[site], tfFunc: value },
    }));
  }

  function updateSiteUseTech(site, value) {
    setSiteAnnotations((prev) => ({
      ...prev,
      [site]: { ...prev[site], useTechniques: value },
    }));
  }

  function selectUnselectAll() {
    const anySelected = sites.some((s) => siteAnnotations[s]?.selected);
    const next = {};
    sites.forEach((s) => {
      next[s] = {
        ...(siteAnnotations[s] || {
          tfType: "monomer",
          tfFunc: "activator",
          useTechniques: false,
        }),
        selected: !anySelected,
      };
    });
    setSiteAnnotations(next);
  }

  function applyTfTypeToSelected() {
    const next = {};
    sites.forEach((s) => {
      const prev = siteAnnotations[s] || {
        selected: false,
        tfType: "monomer",
        tfFunc: "activator",
        useTechniques: false,
      };
      next[s] = {
        ...prev,
        tfType: prev.selected ? bulkTfType : prev.tfType,
      };
    });
    setSiteAnnotations(next);
  }

  function applyTfFuncToSelected() {
    const next = {};
    sites.forEach((s) => {
      const prev = siteAnnotations[s] || {
        selected: false,
        tfType: "monomer",
        tfFunc: "activator",
        useTechniques: false,
      };
      next[s] = {
        ...prev,
        tfFunc: prev.selected ? bulkTfFunc : prev.tfFunc,
      };
    });
    setSiteAnnotations(next);
  }

  function applyTechniquesToSelected() {
    const next = {};
    sites.forEach((s) => {
      const prev = siteAnnotations[s] || {
        selected: false,
        tfType: "monomer",
        tfFunc: "activator",
        useTechniques: false,
      };
      next[s] = {
        ...prev,
        useTechniques: prev.selected ? true : prev.useTechniques,
      };
    });
    setSiteAnnotations(next);
  }

  function clearTechniques() {
    const next = {};
    sites.forEach((s) => {
      const prev = siteAnnotations[s] || {
        selected: false,
        tfType: "monomer",
        tfFunc: "activator",
        useTechniques: false,
      };
      next[s] = { ...prev, useTechniques: false };
    });
    setSiteAnnotations(next);
  }

  // ===================================================================
  // RENDER
  // ===================================================================

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold">Step 4 – Reported sites</h2>

      {/* --------------------------------------------------------------
          1. REPORTED SITES
      -------------------------------------------------------------- */}
      <div className="bg-surface border border-border rounded p-4">
        <button
          className="flex justify-between w-full text-lg font-semibold mb-3"
          onClick={() => toggleAccordion("step1")}
        >
          <span>Reported sites</span>
          <span>{accordionOpen.step1 ? "▲" : "▼"}</span>
        </button>

        {accordionOpen.step1 && (
          <div className="space-y-4 text-sm">
            {/* Site type */}
            <div className="space-y-2">
              <p className="font-medium">Site type</p>

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

            {/* sitios */}
            <textarea
              className="form-control w-full h-40 text-sm"
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              placeholder={"AAGATTACATT\nAAGATAACATT"}
            />

            <button className="btn" onClick={handleSaveSites}>
              {loadingGenomes ? "Loading genomes..." : "Save"}
            </button>
          </div>
        )}
      </div>

      {/* --------------------------------------------------------------
          2. EXACT MATCHES
      -------------------------------------------------------------- */}
      <div className="bg-surface border border-border rounded p-4">
        <button
          className="flex justify-between w-full text-lg font-semibold mb-3"
          onClick={() => toggleAccordion("step2")}
        >
          <span>Exact site matches</span>
          <span>{accordionOpen.step2 ? "▲" : "▼"}</span>
        </button>

        {accordionOpen.step2 && (
          <div className="space-y-4 text-sm">
            {sites.map((site) => {
              const hits = exactMatches.filter((m) => m.siteSeq === site);
              const sel = selectedMatch[site];

              return (
                <div
                  key={site}
                  className="border border-border rounded p-3 space-y-2"
                >
                  <h4 className="font-semibold text-accent">{site}</h4>

                  {hits.map((m, i) => (
                    <label
                      key={i}
                      className="flex items-start gap-2 cursor-pointer"
                    >
                      <input
                        type="radio"
                        name={`match-${site}`}
                        checked={sel === i}
                        onChange={() => {
                          setSelectedMatch((p) => ({ ...p, [site]: i }));
                          setFinalChoice((p) => ({
                            ...p,
                            [site]: { type: "exact", data: m },
                          }));
                          setAccordionOpen((p) => ({ ...p, step4: true }));
                        }}
                      />

                      <div className="font-mono text-xs flex-1 leading-4">
                        {m.siteSeq} {m.strand}[{m.start + 1},{m.end + 1}]{" "}
                        {m.genomeAcc}
                        {m.nearbyGenes?.length > 0 && (
                          <table className="text-xs w-full mt-1">
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
                                  <td className="pr-4">{g.locus_tag || "—"}</td>
                                  <td className="pr-4">
                                    {g.gene_name || "—"}
                                  </td>
                                  <td>{g.function || "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </label>
                  ))}

                  {/* No valid match */}
                  <label className="flex items-center gap-2 text-xs cursor-pointer mt-2">
                    <input
                      type="radio"
                      name={`match-${site}`}
                      checked={sel === "none"}
                      onChange={() => {
                        setSelectedMatch((p) => ({ ...p, [site]: "none" }));
                        setFinalChoice((p) => ({
                          ...p,
                          [site]: { type: "none" },
                        }));
                        computeFuzzy(site);
                        setAccordionOpen((p) => ({ ...p, step3: true }));
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

      {/* --------------------------------------------------------------
          3. INEXACT MATCHES (mismatches)
      -------------------------------------------------------------- */}
      {showFuzzy && (
        <div className="bg-surface border border-border rounded p-4">
          <button
            className="flex justify-between w-full text-lg font-semibold mb-3"
            onClick={() => toggleAccordion("step3")}
          >
            <span>Inexact matches (mismatches)</span>
            <span>{accordionOpen.step3 ? "▲" : "▼"}</span>
          </button>

          {accordionOpen.step3 && (
            <div className="space-y-4 text-sm">
              {sites.map((site) => {
                if (selectedMatch[site] !== "none" && !fuzzyMatches[site])
                  return null;

                const arr = fuzzyMatches[site] || [];
                const sel = selectedMatch[site];

                return (
                  <div
                    key={site}
                    className="border border-border rounded p-3 space-y-2"
                  >
                    <h4 className="font-semibold text-accent">{site}</h4>

                    {arr.map((m, i) => (
                      <label
                        key={i}
                        className="flex items-start gap-2 cursor-pointer"
                      >
                        <input
                          type="radio"
                          name={`fuzzy-${site}`}
                          checked={sel === `fz-${i}`}
                          onChange={() => {
                            setSelectedMatch((p) => ({
                              ...p,
                              [site]: `fz-${i}`,
                            }));
                            setFinalChoice((p) => ({
                              ...p,
                              [site]: { type: "fuzzy", data: m },
                            }));
                            setAccordionOpen((p) => ({ ...p, step4: true }));
                          }}
                        />

                        <div className="font-mono text-xs flex-1 leading-4 whitespace-pre">
                          {m.siteSeq}
                          {"\n"}
                          {m.bars}
                          {"\n"}
                          {m.genomeSeq} {m.strand}[{m.start + 1},{m.end + 1}]{" "}
                          {m.genomeAcc}
                          {m.nearbyGenes?.length > 0 && (
                            <table className="text-xs w-full mt-1">
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
                                    <td className="pr-4">
                                      {g.locus_tag || "—"}
                                    </td>
                                    <td className="pr-4">
                                      {g.gene_name || "—"}
                                    </td>
                                    <td>{g.function || "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </label>
                    ))}

                    {/* No valid match en mismatches */}
                    <label className="flex items-center gap-2 text-xs cursor-pointer mt-2">
                      <input
                        type="radio"
                        name={`fuzzy-${site}`}
                        checked={sel === "fz-none"}
                        onChange={() => {
                          setSelectedMatch((p) => ({
                            ...p,
                            [site]: "fz-none",
                          }));
                          setFinalChoice((p) => ({
                            ...p,
                            [site]: { type: "none" },
                          }));
                          setAccordionOpen((p) => ({ ...p, step4: true }));
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

      {/* --------------------------------------------------------------
          4. SITE ANNOTATION (tabla tipo CollecTF)
      -------------------------------------------------------------- */}
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

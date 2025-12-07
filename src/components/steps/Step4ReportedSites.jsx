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

// ------------ Parser muy simple de GenBank para sacar genes --------

function parseGenesFromGenBank(txt) {
  const genes = [];
  const lines = txt.split("\n");
  let current = null;

  for (const raw of lines) {
    const line = raw.trim();

    // línea tipo: "gene            190..255"
    if (line.startsWith("gene            ")) {
      const coords = line.replace("gene", "").trim();
      const [startStr, endStr] = coords.split("..");
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);

      current = {
        start,
        end,
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
      // si hay varias /product se quedará con la última, suficiente para ahora
      current.function = line.split("=")[1].replace(/"/g, "");
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

// ===================================================================
// COMPONENTE PRINCIPAL
// ===================================================================

export default function Step4ReportedSites() {
  const { genomeList } = useCuration();

  // Estado de acordeones (desplegables)
  const [accordionOpen, setAccordionOpen] = useState({
    step1: true,
    step2: true,
    step3: false,
    step4: true,
  });

  const [siteType, setSiteType] = useState("variable");
  const [rawInput, setRawInput] = useState("");
  const [sites, setSites] = useState([]);

  const [genomeData, setGenomeData] = useState({});
  const [exactMatches, setExactMatches] = useState([]);
  const [fuzzyMatches, setFuzzyMatches] = useState({});
  const [selectedMatch, setSelectedMatch] = useState({});
  const [finalChoice, setFinalChoice] = useState({});

  const [loadingGenomes, setLoadingGenomes] = useState(false);

  const PROXY = "https://corsproxy.io/?";
  const ENTREZ_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

  // ---------- helpers UI ----------

  function toggleAccordion(stepKey) {
    setAccordionOpen((prev) => ({
      ...prev,
      [stepKey]: !prev[stepKey],
    }));
  }

  const showFuzzy = Object.values(selectedMatch).some((v) => v === "none");

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

          const seq = txt
            .split("\n")
            .filter((l) => !l.startsWith("LOCUS") && !l.startsWith("ORIGIN"))
            .join("")
            .replace(/[^ATCGatcg]/g, "")
            .toUpperCase();

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

    const sel = {};
    seqs.forEach((s) => (sel[s] = null));
    setSelectedMatch(sel);
    setFinalChoice(sel);
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
  }

  // ===================================================================
  // RENDER
  // ===================================================================

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold">Step 4 – Reported sites</h2>

      {/* --------------------------------------------------------------
          1. REPORTED SITES (ACORDEÓN)
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

            {/* textarea de sitios */}
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
          2. EXACT MATCHES (ACORDEÓN)
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
                          // si se selecciona un exacto, podemos mostrar el acordeón 4
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
          3. INEXACT MATCHES (solo si hay algún "none")
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
                if (selectedMatch[site] !== "none") return null;

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
          4. SITE ANNOTATION (ACORDEÓN)
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
          <div className="space-y-3 text-sm">
            {sites.map((site) => {
              const sel = finalChoice[site];

              if (!sel || sel.type === "none") {
                // solo secuencia reportada
                return (
                  <p key={site} className="font-mono text-xs">
                    {site}
                  </p>
                );
              }

              if (sel.type === "exact") {
                const m = sel.data;
                return (
                  <div key={site} className="font-mono text-xs leading-4">
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
                  <div
                    key={site}
                    className="font-mono text-xs leading-4 whitespace-pre"
                  >
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
        )}
      </div>
    </div>
  );
}

import React, { useState, useEffect } from "react";
import { useCuration } from "../../context/CurationContext";
import genbankParser from "genbank-parser";

// Igual que en otros steps
const PROXY = "https://corsproxy.io/?";
const ENTREZ_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

// ------------------------------------------------------------
// Reverse complement
// ------------------------------------------------------------
function revComp(seq) {
  const map = { A: "T", T: "A", C: "G", G: "C" };
  return seq
    .toUpperCase()
    .split("")
    .reverse()
    .map((n) => map[n] || "N")
    .join("");
}

// ------------------------------------------------------------
// Buscar matches exactos (ambas hebras)
// ------------------------------------------------------------
function findMatchesInSequence(genomeSeq, reportedSeq) {
  const seq = reportedSeq.toUpperCase();
  const rev = revComp(seq);
  const len = seq.length;

  const matches = [];

  // Hebra +
  let i = genomeSeq.indexOf(seq);
  while (i !== -1) {
    matches.push({
      reportedSeq: seq,      // lo que ha escrito el usuario
      genomeSeq: seq,        // lo que hay en el genoma
      start: i,
      end: i + len - 1,
      strand: "+",
    });
    i = genomeSeq.indexOf(seq, i + 1);
  }

  // Hebra -
  let j = genomeSeq.indexOf(rev);
  while (j !== -1) {
    matches.push({
      reportedSeq: seq,      // lo que ha escrito el usuario
      genomeSeq: rev,        // lo que hay en el genoma (complementario)
      start: j,
      end: j + len - 1,
      strand: "-",
    });
    j = genomeSeq.indexOf(rev, j + 1);
  }

  return matches;
}

// Distancia entre un gen y un sitio (0 = solapado / muy cerca)
function geneSiteDistance(gene, site) {
  return Math.max(gene.start, site.start) - Math.min(gene.end, site.end);
}

// Genes “cercanos”: de momento cogemos el/los más cercanos
function findNearbyGenes(genes, match) {
  if (!genes || genes.length === 0) return [];

  const withDist = genes.map((g) => ({
    ...g,
    _dist: geneSiteDistance(g, match),
  }));

  let min = withDist[0]._dist;
  for (const g of withDist) {
    if (g._dist < min) min = g._dist;
  }

  return withDist.filter((g) => g._dist === min);
}

// ------------------------------------------------------------
// Descargar GenBank y FASTA desde NCBI (vía eutils + corsproxy)
// ------------------------------------------------------------

async function fetchGenbankFeatures(accession) {
  const url = `${ENTREZ_BASE}/efetch.fcgi?db=nuccore&id=${accession}&rettype=gb&retmode=text`;
  const res = await fetch(PROXY + encodeURIComponent(url));
  if (!res.ok) {
    console.warn("Features fetch failed for", accession, res.status);
    return "";
  }
  return await res.text();
}

async function fetchFastaSequence(accession) {
  const url = `${ENTREZ_BASE}/efetch.fcgi?db=nuccore&id=${accession}&rettype=fasta&retmode=text`;
  const res = await fetch(PROXY + encodeURIComponent(url));
  if (!res.ok) {
    console.warn("FASTA fetch failed for", accession, res.status);
    return "";
  }
  return await res.text();
}

// --------------------------
// Parseo de GenBank → genes
// --------------------------
function parseGenbankFeatures(text) {
  try {
    const parsed = genbankParser(text);
    if (!parsed || !parsed.length) return [];

    const record = parsed[0];

    return (record.features || [])
      .filter((f) => f.type === "gene" || f.type === "CDS")
      .map((f) => {
        const notes = f.notes || {};

        const locus_tag = notes.locus_tag ? notes.locus_tag[0] : "";
        const geneName = notes.gene ? notes.gene[0] : f.name || "";
        const product = notes.product ? notes.product[0] : "";

        const start = (f.start || 1) - 1; // a 0-based
        const end = (f.end || 1) - 1;

        return {
          locus_tag,
          gene: geneName,
          product,
          start,
          end,
          strand: f.strand || 1,
        };
      })
      .sort((a, b) => a.start - b.start);
  } catch (e) {
    console.error("GenBank parsing failed:", e);
    return [];
  }
}

// ------------------------------------------------------------
// Helper para pintar alineación simple
// ------------------------------------------------------------
function Alignment({ reportedSeq, genomeSeq, strand, start, end, genomeAcc }) {
  const len = reportedSeq.length;
  const bars = new Array(len).fill("|").join("");

  return (
    <p className="sequence font-mono text-xs">
      {reportedSeq}
      <br />
      {bars}
      <br />
      {genomeSeq}{" "}
      {strand === "+" ? "+" : "-"}[{start + 1}, {end + 1}] {genomeAcc}
    </p>
  );
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================
export default function Step4ReportedSites() {
  const { genomeList } = useCuration();

  // Acordeones
  const [accordionOpen, setAccordionOpen] = useState({
    step1: true,
    step2: false,
    step3: false,
    step4: false,
  });

  // Step 1
  const [siteType, setSiteType] = useState("motif");
  const [rawInput, setRawInput] = useState("");
  const [sites, setSites] = useState([]); // lista de secuencias (strings)

  // Genomas cargados: { accession: { sequence, genes[] } }
  const [loadedGenomes, setLoadedGenomes] = useState({});

  // Matches exactos
  const [matches, setMatches] = useState([]); // [{ siteSeq, genomeAcc, start, end, strand, nearbyGenes[] }]

  // Selección de match por sitio: { siteSeq: index | "none" }
  const [selectedMatch, setSelectedMatch] = useState({});

  const [loadingGenomes, setLoadingGenomes] = useState(false);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // ------------------------------------------------------------
  // Cargar GenBank + FASTA de los genomas seleccionados en Step2
  // ------------------------------------------------------------
  useEffect(() => {
    async function loadGenomes() {
      if (!genomeList || genomeList.length === 0) return;

      setLoadingGenomes(true);
      setErrorMsg("");
      const store = {};

      for (const g of genomeList) {
        const acc = g.accession;
        if (!acc) continue;

        try {
          const [gbText, fasta] = await Promise.all([
            fetchGenbankFeatures(acc),
            fetchFastaSequence(acc),
          ]);

          // Extraer secuencia de FASTA
          let sequence = "";
          if (fasta) {
            sequence = fasta
              .split("\n")
              .filter((l) => !l.startsWith(">"))
              .join("")
              .replace(/\s+/g, "")
              .toUpperCase();
          }

          // Extraer genes del GenBank
          const genes = parseGenbankFeatures(gbText);

          store[acc] = { sequence, genes };
        } catch (e) {
          console.error("Error loading genome", acc, e);
          setErrorMsg(
            "Error loading genome information from NCBI. You can try reloading the page."
          );
        }
      }

      setLoadedGenomes(store);
      setLoadingGenomes(false);
      console.log("Loaded genomes:", store);
    }

    loadGenomes();
  }, [genomeList]);

  // ------------------------------------------------------------
  // Step 1 → parsear sitios y lanzar búsqueda
  // ------------------------------------------------------------
  function handleParseAndSearch() {
    setErrorMsg("");

    const seqs = rawInput
      .split(/\r?\n/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0);

    if (seqs.length === 0) {
      setErrorMsg("Please enter at least one site sequence.");
      return;
    }

    if (!Object.keys(loadedGenomes).length) {
      setErrorMsg(
        "Genomes are not loaded yet from NCBI. Please wait a few seconds and try again."
      );
      return;
    }

    setSites(seqs);
    runExactMatchSearch(seqs);

    // Abrimos acordeón 2 automáticamente
    setAccordionOpen((prev) => ({
      ...prev,
      step2: true,
    }));
  }

  // ------------------------------------------------------------
  // Step 2 → búsqueda de exact matches
  // ------------------------------------------------------------
  function runExactMatchSearch(seqs) {
    setLoadingMatches(true);
    const allMatches = [];

    for (const siteSeq of seqs) {
      for (const [acc, data] of Object.entries(loadedGenomes)) {
        const genomeSeq = data.sequence;
        const genes = data.genes;

        const hits = findMatchesInSequence(genomeSeq, siteSeq);

        hits.forEach((hit) => {
          const nearbyGenes = findNearbyGenes(genes, hit);
          allMatches.push({
            ...hit,
            siteSeq,
            genomeAcc: acc,
            nearbyGenes,
          });
        });
      }
    }

    setMatches(allMatches);

    // Inicializamos selección: por defecto "none"
    const initialSelection = {};
    seqs.forEach((s) => {
      initialSelection[s] = "none";
    });
    setSelectedMatch(initialSelection);

    setLoadingMatches(false);
  }

  // Agrupamos matches por sitio (para mostrar parecido al pipeline original)
  const matchesBySite = sites.map((s) => ({
    site: s,
    matches: matches.filter((m) => m.siteSeq === s),
  }));

  // ------------------------------------------------------------
  // Seleccionar match o "no valid match"
  // ------------------------------------------------------------
  function handleSelectMatch(siteSeq, index) {
    setSelectedMatch((prev) => ({
      ...prev,
      [siteSeq]: index,
    }));
  }

  // ------------------------------------------------------------
  // UI helpers
  // ------------------------------------------------------------
  function toggleAccordion(step) {
    setAccordionOpen((prev) => ({
      ...prev,
      [step]: !prev[step],
    }));
  }

  // ------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------
  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold">Step 4 – Reported sites</h2>

      {errorMsg && <p className="text-sm text-red-400">{errorMsg}</p>}

      {/* ---------------------------------------------------------
          1. Enter reported sites
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
          <div className="space-y-4 text-sm">
            {/* SITE TYPE */}
            <div>
              <label className="block font-medium mb-1">Site type</label>

              <div className="space-y-1">
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
            </div>

            {/* SITES */}
            <div>
              <label className="block font-medium mb-1">Sites</label>
              <textarea
                className="form-control w-full h-40"
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
                placeholder={"AAGATTACATT\nAAGATAACATT"}
              />
            </div>

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

      {/* ---------------------------------------------------------
          2. Exact site matches
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
            {loadingMatches && <p>Searching matches...</p>}

            {!loadingMatches && matches.length === 0 && (
              <p className="text-muted">No matches found.</p>
            )}

            {!loadingMatches &&
              matchesBySite.map(({ site, matches }) => {
                const selected = selectedMatch[site];

                return (
                  <div
                    key={site}
                    className="border border-border rounded bg-muted p-3 space-y-2"
                  >
                    <h4 className="font-semibold text-accent">{site}</h4>

                    {matches.length === 0 ? (
                      <p className="text-xs text-muted">
                        No valid match for this site.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {matches.map((m, i) => (
                          <label
                            key={`${site}-${i}`}
                            className="flex items-start gap-2 cursor-pointer"
                          >
                            <input
                              type="radio"
                              name={`match-${site}`}
                              checked={selected === i}
                              onChange={() => handleSelectMatch(site, i)}
                            />
                            <div className="mt-0.5 flex-1 space-y-1">
                              {/* Alineación: reported vs genoma */}
                              <Alignment
                                reportedSeq={m.reportedSeq}
                                genomeSeq={m.genomeSeq}
                                strand={m.strand}
                                start={m.start}
                                end={m.end}
                                genomeAcc={m.genomeAcc}
                              />

                              {/* Tabla de genes cercanos */}
                              {m.nearbyGenes && m.nearbyGenes.length > 0 && (
                                <div className="mt-2 overflow-x-auto">
                                  <table className="text-xs w-full border-collapse">
                                    <thead>
                                      <tr className="border-b border-border">
                                        <th className="text-left pr-4">
                                          locus tag
                                        </th>
                                        <th className="text-left pr-4">
                                          gene name
                                        </th>
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
                                            {g.gene || "—"}
                                          </td>
                                          <td>{g.product || "—"}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          </label>
                        ))}

                        {/* Opción: No valid match */}
                        <label className="flex items-center gap-2 mt-2 cursor-pointer">
                          <input
                            type="radio"
                            name={`match-${site}`}
                            checked={selected === "none"}
                            onChange={() => handleSelectMatch(site, "none")}
                          />
                          <span className="text-xs">No valid match.</span>
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------
          3 y 4: placeholders (inexact / annotate)
      ---------------------------------------------------------- */}
      <div className="bg-surface border border-border rounded p-4 opacity-40">
        <button
          className="flex justify-between w-full text-lg font-semibold mb-3"
          onClick={() => toggleAccordion("step3")}
        >
          <span>3. Inexact matches (mismatches)</span>
          <span>{accordionOpen.step3 ? "▲" : "▼"}</span>
        </button>
        {accordionOpen.step3 && (
          <p className="text-sm text-muted">Not implemented yet.</p>
        )}
      </div>

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

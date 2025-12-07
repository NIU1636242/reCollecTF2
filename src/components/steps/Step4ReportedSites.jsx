import React, { useEffect, useState } from "react";
import { useCuration } from "../../context/CurationContext";
import JSZip from "jszip";

// Proxy para evitar problemas de CORS
const PROXY = "https://corsproxy.io/?";
const DATASETS_BASE =
  "https://api.ncbi.nlm.nih.gov/datasets/v2/genome/accession";

// ------------------------------------------------------------
// Utilidad: reverse complement
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
// Buscar coincidencias exactas en un genoma (ambas hebras)
// genomeSeq: string con la secuencia del genoma
// reportedSeq: secuencia reportada por el usuario
// ------------------------------------------------------------
function findExactMatchesInGenome(genomeSeq, reportedSeq) {
  const seq = reportedSeq.toUpperCase();
  const rev = revComp(seq);
  const len = seq.length;

  const results = [];

  // Hebra +
  let i = genomeSeq.indexOf(seq);
  while (i !== -1) {
    results.push({
      reportedSeq,
      matchedSeq: seq,
      start: i,
      end: i + len - 1,
      strand: "+",
    });
    i = genomeSeq.indexOf(seq, i + 1);
  }

  // Hebra –
  let j = genomeSeq.indexOf(rev);
  while (j !== -1) {
    results.push({
      reportedSeq,
      matchedSeq: rev,
      start: j,
      end: j + len - 1,
      strand: "-",
    });
    j = genomeSeq.indexOf(rev, j + 1);
  }

  return results;
}

// ------------------------------------------------------------
// Distancia gen ↔ match (mismo criterio que en el código Python)
// ------------------------------------------------------------
function distanceGeneMatch(g, m) {
  return Math.max(g.start, m.start) - Math.min(g.end, m.end);
}

// ------------------------------------------------------------
// A partir de un match y la lista de genes, calcula genes cercanos
// windowBp ~150 por defecto
// ------------------------------------------------------------
function findNearbyGenes(match, genes, windowBp = 150) {
  if (!genes || genes.length === 0) return [];

  // Genes cuyo intervalo solapa o está dentro de la ventana +/- windowBp
  const nearby = genes.filter((g) => {
    const d = distanceGeneMatch(g, match);
    return d <= windowBp; // d<0 solapa, 0..window=vecino
  });

  if (nearby.length > 0) {
    return nearby.sort((a, b) => a.start - b.start);
  }

  // Si no hay ninguno en ventana, devolvemos el más cercano en absoluto
  let best = genes[0];
  let bestDist = Math.abs(distanceGeneMatch(best, match));
  for (let i = 1; i < genes.length; i++) {
    const d = Math.abs(distanceGeneMatch(genes[i], match));
    if (d < bestDist) {
      best = genes[i];
      bestDist = d;
    }
  }
  return [best];
}

// ------------------------------------------------------------
// Parse FASTA: devuelve solo la secuencia concatenada
// ------------------------------------------------------------
function parseFastaSequence(text) {
  return text
    .split("\n")
    .filter((l) => l && !l.startsWith(">"))
    .join("")
    .replace(/\s+/g, "")
    .toUpperCase();
}

// ------------------------------------------------------------
// Parse básico de GFF3: extrae genes con locus_tag, gene, product
// ------------------------------------------------------------
function parseGFF(text) {
  return text
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((line) => {
      const cols = line.split("\t");
      if (cols.length < 9) return null;

      const [seqid, source, type, start, end, score, strand] = cols;
      const attrField = cols[8];

      // solo nos quedamos con features de tipo "gene" o "CDS"
      if (type !== "gene" && type !== "CDS") return null;

      const attrs = {};
      attrField.split(";").forEach((p) => {
        const [k, v] = p.split("=");
        if (k && v) attrs[k] = decodeURIComponent(v);
      });

      return {
        seqid,
        start: Number(start) - 1, // GFF usa 1-based, lo pasamos a 0-based
        end: Number(end) - 1,
        strand: strand === "-" ? -1 : 1,
        locus_tag: attrs["locus_tag"] || "",
        name: attrs["gene"] || "",
        product: attrs["product"] || "",
      };
    })
    .filter(Boolean);
}

// ------------------------------------------------------------
// Descarga ZIP de NCBI Datasets, extrae FASTA y GFF
// ------------------------------------------------------------
async function fetchGenome(accession) {
  try {
    // 1. FASTA
    const fastaRes = await fetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=${accession}&rettype=fasta&retmode=text`
    );

    const fastaText = await fastaRes.text();
    const seq = fastaText
      .split("\n")
      .filter((l) => !l.startsWith(">"))
      .join("")
      .toUpperCase();

    // 2. GFF/annotation JSON
    const annRes = await fetch(
      `https://api.ncbi.nlm.nih.gov/datasets/v1/genome/accession/${accession}/gff`
    );
    const json = await annRes.json();

    const genes = [];

    json?.annotations?.forEach((ann) => {
      ann?.genes?.forEach((g) => {
        genes.push({
          start: g.start - 1,
          end: g.end - 1,
          strand: g.strand === "-" ? -1 : 1,
          locus_tag: g.locus_tag || "",
          name: g.gene_name || "",
          product: g.product_name || "",
        });
      });
    });

    return { seq, genes };

  } catch (err) {
    console.error("Error loading genome", accession, err);
    return null;
  }
}


// ------------------------------------------------------------
// COMPONENTE PRINCIPAL
// ------------------------------------------------------------
export default function Step4ReportedSites() {
  const { genomeList } = useCuration();

  const [accordionOpen, setAccordionOpen] = useState({
    step1: true,
    step2: false,
    step3: false,
    step4: false,
  });

  const [siteType, setSiteType] = useState("motif");
  const [rawInput, setRawInput] = useState("");
  const [sites, setSites] = useState([]);

  // { accession: { seq: string, genes: [...] } }
  const [loadedGenomes, setLoadedGenomes] = useState({});
  const [matches, setMatches] = useState([]);

  // ------------------------------------------------------------
  // Cargar genomas (FASTA + GFF) cuando haya genomeList
  // ------------------------------------------------------------
useEffect(() => {
  async function loadGenomes() {
    if (!genomeList?.length) return;

    const result = {};

    for (const g of genomeList) {
      const acc = g.accession;
      const data = await fetchGenome(acc);
      if (data && data.seq) result[acc] = data;
    }

    setLoadedGenomes(result);
    console.log("Loaded genomes:", result);
  }

  loadGenomes();
}, [genomeList]);


  // ------------------------------------------------------------
  // Al pulsar Save en el acordeón 1
  // ------------------------------------------------------------
  function handleParse() {
    const seqs = rawInput
      .split(/\r?\n/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0);

    setSites(seqs);

    // Lanzamos búsqueda de matches exactos
    runExactMatchSearch(seqs);

    // Abrimos acordeón 2
    setAccordionOpen((prev) => ({
      ...prev,
      step2: true,
    }));
  }

  // ------------------------------------------------------------
  // Búsqueda de matches exactos en todos los genomas cargados
  // ------------------------------------------------------------
  function runExactMatchSearch(seqs) {
    if (!seqs.length) return;

    const genomeEntries = Object.entries(loadedGenomes);
    if (!genomeEntries.length) {
      console.log("No genomes loaded yet");
      setMatches([]);
      return;
    }

    const all = [];

    for (const reportedSeq of seqs) {
      for (const [acc, genome] of genomeEntries) {
        const { seq, genes } = genome;
        if (!seq) continue;

        const hits = findExactMatchesInGenome(seq, reportedSeq);

        hits.forEach((hit) => {
          const nearby = findNearbyGenes(hit, genes);
          all.push({
            ...hit,
            accession: acc,
            nearbyGenes: nearby,
          });
        });
      }
    }

    setMatches(all);
  }

  // ------------------------------------------------------------
  // Helpers UI
  // ------------------------------------------------------------
  function toggleAccordion(step) {
    setAccordionOpen((prev) => ({
      ...prev,
      [step]: !prev[step],
    }));
  }

  // Agrupar matches por secuencia reportada
  const matchesBySite = sites.map((s) => ({
    site: s,
    hits: matches.filter((m) => m.reportedSeq === s),
  }));

  // ------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------
  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold">Step 4 – Reported sites</h2>

      {/* ---------------------------------------------------------
          ACCORDION 1
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
          <div className="space-y-4">
            {/* SITE TYPE */}
            <div>
              <label className="block font-medium mb-1">Site type</label>
              <div className="space-y-1 text-sm">
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

            {/* SITES INPUT */}
            <div>
              <label className="block font-medium mb-1">Sites</label>
              <textarea
                className="form-control w-full h-40"
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
                placeholder={"AAGATTACATT\nAAGATAACATT"}
              />
            </div>

            <button className="btn" onClick={handleParse}>
              Save
            </button>
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------
          ACCORDION 2 – Exact matches
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
            {Object.keys(loadedGenomes).length === 0 && (
              <p className="text-muted">
                No genomes loaded yet. Make sure Step 2 includes at least one
                NCBI genome accession (e.g. NC_000913.3).
              </p>
            )}

            {sites.length === 0 && (
              <p className="text-muted">
                Enter one or more sites in the first panel and click Save.
              </p>
            )}

            {sites.length > 0 &&
              matchesBySite.map(({ site, hits }) => (
                <div
                  key={site}
                  className="border border-border rounded p-3 bg-muted"
                >
                  <p className="font-semibold mb-2">{site}</p>

                  {hits.length === 0 ? (
                    <p className="text-muted">No matches found.</p>
                  ) : (
                    hits.map((m, idx) => (
                      <div
                        key={`${m.accession}-${m.start}-${m.strand}-${idx}`}
                        className="mb-3 border-t border-border pt-2 first:border-t-0 first:pt-0"
                      >
                        <p className="mb-1">
                          <span className="font-mono">{m.matchedSeq}</span>{" "}
                          <br />
                          [{m.start + 1} – {m.end + 1}] ({m.strand}){" "}
                          <span className="font-mono">{m.accession}</span>
                        </p>

                        {m.nearbyGenes && m.nearbyGenes.length > 0 && (
                          <table className="w-full text-xs mt-1">
                            <thead>
                              <tr className="text-left">
                                <th className="pr-2">locus tag</th>
                                <th className="pr-2">gene name</th>
                                <th>function</th>
                              </tr>
                            </thead>
                            <tbody>
                              {m.nearbyGenes.map((g, gi) => (
                                <tr key={gi}>
                                  <td className="pr-2 font-mono">
                                    {g.locus_tag || "—"}
                                  </td>
                                  <td className="pr-2">
                                    {g.name || "—"}
                                  </td>
                                  <td>{g.product || "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    ))
                  )}
                </div>
              ))}

            {sites.length > 0 && matches.length === 0 && (
              <p className="text-muted">No matches found for any site.</p>
            )}
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------
          ACCORDION 3 – placeholder
      ---------------------------------------------------------- */}
      <div className="bg-surface border border-border rounded p-4 opacity-50">
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

      {/* ---------------------------------------------------------
          ACCORDION 4 – placeholder
      ---------------------------------------------------------- */}
      <div className="bg-surface border border-border rounded p-4 opacity-50">
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

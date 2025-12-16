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
  const {
    genomeList,
    techniques,
    goToNextStep,
    // NUEVO: estado persistente para step4
    step4State,
    setStep4State,
  } = useCuration();

  // Accordions open/closed
  const [accordion, setAccordion] = useState({
    a1: true,
    a2: true,
    a3: false,
    a4: true, // lo dejamos aunque ya no se renderiza aquí, para no “cambiar nada” de la lógica
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

  // =======================================================
  // RESTORE STATE when going back from step5 -> step4
  // (igual idea que en Step1)
  // =======================================================

  useEffect(() => {
    if (!step4State) return;

    if (step4State.accordion) setAccordion(step4State.accordion);
    if (step4State.siteType) setSiteType(step4State.siteType);
    if (typeof step4State.rawSites === "string") setRawSites(step4State.rawSites);

    if (Array.isArray(step4State.sites)) setSites(step4State.sites);
    if (step4State.exactHits) setExactHits(step4State.exactHits);
    if (step4State.fuzzyHits) setFuzzyHits(step4State.fuzzyHits);
    if (step4State.choice) setChoice(step4State.choice);
    if (typeof step4State.showFuzzy === "boolean") setShowFuzzy(step4State.showFuzzy);
  }, [step4State]);

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

          // --- MERGE gene + CDS POR locus_tag, PREFIRIENDO FUNCTION DE CDS ---
          const locusMap = new Map();

          for (const f of features) {
            if (f.type !== "gene" && f.type !== "CDS") continue;

            const locus = f.notes?.locus_tag?.[0] || "";
            if (!locus) continue;

            const geneName = f.notes?.gene?.[0] || "";
            const func =
              f.notes?.function?.[0] || f.notes?.product?.[0] || "";
            const start = f.start;
            const end = f.end;

            if (!locusMap.has(locus)) {
              locusMap.set(locus, {
                locus,
                gene: geneName,
                function: func,
                start,
                end,
                hasCDS: f.type === "CDS",
              });
            } else {
              const existing = locusMap.get(locus);
              existing.start = Math.min(existing.start, start);
              existing.end = Math.max(existing.end, end);

              if (!existing.gene && geneName) {
                existing.gene = geneName;
              }

              // Si esta feature es CDS y trae función, la usamos
              if (f.type === "CDS" && func) {
                existing.function = func;
                existing.hasCDS = true;
              } else if (!existing.function && func) {
                // Si aún no teníamos ninguna función, cogemos la que haya
                existing.function = func;
              }
            }
          }

          const genes = Array.from(locusMap.values()).sort(
            (a, b) => a.start - b.start
          );

          out.push({
            acc: g.accession,
            sequence: seq,
            genes,
          });
        } catch (err) {
          console.error("Error loading genome:", err);
        }
      }

      setGenomes(out);
    }

    load();
  }, [genomeList]);

  // =======================================================
  // GIVEN A HIT, FIND NEARBY GENES (CADENA ±150 nt ENTRE GENES)
  // =======================================================

  function findGenesForHit(acc, hitStart, hitEnd) {
    const genome = genomes.find((g) => g.acc === acc);
    if (!genome || !genome.genes || genome.genes.length === 0) return [];

    const genes = genome.genes; // ya vienen ordenados por start

    // Distancia de un gen al sitio (0 si se solapan)
    const distToSite = (gene) => {
      if (hitEnd < gene.start) return gene.start - hitEnd;
      if (hitStart > gene.end) return hitStart - gene.end;
      return 0;
    };

    // 1) gen más cercano al sitio
    let bestIdx = -1;
    let bestDist = Infinity;
    genes.forEach((g, idx) => {
      const d = distToSite(g);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = idx;
      }
    });

    // si el más cercano está a >150 nt, no devolvemos nada
    if (bestIdx === -1 || bestDist > 150) return [];

    const result = [];
    const pushUnique = (g) => {
      if (!result.some((r) => r.locus === g.locus)) {
        result.push({
          locus: g.locus || "",
          gene: g.gene || "",
          function: g.function || "",
        });
      }
    };

    // 2) añadimos el más cercano
    pushUnique(genes[bestIdx]);

    // 3) expandimos hacia la izquierda mientras la distancia entre genes vecinos <=150
    let i = bestIdx - 1;
    while (i >= 0) {
      const current = genes[i];
      const next = genes[i + 1];
      const gap = next.start - current.end; // si negativo, solapados

      if (gap > 150) break;
      pushUnique(current);
      i--;
    }

    // 4) expandimos hacia la derecha
    i = bestIdx + 1;
    while (i < genes.length) {
      const prev = genes[i - 1];
      const current = genes[i];
      const gap = current.start - prev.end;

      if (gap > 150) break;
      pushUnique(current);
      i++;
    }

    return result;
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
  // CONFIRM (guardar estado + ir a Step5)
  // =======================================================

  const handleConfirm = () => {
    setStep4State({
      accordion,
      siteType,
      rawSites,
      sites,
      genomesLoaded: genomes.length > 0, // info opcional
      exactHits,
      fuzzyHits,
      choice,
      showFuzzy,
    });
    goToNextStep();
  };

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
            {/* Site type */}
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
                                  <th className="pr-4 text-left">gene name</th>
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
                                    <th className="pr-4 text-left">gene name</th>
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
          BOTÓN FINAL — CONFIRM AND CONTINUE
      ======================================================= */}
      <div className="pt-2">
        <button className="btn" onClick={handleConfirm}>
          Confirm and continue →
        </button>
      </div>
    </div>
  );
}

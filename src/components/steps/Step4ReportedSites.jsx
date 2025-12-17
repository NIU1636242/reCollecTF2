import React, { useState, useEffect, useMemo } from "react";
import { useCuration } from "../../context/CurationContext";
import genbankParser from "genbank-parser";

function revComp(seq) { //Obtenir cadena complementària 
  const map = { A: "T", T: "A", C: "G", G: "C" };
  return seq
    .split("")
    .reverse()
    .map((c) => map[c] || "N")
    .join("");
}

function mismatches(a, b) { //1 o 2 mismatches
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

function buildBars(a, b) { //Genera |
  return a
    .split("")
    .map((c, i) => (c === b[i] ? "|" : " "))
    .join("");
}

// MAIN COMPONENT
export default function Step4ReportedSites() {
  const {
    genomeList,
    // estado compartido para persistencia
    step4Data,
    setStep4Data,
    goToNextStep,
  } = useCuration();

  const { genomes, setGenomes } = useCuration(); //info del genoma

  // Accordions open/closed
  const [accordion, setAccordion] = useState({
    a1: true,
    a2: true,
    a3: false,
  });

  const toggleAcc = (k) => //abrir o cerrar acordeones
    setAccordion((p) => ({
      ...p,
      [k]: !p[k],
    }));

  const [siteType, setSiteType] = useState("variable"); //tipus de site
  const [rawSites, setRawSites] = useState(""); //text introduït
  const [sites, setSites] = useState([]); //llista de secuencies
  const [exactHits, setExactHits] = useState({});
  const [fuzzyHits, setFuzzyHits] = useState({});
  const [choice, setChoice] = useState({}); //guarda hit escollit per l'usuari
  const [showFuzzy, setShowFuzzy] = useState(false); //Mostrar acordeón de mismatches

  // NUEVO: selector de sites
  const [activeSite, setActiveSite] = useState(null);

  // ============================
  // RESTORE STATE WHEN COMING BACK
  // ============================
  useEffect(() => {
    if (!step4Data) return;

    setSiteType(step4Data.siteType || "variable");
    setRawSites(step4Data.rawSites || "");
    setSites(step4Data.sites || []);
    setExactHits(step4Data.exactHits || {});
    setFuzzyHits(step4Data.fuzzyHits || {});
    setChoice(step4Data.choice || {});
    setShowFuzzy(step4Data.showFuzzy || false);

    // mostrar solo uno: si hay activeSite guardado úsalo, si no el primero
    const restoredSites = step4Data.sites || [];
    setActiveSite(step4Data.activeSite || restoredSites[0] || null);
  }, []);

  // Si cambia sites (por Save), por defecto selecciona el primero
  useEffect(() => {
    if (!sites?.length) {
      setActiveSite(null);
      return;
    }
    setActiveSite((prev) => (prev && sites.includes(prev) ? prev : sites[0]));
  }, [sites]);

  // LOAD GENOMES (FASTA + GENBANK PARSED WITH genbank-parser)
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

          const parsed = genbankParser(gbText); //parse genBank
          const entry = parsed?.[0];
          const features = entry?.features || [];

          const locusMap = new Map();

          for (const f of features) {
            if (f.type !== "gene" && f.type !== "CDS") continue;

            const locus = f.notes?.locus_tag?.[0] || ""; //obtenir locus
            if (!locus) continue;

            const geneName = f.notes?.gene?.[0] || ""; //obtenir gene Name
            const func =
              f.notes?.function?.[0] ||
              f.notes?.product?.[0] ||
              ""; //obtenir funció
            const start = f.start;
            const end = f.end;

            if (!locusMap.has(locus)) {
              locusMap.set(locus, {
                locus,
                gene: geneName,
                function: func,
                start,
                end,
              });
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

      setGenomes(out); //llista de tots els genomes ordenats
    }

    load();
  }, [genomeList]);

  // GIVEN A HIT, FIND GENES CERCANOS (CADENA ±150)
  function findGenesForHit(acc, hitStart, hitEnd) {
    const genome = genomes.find((g) => g.acc === acc);
    if (!genome || !genome.genes || genome.genes.length === 0) return [];

    const genes = genome.genes; // ya vienen ordenados por start

    const distToSite = (gene) => {
      if (hitEnd < gene.start) return gene.start - hitEnd;
      if (hitStart > gene.end) return hitStart - gene.end;
      return 0;
    };

    let bestIdx = -1;
    let bestDist = Infinity;
    genes.forEach((g, idx) => {
      const d = distToSite(g);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = idx;
      }
    });

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

    pushUnique(genes[bestIdx]);

    let i = bestIdx - 1;
    while (i >= 0) {
      const current = genes[i];
      const next = genes[i + 1];
      const gap = next.start - current.end;
      if (gap > 150) break;
      pushUnique(current);
      i--;
    }

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

  // ✅ “verde” solo si la elección es válida (exact o fuzzy). No “none”.
  function isCompleted(site) {
    const c = choice?.[site];
    return typeof c === "string" && (c.startsWith("ex-") || c.startsWith("fz-"));
  }

  const allCompleted = useMemo(() => {
    if (!sites?.length) return false;
    return sites.every((s) => isCompleted(s));
  }, [sites, choice]);

  // SEARCH EXACT MATCHES
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

    const ch = {};
    arr.forEach((s) => (ch[s] = null));
    setChoice(ch);

    setFuzzyHits({});
    setShowFuzzy(false);

    // ✅ por defecto mostrar solo el primero
    setActiveSite(arr[0] || null);
  }

  // SEARCH FUZZY (1–2 mismatches)
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
    setAccordion((p) => ({ ...p, a3: true }));
  }

  // CONFIRM AND CONTINUE (bloqueado hasta allCompleted)
  function handleConfirm() {
    if (!allCompleted) return;

    setStep4Data({
      siteType,
      rawSites,
      sites,
      exactHits,
      fuzzyHits,
      choice,
      showFuzzy,
      activeSite,
    });
    goToNextStep();
  }

  // Solo se muestra el site activo (o el primero por defecto)
  const visibleSites = useMemo(() => {
    if (!sites?.length) return [];
    if (activeSite && sites.includes(activeSite)) return [activeSite];
    return [sites[0]];
  }, [sites, activeSite]);

  // RENDER (ACCORDIONS 1–3 ÍNTEGROS + selector entre 1 y 2)
  return (
    <div className="space-y-8">
      {/* ACCORDION 1 — INPUT */}
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

      {/* ✅ SELECTOR DE SITES (entre acordeón 1 y 2) */}
      {sites.length > 0 && (
        <div className="bg-surface border border-border rounded p-3">
          <div className="text-sm font-semibold mb-2">Select a site</div>

          <div className="border border-border rounded overflow-hidden">
            {sites.map((s) => {
              const selected = activeSite === s;
              const done = isCompleted(s);

              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setActiveSite(s)}
                  className={[
                    "w-full text-left px-3 py-2 text-sm border-b last:border-b-0",
                    "hover:bg-muted",
                    selected ? "bg-muted" : "",
                    done ? "text-green-400 font-semibold" : "",
                  ].join(" ")}
                >
                  {s}
                </button>
              );
            })}
          </div>

          {!allCompleted && (
            <div className="text-xs text-muted mt-2">
              Please select a valid match for every site before continuing.
            </div>
          )}
        </div>
      )}

      {/* ACCORDION 2 — EXACT MATCHES */}
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
            {visibleSites.map((site) => {
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
                            setActiveSite(site);
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
                                    <td className="pr-4">{g.function || ""}</td>
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
                        setActiveSite(site);
                        findFuzzy(site);
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

      {/* ACCORDION 3 — MISMATCHES */}
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
              {visibleSites.map((site) => {
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
                              setActiveSite(site);
                            }}
                          />

                          <div>
                            <div className="font-mono whitespace-pre leading-4">
                              {hit.site}
                              {"\n"}
                              {hit.bars}
                              {"\n"}
                              {hit.match} {hit.strand}[{hit.start + 1},{hit.end + 1}]{" "}
                              {hit.acc}
                            </div>

                            {/* ✅ AQUÍ vuelve locus tag / gene / function (como antes) */}
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
                                      <td className="pr-4">{g.function || ""}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </label>
                      );
                    })}

                    {/* no mismatches tampoco (NO es válido => NO pone verde) */}
                    <label className="flex items-center gap-2 text-xs cursor-pointer mt-2">
                      <input
                        type="radio"
                        name={`fz-${site}`}
                        checked={choice[site] === "none-both"}
                        onChange={() => {
                          setChoice((p) => ({ ...p, [site]: "none-both" }));
                          setActiveSite(site);
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

      <button
        className="btn mt-6"
        onClick={handleConfirm}
        disabled={!allCompleted}
        title={!allCompleted ? "Complete all sites first" : ""}
      >
        Confirm and continue →
      </button>
    </div>
  );
}

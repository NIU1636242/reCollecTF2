import React, { useState, useEffect } from "react";
import { useCuration } from "../../context/CurationContext";
import genbankParser from "genbank-parser";

/* =======================
   HELPERS
======================= */
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

/* =======================
   MAIN COMPONENT
======================= */
export default function Step4ReportedSites() {
  const {
    genomeList,
    step4Data,
    setStep4Data,
    goToNextStep,
    genomes,
    setGenomes,
  } = useCuration();

  /* ---------- ACCORDIONS ---------- */
  const [accordion, setAccordion] = useState({
    a1: true,
    a2: true,
    a3: false,
  });

  const toggleAcc = (k) =>
    setAccordion((p) => ({ ...p, [k]: !p[k] }));

  /* ---------- STATE ---------- */
  const [siteType, setSiteType] = useState("variable");
  const [rawSites, setRawSites] = useState("");
  const [sites, setSites] = useState([]);
  const [activeSite, setActiveSite] = useState(null);

  const [exactHits, setExactHits] = useState({});
  const [fuzzyHits, setFuzzyHits] = useState({});
  const [choice, setChoice] = useState({});
  const [showFuzzy, setShowFuzzy] = useState(false);

  /* =======================
     RESTORE STATE
  ======================= */
  useEffect(() => {
    if (!step4Data) return;

    setSiteType(step4Data.siteType || "variable");
    setRawSites(step4Data.rawSites || "");
    setSites(step4Data.sites || []);
    setExactHits(step4Data.exactHits || {});
    setFuzzyHits(step4Data.fuzzyHits || {});
    setChoice(step4Data.choice || {});
    setShowFuzzy(step4Data.showFuzzy || false);
    setActiveSite(step4Data.sites?.[0] || null);
  }, []);

  /* =======================
     LOAD GENOMES
  ======================= */
  useEffect(() => {
    if (!genomeList?.length) return;

    async function load() {
      const out = [];

      for (const g of genomeList) {
        const fastaURL =
          "https://corsproxy.io/?" +
          encodeURIComponent(
            `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=${g.accession}&rettype=fasta&retmode=text`
          );
        const fastaText = await (await fetch(fastaURL)).text();
        const seq = fastaText
          .replace(/>.*/g, "")
          .replace(/[^ATCG]/gi, "")
          .toUpperCase();

        const gbURL =
          "https://corsproxy.io/?" +
          encodeURIComponent(
            `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=${g.accession}&rettype=gbwithparts&retmode=text`
          );
        const gbText = await (await fetch(gbURL)).text();

        const parsed = genbankParser(gbText)?.[0];
        const locusMap = new Map();

        (parsed?.features || []).forEach((f) => {
          if (f.type !== "gene" && f.type !== "CDS") return;
          const locus = f.notes?.locus_tag?.[0];
          if (!locus) return;

          if (!locusMap.has(locus)) {
            locusMap.set(locus, {
              locus,
              gene: f.notes?.gene?.[0] || "",
              function:
                f.notes?.function?.[0] ||
                f.notes?.product?.[0] ||
                "",
              start: f.start,
              end: f.end,
            });
          }
        });

        out.push({
          acc: g.accession,
          sequence: seq,
          genes: Array.from(locusMap.values()).sort(
            (a, b) => a.start - b.start
          ),
        });
      }
      setGenomes(out);
    }

    load();
  }, [genomeList]);

  /* =======================
     GENE SEARCH
  ======================= */
  function findGenesForHit(acc, hitStart, hitEnd) {
    const genome = genomes.find((g) => g.acc === acc);
    if (!genome) return [];

    return genome.genes
      .filter(
        (g) =>
          Math.abs(
            hitEnd < g.start
              ? g.start - hitEnd
              : hitStart > g.end
              ? hitStart - g.end
              : 0
          ) <= 150
      )
      .map((g) => ({
        locus: g.locus,
        gene: g.gene,
        function: g.function,
      }));
  }

  /* =======================
     EXACT SEARCH
  ======================= */
  function findExact() {
    const arr = rawSites
      .split(/\r?\n/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    const all = {};
    const ch = {};

    arr.forEach((site) => {
      const rc = revComp(site);
      const L = site.length;
      all[site] = [];

      genomes.forEach((g) => {
        let i = g.sequence.indexOf(site);
        while (i !== -1) {
          all[site].push({
            site,
            match: site,
            start: i,
            end: i + L - 1,
            acc: g.acc,
            strand: "+",
          });
          i = g.sequence.indexOf(site, i + 1);
        }

        let j = g.sequence.indexOf(rc);
        while (j !== -1) {
          all[site].push({
            site,
            match: rc,
            start: j,
            end: j + L - 1,
            acc: g.acc,
            strand: "-",
          });
          j = g.sequence.indexOf(rc, j + 1);
        }
      });

      if (!all[site].length) all[site] = ["none"];
      ch[site] = null;
    });

    setSites(arr);
    setExactHits(all);
    setChoice(ch);
    setFuzzyHits({});
    setShowFuzzy(false);
    setActiveSite(arr[0] || null);
  }

  /* =======================
     FUZZY SEARCH
  ======================= */
  function findFuzzy(site) {
    const L = site.length;
    const rc = revComp(site);
    const found = [];

    genomes.forEach((g) => {
      for (let i = 0; i <= g.sequence.length - L; i++) {
        const sub = g.sequence.slice(i, i + L);

        if (mismatches(sub, site) > 0 && mismatches(sub, site) <= 2)
          found.push({
            site,
            match: sub,
            bars: buildBars(site, sub),
            start: i,
            end: i + L - 1,
            acc: g.acc,
            strand: "+",
          });

        if (mismatches(sub, rc) > 0 && mismatches(sub, rc) <= 2)
          found.push({
            site,
            match: sub,
            bars: buildBars(rc, sub),
            start: i,
            end: i + L - 1,
            acc: g.acc,
            strand: "-",
          });
      }
    });

    if (!found.length) found.push("none");

    setFuzzyHits((p) => ({ ...p, [site]: found }));
    setShowFuzzy(true);
    setAccordion((p) => ({ ...p, a3: true }));
  }

  /* =======================
     CONFIRM
  ======================= */
  function handleConfirm() {
    setStep4Data({
      siteType,
      rawSites,
      sites,
      exactHits,
      fuzzyHits,
      choice,
      showFuzzy,
    });
    goToNextStep();
  }

  /* =======================
     RENDER
  ======================= */
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
            <div className="space-y-1">
              <label className="flex gap-2">
                <input
                  type="radio"
                  checked={siteType === "motif"}
                  onChange={() => setSiteType("motif")}
                />
                motif-associated (new motif)
              </label>
              <label className="flex gap-2">
                <input
                  type="radio"
                  checked={siteType === "variable"}
                  onChange={() => setSiteType("variable")}
                />
                variable motif associated
              </label>
              <label className="flex gap-2">
                <input
                  type="radio"
                  checked={siteType === "nonmotif"}
                  onChange={() => setSiteType("nonmotif")}
                />
                non-motif associated
              </label>
            </div>

            <textarea
              className="form-control h-40"
              value={rawSites}
              onChange={(e) => setRawSites(e.target.value)}
            />

            <button className="btn" onClick={findExact}>
              Save
            </button>
          </div>
        )}
      </div>

      {/* SITE SELECTOR */}
      {sites.length > 0 && (
        <div className="bg-surface border border-border rounded p-4">
          <div className="font-semibold mb-2">Binding sites</div>

          {sites.map((s) => {
            const completed = choice[s] !== null;
            const active = s === activeSite;

            return (
              <button
                key={s}
                onClick={() => setActiveSite(s)}
                className={`w-full text-left px-3 py-2 text-sm border-b last:border-0
                  ${active ? "bg-muted" : "hover:bg-muted/50"}
                  ${completed ? "text-green-400 font-semibold" : ""}
                `}
              >
                {s}
              </button>
            );
          })}
        </div>
      )}

      {/* ACCORDION 2 — EXACT MATCHES (SOLO SITE ACTIVO) */}
      {activeSite && (
        <div className="bg-surface border border-border rounded p-4">
          <button
            className="flex justify-between w-full font-semibold mb-3"
            onClick={() => toggleAcc("a2")}
          >
            <span>Exact site matches</span>
            <span>{accordion.a2 ? "▲" : "▼"}</span>
          </button>

          {accordion.a2 &&
            (exactHits[activeSite] || []).map((hit, i) => {
              if (hit === "none") return null;
              const nearby = findGenesForHit(
                hit.acc,
                hit.start + 1,
                hit.end + 1
              );

              return (
                <label key={i} className="flex gap-2 text-xs">
                  <input
                    type="radio"
                    checked={choice[activeSite] === `ex-${i}`}
                    onChange={() =>
                      setChoice((p) => ({
                        ...p,
                        [activeSite]: `ex-${i}`,
                      }))
                    }
                  />
                  <div>
                    <div className="font-mono">
                      {hit.site} {hit.strand}[{hit.start + 1},{hit.end + 1}]{" "}
                      {hit.acc}
                    </div>

                    {nearby.length > 0 && (
                      <table className="mt-1 text-[11px]">
                        <tbody>
                          {nearby.map((g, idx) => (
                            <tr key={idx}>
                              <td className="pr-4">{g.locus}</td>
                              <td className="pr-4">{g.gene}</td>
                              <td>{g.function}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </label>
              );
            })}

          <label className="flex gap-2 text-xs mt-2">
            <input
              type="radio"
              checked={choice[activeSite] === "none"}
              onChange={() => {
                setChoice((p) => ({ ...p, [activeSite]: "none" }));
                findFuzzy(activeSite);
              }}
            />
            No valid match
          </label>
        </div>
      )}

      {/* ACCORDION 3 — FUZZY (SOLO SITE ACTIVO) */}
      {showFuzzy && fuzzyHits[activeSite] && (
        <div className="bg-surface border border-border rounded p-4">
          <button
            className="flex justify-between w-full font-semibold mb-3"
            onClick={() => toggleAcc("a3")}
          >
            <span>Inexact matches (mismatches)</span>
            <span>{accordion.a3 ? "▲" : "▼"}</span>
          </button>

          {accordion.a3 &&
            fuzzyHits[activeSite].map((hit, i) => {
              if (hit === "none") return null;
              return (
                <label key={i} className="flex gap-2 text-xs">
                  <input
                    type="radio"
                    checked={choice[activeSite] === `fz-${i}`}
                    onChange={() =>
                      setChoice((p) => ({
                        ...p,
                        [activeSite]: `fz-${i}`,
                      }))
                    }
                  />
                  <pre className="font-mono leading-4">
{hit.site}
{hit.bars}
{hit.match} {hit.strand}[{hit.start + 1},{hit.end + 1}] {hit.acc}
                  </pre>
                </label>
              );
            })}
        </div>
      )}

      <button className="btn mt-6" onClick={handleConfirm}>
        Confirm and continue →
      </button>
    </div>
  );
}

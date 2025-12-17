import React, { useState, useEffect } from "react";
import { useCuration } from "../../context/CurationContext";
import genbankParser from "genbank-parser";

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

export default function Step4ReportedSites() {
  const {
    genomeList,
    step4Data,
    setStep4Data,
    goToNextStep,
  } = useCuration();

  const { genomes, setGenomes } = useCuration();

  // ---------------- STATE ----------------
  const [accordion, setAccordion] = useState({
    a1: true,
    a2: true,
    a3: false,
  });

  const [siteType, setSiteType] = useState("variable");
  const [rawSites, setRawSites] = useState("");
  const [sites, setSites] = useState([]);

  const [exactHits, setExactHits] = useState({});
  const [fuzzyHits, setFuzzyHits] = useState({});
  const [choice, setChoice] = useState({});
  const [showFuzzy, setShowFuzzy] = useState(false);

  // NUEVO: site activo
  const [activeSite, setActiveSite] = useState(null);

  const toggleAcc = (k) =>
    setAccordion((p) => ({ ...p, [k]: !p[k] }));

  // ---------------- RESTORE ----------------
  useEffect(() => {
    if (!step4Data) return;

    setSiteType(step4Data.siteType || "variable");
    setRawSites(step4Data.rawSites || "");
    setSites(step4Data.sites || []);
    setExactHits(step4Data.exactHits || {});
    setFuzzyHits(step4Data.fuzzyHits || {});
    setChoice(step4Data.choice || {});
    setShowFuzzy(step4Data.showFuzzy || false);
    setActiveSite(step4Data.activeSite || null);
  }, []);

  // ---------------- LOAD GENOMES ----------------
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
        const parsed = genbankParser(gbText);
        const features = parsed?.[0]?.features || [];

        const locusMap = new Map();

        for (const f of features) {
          if (f.type !== "gene" && f.type !== "CDS") continue;
          const locus = f.notes?.locus_tag?.[0];
          if (!locus) continue;

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

        out.push({
          acc: g.accession,
          sequence: seq,
          genes: [...locusMap.values()].sort((a, b) => a.start - b.start),
        });
      }

      setGenomes(out);
    }

    load();
  }, [genomeList]);

  // ---------------- HELPERS ----------------
  function findGenesForHit(acc, hitStart, hitEnd) {
    const genome = genomes.find((g) => g.acc === acc);
    if (!genome) return [];

    const genes = genome.genes;

    const dist = (g) =>
      hitEnd < g.start
        ? g.start - hitEnd
        : hitStart > g.end
        ? hitStart - g.end
        : 0;

    let bestIdx = -1;
    let best = Infinity;

    genes.forEach((g, i) => {
      const d = dist(g);
      if (d < best) {
        best = d;
        bestIdx = i;
      }
    });

    if (bestIdx === -1 || best > 150) return [];

    const res = [];
    const push = (g) =>
      !res.some((r) => r.locus === g.locus) &&
      res.push({
        locus: g.locus,
        gene: g.gene,
        function: g.function,
      });

    push(genes[bestIdx]);

    for (let i = bestIdx - 1; i >= 0; i--) {
      if (genes[i + 1].start - genes[i].end > 150) break;
      push(genes[i]);
    }

    for (let i = bestIdx + 1; i < genes.length; i++) {
      if (genes[i].start - genes[i - 1].end > 150) break;
      push(genes[i]);
    }

    return res;
  }

  function isSiteCompleted(site) {
    const c = choice?.[site];
    return typeof c === "string" && (c.startsWith("ex-") || c.startsWith("fz-"));
  }

  // ---------------- SEARCH EXACT ----------------
  function findExact() {
    const arr = rawSites
      .split(/\r?\n/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    setSites(arr);
    setActiveSite(null);

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

    setExactHits(all);
    setChoice(ch);
    setFuzzyHits({});
    setShowFuzzy(false);
  }

  // ---------------- SEARCH FUZZY ----------------
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

    setFuzzyHits((p) => ({ ...p, [site]: found.length ? found : ["none"] }));
    setShowFuzzy(true);
  }

  const visibleSites = activeSite ? [activeSite] : sites;

  // ---------------- CONFIRM ----------------
  function handleConfirm() {
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

  // ---------------- RENDER ----------------
  return (
    <div className="space-y-8">

      {/* ACCORDION 1 */}
      <div className="bg-surface border border-border rounded p-4">
        <button onClick={() => toggleAcc("a1")} className="flex justify-between w-full font-semibold">
          <span>Reported sites</span>
          <span>{accordion.a1 ? "▲" : "▼"}</span>
        </button>

        {accordion.a1 && (
          <div className="space-y-3 text-sm mt-3">
            <label><input type="radio" checked={siteType === "motif"} onChange={() => setSiteType("motif")} /> motif-associated (new motif)</label>
            <label><input type="radio" checked={siteType === "variable"} onChange={() => setSiteType("variable")} /> variable motif associated</label>
            <label><input type="radio" checked={siteType === "nonmotif"} onChange={() => setSiteType("nonmotif")} /> non-motif associated</label>

            <textarea className="form-control w-full h-32" value={rawSites} onChange={(e) => setRawSites(e.target.value)} />
            <button className="btn" onClick={findExact}>Save</button>
          </div>
        )}
      </div>

      {/* SITE SELECTOR */}
      {sites.length > 0 && (
        <div className="bg-surface border border-border rounded p-2">
          {sites.map((s) => (
            <div
              key={s}
              onClick={() => setActiveSite(s)}
              className={`cursor-pointer p-2 border-b last:border-0
                ${activeSite === s ? "bg-border" : ""}
                ${isSiteCompleted(s) ? "text-green-400 font-semibold" : ""}
              `}
            >
              {s}
            </div>
          ))}
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

      <button className="btn mt-6" onClick={handleConfirm}>
        Confirm and continue →
      </button>
    </div>
  );
}

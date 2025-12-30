// src/components/steps/Step4ReportedSites.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useCuration } from "../../context/CurationContext";
import genbankParser from "genbank-parser";

// -----------------------------
// Small sequence helpers
// -----------------------------
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

// -----------------------------
// Networking helpers (CORS-safe)
// -----------------------------
const NCBI = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";

function buildNcbiUrl({ db = "nuccore", id, rettype, retmode = "text" }) {
  const u = new URL(NCBI);
  u.searchParams.set("db", db);
  u.searchParams.set("id", id);
  u.searchParams.set("rettype", rettype);
  u.searchParams.set("retmode", retmode);
  return u.toString();
}

function proxify(url, proxyKind) {
  const enc = encodeURIComponent(url);

  switch (proxyKind) {
    case "allorigins":
      return `https://api.allorigins.win/raw?url=${enc}`;
    case "isomorphic":
      return `https://cors.isomorphic-git.org/${url}`;
    case "corsproxy":
      return `https://corsproxy.io/?${enc}`;
    case "direct":
      return url;
    default:
      return url;
  }
}

// NOTE: corsproxy.io often returns 403. Keep it LAST.
// Also, do NOT use "direct" first (CORS will block in the browser).
async function fetchTextWithFallback(originalUrl, { timeoutMs = 12000 } = {}) {
  const proxyOrder = ["allorigins", "isomorphic", "corsproxy", "direct"];
  let lastErr = null;

  for (const proxy of proxyOrder) {
    const url = proxify(originalUrl, proxy);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: "GET",
        signal: ctrl.signal,
        headers: { Accept: "text/plain,*/*" },
      });

      clearTimeout(t);

      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} (${proxy})`);
        continue;
      }

      const txt = await res.text();

      // discard obvious proxy HTML error pages
      if (txt && txt.toLowerCase().includes("<html")) {
        lastErr = new Error(`Unexpected HTML response (${proxy})`);
        continue;
      }

      return txt;
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      continue;
    }
  }

  throw lastErr || new Error("Failed to download resource (all proxies failed).");
}

// -----------------------------
// MAIN COMPONENT
// -----------------------------
export default function Step4ReportedSites() {
  const { genomeList, step4Data, setStep4Data, goToNextStep } = useCuration();

  // Accordions open/closed
  const [accordion, setAccordion] = useState({ a1: true, a2: true, a3: false });
  const toggleAcc = (k) => setAccordion((p) => ({ ...p, [k]: !p[k] }));

  // User input
  const [siteType, setSiteType] = useState("variable");
  const [rawSites, setRawSites] = useState("");

  // Matching state
  const [sites, setSites] = useState([]);
  const [exactHits, setExactHits] = useState({});
  const [fuzzyHits, setFuzzyHits] = useState({});
  const [choice, setChoice] = useState({});
  const [showFuzzy, setShowFuzzy] = useState(false);
  const [activeSite, setActiveSite] = useState(null);

  // Gate exact/mismatch accordions until Save is clicked
  const [hasSaved, setHasSaved] = useState(false);
  const [pendingCompute, setPendingCompute] = useState(false);

  // Genomes local state
  const [genomes, setGenomes] = useState([]);
  const [loadingGenomes, setLoadingGenomes] = useState(false);
  const [genomeMsg, setGenomeMsg] = useState("");

  // Cache accession -> {sequence, genes}
  const genomeCacheRef = useRef(new Map());

  // -----------------------------
  // RESTORE state when coming back
  // -----------------------------
  useEffect(() => {
    if (!step4Data) return;

    setSiteType(step4Data.siteType || "variable");
    setRawSites(step4Data.rawSites || "");
    setSites(step4Data.sites || []);
    setExactHits(step4Data.exactHits || {});
    setFuzzyHits(step4Data.fuzzyHits || {});
    setChoice(step4Data.choice || {});
    setShowFuzzy(step4Data.showFuzzy || false);
    setActiveSite(step4Data.activeSite || (step4Data.sites?.[0] ?? null));

    setHasSaved(!!step4Data.hasSaved);
  }, [step4Data]);

  useEffect(() => {
    if (!sites?.length) {
      setActiveSite(null);
      return;
    }
    setActiveSite((prev) => (prev && sites.includes(prev) ? prev : sites[0]));
  }, [sites]);

  // -----------------------------
  // LOAD GENOMES (FASTA + GENBANK)
  // -----------------------------
  useEffect(() => {
    if (!genomeList || genomeList.length === 0) return;

    let cancelled = false;

    async function load() {
      setLoadingGenomes(true);
      setGenomeMsg("Loading genome data from NCBI...");

      const out = [];

      for (const g of genomeList) {
        const acc = g.accession;
        if (!acc) continue;

        if (genomeCacheRef.current.has(acc)) {
          out.push({ acc, ...genomeCacheRef.current.get(acc) });
          continue;
        }

        try {
          // FASTA
          const fastaUrl = buildNcbiUrl({
            db: "nuccore",
            id: acc,
            rettype: "fasta",
            retmode: "text",
          });
          const fastaText = await fetchTextWithFallback(fastaUrl);

          const seq = fastaText
            .replace(/>.*/g, "")
            .replace(/[^ATCGatcg]/g, "")
            .toUpperCase();

          if (!seq || seq.length < 100) throw new Error(`Empty/invalid FASTA for ${acc}`);

          // GENBANK
          const gbUrl = buildNcbiUrl({
            db: "nuccore",
            id: acc,
            rettype: "gbwithparts",
            retmode: "text",
          });
          const gbText = await fetchTextWithFallback(gbUrl);

          const parsed = genbankParser(gbText);
          const entry = parsed?.[0];
          const features = entry?.features || [];

          // Merge gene + CDS by locus_tag
          // IMPORTANT: function must come from /product (not /function).
          const locusMap = new Map();

          for (const f of features) {
            if (f.type !== "gene" && f.type !== "CDS") continue;

            const locus = f.notes?.locus_tag?.[0] || "";
            if (!locus) continue;

            const geneName = f.notes?.gene?.[0] || "";

            // ✅ ALWAYS prefer /product. If missing, leave empty string.
            const product = f.notes?.product?.[0] || "";

            const start = f.start; // as given by parser (same convention you were using)
            const end = f.end;

            // Strand: if parser has "strand" keep it; otherwise infer by start/end ordering if available
            const strand =
              typeof f.strand === "string"
                ? f.strand
                : typeof f.strand === "number"
                ? f.strand === -1
                  ? "-"
                  : "+"
                : undefined;

            if (!locusMap.has(locus)) {
              locusMap.set(locus, {
                locus,
                gene: geneName,
                product,
                start,
                end,
                strand,
                hasCDS: f.type === "CDS",
              });
            } else {
              const existing = locusMap.get(locus);

              existing.start = Math.min(existing.start, start);
              existing.end = Math.max(existing.end, end);

              if (!existing.gene && geneName) existing.gene = geneName;

              // Prefer CDS product when available
              if (f.type === "CDS" && product) {
                existing.product = product;
                existing.hasCDS = true;
              } else if (!existing.product && product) {
                existing.product = product;
              }

              if (!existing.strand && strand) existing.strand = strand;
            }
          }

          const genes = Array.from(locusMap.values()).sort((a, b) => a.start - b.start);

          const payload = { sequence: seq, genes };
          genomeCacheRef.current.set(acc, payload);
          out.push({ acc, ...payload });
        } catch (err) {
          console.error("Error loading genome:", acc, err);
          out.push({ acc, sequence: "", genes: [], error: String(err?.message || err) });
        }
      }

      if (cancelled) return;

      setGenomes(out);

      const bad = out.filter((x) => !x.sequence).length;
      setGenomeMsg(
        bad > 0
          ? `Genome loading finished. ${bad} genome(s) failed to load (see console).`
          : `Genome loading finished.`
      );

      setLoadingGenomes(false);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [genomeList]);

  // -----------------------------
  // Genes for a hit:
  // IMPORTANT RULE:
  // - Always pick the first gene to the RIGHT (gene.start >= hitEnd)
  // - If none to the right, pick the last gene (left side fallback)
  // - Then expand left/right while adjacent gene gaps <= 150 nt
  // - Always return at least the anchor gene (if genes exist)
  // -----------------------------
  function findGenesForHit(acc, hitStart, hitEnd) {
    const genome = genomes.find((g) => g.acc === acc);
    if (!genome || !genome.genes || genome.genes.length === 0) return [];

    const genes = genome.genes;

    // Anchor = first gene to the right of the site (by your requirement)
    let anchorIdx = genes.findIndex((g) => g.start >= hitEnd);

    // If no gene to the right, fallback to last gene in genome
    if (anchorIdx === -1) anchorIdx = genes.length - 1;

    const result = [];
    const pushUnique = (g) => {
      if (!result.some((r) => r.locus === g.locus)) {
        result.push({
          locus: g.locus || "",
          gene: g.gene || "",
          product: g.product || "",
          start: g.start,
          end: g.end,
          strand: g.strand || "",
        });
      }
    };

    pushUnique(genes[anchorIdx]);

    // Expand left with neighbor gap rule
    let i = anchorIdx - 1;
    while (i >= 0) {
      const current = genes[i];
      const next = genes[i + 1];
      const gap = next.start - current.end;
      if (gap > 150) break;
      pushUnique(current);
      i--;
    }

    // Expand right
    i = anchorIdx + 1;
    while (i < genes.length) {
      const prev = genes[i - 1];
      const current = genes[i];
      const gap = current.start - prev.end;
      if (gap > 150) break;
      pushUnique(current);
      i++;
    }

    result.sort((a, b) => a.start - b.start);
    return result;
  }

  // -----------------------------
  // Completion rules
  // -----------------------------
  function isCompleted(site) {
    const c = choice?.[site];
    return typeof c === "string" && (c.startsWith("ex-") || c.startsWith("fz-"));
  }

  const allCompleted = useMemo(() => {
    if (!sites?.length) return false;
    return sites.every((s) => isCompleted(s));
  }, [sites, choice]);

  // -----------------------------
  // Compute exact hits for a given sites array
  // (called on Save; and optionally again when genomes finish loading)
  // -----------------------------
  function computeExact(arr) {
    const all = {};

    arr.forEach((site) => {
      const rc = revComp(site);
      const L = site.length;
      all[site] = [];

      genomes.forEach((g) => {
        if (!g.sequence) return;
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

      if (all[site].length === 0) all[site] = ["none"];
    });

    setExactHits(all);

    // Reset choices on a new Save (same as your original behavior)
    const ch = {};
    arr.forEach((s) => (ch[s] = null));
    setChoice(ch);

    setFuzzyHits({});
    setShowFuzzy(false);
  }

  // -----------------------------
  // Save (no "wait for genomes" UX; user can always click)
  // - If genomes not ready yet, we keep a pending flag and will compute once loading ends.
  // -----------------------------
  function handleSave() {
    const arr = rawSites
      .split(/\r?\n/g)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    setSites(arr);
    setHasSaved(true);
    setAccordion((p) => ({ ...p, a2: true })); // open exact by default after save
    setActiveSite(arr[0] || null);

    if (!arr.length) {
      setExactHits({});
      setChoice({});
      setFuzzyHits({});
      setShowFuzzy(false);
      setPendingCompute(false);
      return;
    }

    // If genomes are available now, compute immediately.
    // Otherwise, compute later automatically when genome loading finishes.
    const usableGenomes = genomes.some((g) => !!g.sequence);
    if (usableGenomes && !loadingGenomes) {
      computeExact(arr);
      setPendingCompute(false);
    } else {
      setExactHits({});
      setChoice(Object.fromEntries(arr.map((s) => [s, null])));
      setFuzzyHits({});
      setShowFuzzy(false);
      setPendingCompute(true);
    }
  }

  // If user saved early and genomes finish loading later, compute automatically once.
  useEffect(() => {
    if (!pendingCompute) return;
    if (loadingGenomes) return;
    if (!hasSaved) return;
    if (!sites.length) return;

    const usableGenomes = genomes.some((g) => !!g.sequence);
    if (!usableGenomes) return;

    computeExact(sites);
    setPendingCompute(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCompute, loadingGenomes, genomes]);

  // -----------------------------
  // FUZZY search (1–2 mismatches)
  // -----------------------------
  function findFuzzy(site) {
    const L = site.length;
    const rc = revComp(site);
    const found = [];

    genomes.forEach((g) => {
      if (!g.sequence) return;
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

  // -----------------------------
  // Confirm & continue
  // -----------------------------
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
      hasSaved: true,
    });

    goToNextStep();
  }

  const visibleSites = useMemo(() => {
    if (!sites?.length) return [];
    if (activeSite && sites.includes(activeSite)) return [activeSite];
    return [sites[0]];
  }, [sites, activeSite]);

  // -----------------------------
  // UI
  // -----------------------------
  return (
    <div className="space-y-8">
      {/* Load status (EN only, no emojis) */}
      {genomeMsg && <div className="text-xs text-muted">{genomeMsg}</div>}

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

            {/* 2) No “wait for genomes” UX; user can always Save */}
            <button className="btn" onClick={handleSave}>
              Save
            </button>

            {/* If saved early, explain that matches will appear once loading is done (EN only) */}
            {hasSaved && pendingCompute && (
              <div className="text-xs text-muted">
                Genome data is still loading. Matches will appear automatically once loading finishes.
              </div>
            )}
          </div>
        )}
      </div>

      {/* SELECTOR OF SITES (palette improved) */}
      {hasSaved && sites.length > 0 && (
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
                    "hover:bg-accent/10",
                    selected ? "bg-accent/15 border-l-2 border-l-accent" : "",
                    done ? "text-green-400 font-semibold" : "text-foreground",
                  ].join(" ")}
                >
                  {s}
                </button>
              );
            })}
          </div>

          {!allCompleted && (
            <div className="text-xs text-muted mt-2">
              Select a valid match (exact or mismatch) for every site before continuing.
            </div>
          )}
        </div>
      )}

      {/* 8) Exact matches accordion only after Save */}
      {hasSaved && (
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
                  <div key={site} className="border border-border rounded p-3 space-y-2">
                    <div className="font-semibold text-accent">{site}</div>

                    {arr.length === 0 && pendingCompute && (
                      <div className="text-xs text-muted">
                        Matches will appear once genome loading finishes.
                      </div>
                    )}

                    {arr.map((hit, i) => {
                      if (hit === "none") return null;

                      const nearby = findGenesForHit(hit.acc, hit.start + 1, hit.end + 1);

                      return (
                        <label key={i} className="flex items-start gap-2 text-xs cursor-pointer">
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
                              {hit.site} {hit.strand}[{hit.start + 1},{hit.end + 1}] {hit.acc}
                            </div>

                            {/* 3 + 7) Always show at least the anchor gene (to the right),
                                and show start/end/strand so the user can interpret context */}
                            {nearby.length > 0 && (
                              <table className="mt-1 text-[11px]">
                                <thead>
                                  <tr>
                                    <th className="pr-3 text-left">locus tag</th>
                                    <th className="pr-3 text-left">gene</th>
                                    <th className="pr-3 text-left">product</th>
                                    <th className="pr-3 text-left">start</th>
                                    <th className="pr-3 text-left">end</th>
                                    <th className="pr-3 text-left">strand</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {nearby.map((g, idx) => (
                                    <tr key={idx}>
                                      <td className="pr-3">{g.locus}</td>
                                      <td className="pr-3">{g.gene}</td>
                                      <td className="pr-3">{g.product || ""}</td>
                                      <td className="pr-3">{g.start}</td>
                                      <td className="pr-3">{g.end}</td>
                                      <td className="pr-3">{g.strand || ""}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </label>
                      );
                    })}

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
                      <span>No valid exact match → search mismatches</span>
                    </label>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ACCORDION 3 — MISMATCHES (shown only if user triggers it) */}
      {hasSaved && showFuzzy && (
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
                  <div key={site} className="border border-border rounded p-3 space-y-2">
                    <div className="font-semibold text-accent">{site}</div>

                    {arr.map((hit, i) => {
                      if (hit === "none") return null;

                      const nearby = findGenesForHit(hit.acc, hit.start + 1, hit.end + 1);

                      return (
                        <label key={i} className="flex items-start gap-2 text-xs cursor-pointer">
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
                              {hit.match} {hit.strand}[{hit.start + 1},{hit.end + 1}] {hit.acc}
                            </div>

                            {nearby.length > 0 && (
                              <table className="mt-1 text-[11px]">
                                <thead>
                                  <tr>
                                    <th className="pr-3 text-left">locus tag</th>
                                    <th className="pr-3 text-left">gene</th>
                                    <th className="pr-3 text-left">product</th>
                                    <th className="pr-3 text-left">start</th>
                                    <th className="pr-3 text-left">end</th>
                                    <th className="pr-3 text-left">strand</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {nearby.map((g, idx) => (
                                    <tr key={idx}>
                                      <td className="pr-3">{g.locus}</td>
                                      <td className="pr-3">{g.gene}</td>
                                      <td className="pr-3">{g.product || ""}</td>
                                      <td className="pr-3">{g.start}</td>
                                      <td className="pr-3">{g.end}</td>
                                      <td className="pr-3">{g.strand || ""}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </label>
                      );
                    })}

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
                      <span>No valid mismatch match (not completed)</span>
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

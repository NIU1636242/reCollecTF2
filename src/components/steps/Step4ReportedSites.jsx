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
    case "direct":
      return url;

    // Jina "reader" proxy - often works for CORS text fetches
    case "jina":
      // IMPORTANT: no encode here; jina expects plain URL after scheme strip
      return `https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`;

    // AllOrigins raw
    case "allorigins":
      return `https://api.allorigins.win/raw?url=${enc}`;

    // Thingproxy
    case "thingproxy":
      return `https://thingproxy.freeboard.io/fetch/${url}`;

    // corsproxy.io legacy
    case "corsproxy":
      return `https://corsproxy.io/?${enc}`;

    default:
      return url;
  }
}

function looksLikeHtml(txt) {
  const t = (txt || "").trim().toLowerCase();
  return t.startsWith("<!doctype html") || t.startsWith("<html") || t.includes("<head>");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchTextOnce(url, { timeoutMs = 12000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: ctrl.signal,
      headers: { Accept: "text/plain,*/*" },
    });

    const txt = await res.text();
    clearTimeout(t);

    return { ok: res.ok, status: res.status, txt };
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

async function fetchTextWithFallback(originalUrl, { timeoutMs = 12000 } = {}) {
  // Ordered for GitHub Pages friendliness. (Removed isomorphic-git: often 403)
  const proxyOrder = ["jina", "allorigins", "thingproxy", "corsproxy", "direct"];
  let lastErr = null;

  for (const proxy of proxyOrder) {
    const url = proxify(originalUrl, proxy);

    // retries for transient 429/5xx
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { ok, status, txt } = await fetchTextOnce(url, { timeoutMs });

        if (!ok) {
          lastErr = new Error(`HTTP ${status} (${proxy})`);
          if (status === 429 || status >= 500) await sleep(700 * (attempt + 1));
          continue;
        }

        if (!txt || looksLikeHtml(txt)) {
          lastErr = new Error(`Unexpected HTML/empty response (${proxy})`);
          continue;
        }

        return txt;
      } catch (e) {
        lastErr = e;
        await sleep(350 * (attempt + 1));
        continue;
      }
    }
  }

  throw lastErr || new Error("Failed to download resource (all proxies failed).");
}

// -----------------------------
// MAIN COMPONENT
// -----------------------------
export default function Step4ReportedSites() {
  const { genomeList, step4Data, setStep4Data, goToNextStep } = useCuration();

  // Accordions
  const [accordion, setAccordion] = useState({ a1: true, a2: true, a3: false });
  const toggleAcc = (k) => setAccordion((p) => ({ ...p, [k]: !p[k] }));

  // User input
  const [siteType, setSiteType] = useState("variable");
  const [rawSites, setRawSites] = useState("");

  // Saved sites / matches
  const [sites, setSites] = useState([]);
  const [exactHits, setExactHits] = useState({});
  const [fuzzyHits, setFuzzyHits] = useState({});
  const [choice, setChoice] = useState({});
  const [showFuzzy, setShowFuzzy] = useState(false);
  const [activeSite, setActiveSite] = useState(null);

  // Requirement #8: Exact matches accordion appears only after Save
  const [hasSaved, setHasSaved] = useState(false);

  // Genomes local
  const [genomes, setGenomes] = useState([]);
  const [loadingGenomes, setLoadingGenomes] = useState(false);
  const [genomeMsg, setGenomeMsg] = useState("");

  // Cache: accession -> {sequence, genes}
  const genomeCacheRef = useRef(new Map());

  // Prevent repeated auto-recompute after load
  const autoComputedRef = useRef(false);

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

    // if coming back with saved data, do not auto compute again
    autoComputedRef.current = !!step4Data.hasSaved;
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

        // cache
        if (genomeCacheRef.current.has(acc)) {
          out.push({ acc, ...genomeCacheRef.current.get(acc) });
          continue;
        }

        try {
          const fastaUrl = buildNcbiUrl({ db: "nuccore", id: acc, rettype: "fasta", retmode: "text" });
          const fastaText = await fetchTextWithFallback(fastaUrl);

          const seq = fastaText.replace(/>.*/g, "").replace(/[^ATCGatcg]/g, "").toUpperCase();
          if (!seq || seq.length < 100) throw new Error(`Empty/invalid FASTA for ${acc}`);

          const gbUrl = buildNcbiUrl({ db: "nuccore", id: acc, rettype: "gbwithparts", retmode: "text" });
          const gbText = await fetchTextWithFallback(gbUrl);

          const parsed = genbankParser(gbText);
          const entry = parsed?.[0];
          const features = entry?.features || [];

          // Merge gene + CDS by locus_tag
          // IMPORTANT: function must come from /product (Requirement #6)
          const locusMap = new Map();

          for (const f of features) {
            if (f.type !== "gene" && f.type !== "CDS") continue;

            const locus = f.notes?.locus_tag?.[0] || "";
            if (!locus) continue;

            const geneName = f.notes?.gene?.[0] || "";
            const product = f.notes?.product?.[0] || ""; // ✅ prefer product always
            const start = f.start;
            const end = f.end;

            // strand inference (best-effort)
            const strand =
              f.strand === -1 || f.complement === true || String(f.location || "").includes("complement")
                ? "-"
                : "+";

            if (!locusMap.has(locus)) {
              locusMap.set(locus, {
                locus,
                gene: geneName,
                function: product, // ✅ store product into function display
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

              // prefer CDS product if present
              if (f.type === "CDS" && product) {
                existing.function = product;
                existing.hasCDS = true;
              } else if (!existing.function && product) {
                existing.function = product;
              }
              // keep strand as is; if any feature suggests complement, mark '-'
              if (strand === "-") existing.strand = "-";
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
      if (bad > 0) {
        setGenomeMsg(`Loaded ${out.length} genome(s). Some downloads failed (see console).`);
      } else {
        setGenomeMsg(`Loaded ${out.length} genome(s) successfully.`);
      }

      setLoadingGenomes(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [genomeList]);

  // -----------------------------
  // GIVEN A HIT, FIND GENES (Requirement #3 & #7)
  // Anchor gene: FIRST gene to the RIGHT of the site (start > hitEnd).
  // Then expand left/right while gap between neighbor genes <=150.
  // Always return at least one gene if genes exist.
  // -----------------------------
  function findGenesForHit(acc, hitStart, hitEnd) {
    const genome = genomes.find((g) => g.acc === acc);
    if (!genome || !genome.genes || genome.genes.length === 0) return [];

    const genes = genome.genes;

    // 1) anchor: first gene to the right (start > hitEnd)
    let anchorIdx = genes.findIndex((g) => g.start > hitEnd);

    // If none to the right, fallback to last gene (closest on the left)
    if (anchorIdx === -1) anchorIdx = genes.length - 1;

    const result = [];
    const pushUnique = (g) => {
      if (!result.some((r) => r.locus === g.locus)) {
        result.push({
          locus: g.locus || "",
          gene: g.gene || "",
          function: g.function || "",
          start: g.start,
          end: g.end,
          strand: g.strand || "",
        });
      }
    };

    // 2) include anchor always (even far away)
    pushUnique(genes[anchorIdx]);

    // 3) expand left while neighbor gap <=150
    let i = anchorIdx - 1;
    while (i >= 0) {
      const current = genes[i];
      const next = genes[i + 1];
      const gap = next.start - current.end; // negative = overlap
      if (gap > 150) break;
      pushUnique(current);
      i--;
    }

    // 4) expand right while neighbor gap <=150
    i = anchorIdx + 1;
    while (i < genes.length) {
      const prev = genes[i - 1];
      const current = genes[i];
      const gap = current.start - prev.end;
      if (gap > 150) break;
      pushUnique(current);
      i++;
    }

    // keep result sorted by start for nice display
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
  // Compute exact hits (used by Save and auto-compute after genomes load)
  // -----------------------------
  function computeExactHitsForSites(siteArr) {
    const all = {};
    siteArr.forEach((site) => {
      const rc = revComp(site);
      const L = site.length;
      all[site] = [];

      genomes.forEach((g) => {
        if (!g.sequence) return;
        const seq = g.sequence;

        // + strand
        let i = seq.indexOf(site);
        while (i !== -1) {
          all[site].push({ type: "exact", site, match: site, start: i, end: i + L - 1, acc: g.acc, strand: "+" });
          i = seq.indexOf(site, i + 1);
        }

        // - strand
        let j = seq.indexOf(rc);
        while (j !== -1) {
          all[site].push({ type: "exact", site, match: rc, start: j, end: j + L - 1, acc: g.acc, strand: "-" });
          j = seq.indexOf(rc, j + 1);
        }
      });

      if (all[site].length === 0) all[site] = ["none"];
    });

    return all;
  }

  // -----------------------------
  // SAVE: parse sites + compute hits (or wait and auto-compute later)
  // Requirement #2: do NOT force waiting. Let user save anytime.
  // Requirement #8: show exact accordion only after Save.
  // -----------------------------
  function handleSave() {
    const arr = rawSites
      .split(/\r?\n/g)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    setSites(arr);
    setHasSaved(true);
    autoComputedRef.current = true;

    // reset choices & fuzzy
    const ch = {};
    arr.forEach((s) => (ch[s] = null));
    setChoice(ch);
    setFuzzyHits({});
    setShowFuzzy(false);
    setActiveSite(arr[0] || null);

    // If genomes are available, compute now; otherwise compute when genomes finish loading.
    const hasAnyGenomeSeq = genomes.some((g) => !!g.sequence);
    if (hasAnyGenomeSeq) {
      setExactHits(computeExactHitsForSites(arr));
    } else {
      setExactHits({}); // will be computed later
    }
  }

  // Auto-compute when genomes become available AND user already saved sites
  useEffect(() => {
    if (!hasSaved) return;
    if (!sites?.length) return;
    if (Object.keys(exactHits || {}).length > 0) return; // already computed

    const hasAnyGenomeSeq = genomes.some((g) => !!g.sequence);
    if (!hasAnyGenomeSeq) return;

    // compute once after genomes are ready
    setExactHits(computeExactHitsForSites(sites));
  }, [genomes, hasSaved, sites, exactHits]);

  // -----------------------------
  // SEARCH FUZZY (1–2 mismatches)
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
          found.push({ type: "fuzzy", site, match: sub, bars: buildBars(site, sub), start: i, end: i + L - 1, acc: g.acc, strand: "+" });
        }

        const mmR = mismatches(sub, rc);
        if (mmR > 0 && mmR <= 2) {
          found.push({ type: "fuzzy", site, match: sub, bars: buildBars(rc, sub), start: i, end: i + L - 1, acc: g.acc, strand: "-" });
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
      {/* Status (no emojis) */}
      <div className="text-sm">
        {loadingGenomes ? (
          <span className="text-blue-300">{genomeMsg || "Loading genome data..."}</span>
        ) : (
          <span className="text-green-300">{genomeMsg || "Genome data ready."}</span>
        )}
      </div>

      {/* ACCORDION 1 — INPUT */}
      <div className="bg-surface border border-border rounded p-4">
        <button className="flex justify-between w-full font-semibold mb-3" onClick={() => toggleAcc("a1")}>
          <span>Reported sites</span>
          <span>{accordion.a1 ? "▲" : "▼"}</span>
        </button>

        {accordion.a1 && (
          <div className="space-y-3 text-sm">
            <div className="space-y-1">
              <label className="flex items-center gap-2">
                <input type="radio" checked={siteType === "motif"} onChange={() => setSiteType("motif")} />
                motif-associated (new motif)
              </label>

              <label className="flex items-center gap-2">
                <input type="radio" checked={siteType === "variable"} onChange={() => setSiteType("variable")} />
                variable motif associated
              </label>

              <label className="flex items-center gap-2">
                <input type="radio" checked={siteType === "nonmotif"} onChange={() => setSiteType("nonmotif")} />
                non-motif associated
              </label>
            </div>

            <textarea
              className="form-control w-full h-40 text-sm"
              value={rawSites}
              placeholder="AAGATTTCTTT"
              onChange={(e) => setRawSites(e.target.value)}
            />

            <button className="btn" onClick={handleSave}>
              Save
            </button>

            <div className="text-xs text-muted">
              You can save sites at any time. If genome data is still loading, matches will appear automatically when loading finishes.
            </div>
          </div>
        )}
      </div>

      {/* SELECTOR DE SITES (only after Save, since sites list is created) */}
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
                    "w-full text-left px-3 py-2 text-sm border-b last:border-b-0 transition",
                    "hover:bg-surface/60",
                    selected ? "bg-surface/60 ring-1 ring-accent/60" : "",
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

      {/* ACCORDION 2 — EXACT MATCHES (Requirement #8: only after Save) */}
      {hasSaved && (
        <div className="bg-surface border border-border rounded p-4">
          <button className="flex justify-between w-full font-semibold mb-3" onClick={() => toggleAcc("a2")}>
            <span>Exact site matches</span>
            <span>{accordion.a2 ? "▲" : "▼"}</span>
          </button>

          {accordion.a2 && (
            <div className="space-y-4 text-sm">
              {/* If genomes not loaded yet or exactHits not computed */}
              {Object.keys(exactHits || {}).length === 0 ? (
                <div className="text-xs text-muted">
                  Matches will appear once genome data is available.
                </div>
              ) : (
                visibleSites.map((site) => {
                  const arr = exactHits[site] || [];

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

                              {/* Requirement #3 & #7: always show at least anchor gene info (if genome has genes) */}
                              {nearby.length > 0 && (
                                <table className="mt-1 text-[11px]">
                                  <thead>
                                    <tr>
                                      <th className="pr-4 text-left">locus tag</th>
                                      <th className="pr-4 text-left">gene name</th>
                                      <th className="pr-4 text-left">product</th>
                                      <th className="pr-4 text-left">start</th>
                                      <th className="pr-4 text-left">end</th>
                                      <th className="pr-4 text-left">strand</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {nearby.map((g, idx) => (
                                      <tr key={idx}>
                                        <td className="pr-4">{g.locus}</td>
                                        <td className="pr-4">{g.gene}</td>
                                        <td className="pr-4">{g.function || ""}</td>
                                        <td className="pr-4">{g.start}</td>
                                        <td className="pr-4">{g.end}</td>
                                        <td className="pr-4">{g.strand || ""}</td>
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
                })
              )}
            </div>
          )}
        </div>
      )}

      {/* ACCORDION 3 — MISMATCHES */}
      {hasSaved && showFuzzy && (
        <div className="bg-surface border border-border rounded p-4">
          <button className="flex justify-between w-full font-semibold mb-3" onClick={() => toggleAcc("a3")}>
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
                                    <th className="pr-4 text-left">locus tag</th>
                                    <th className="pr-4 text-left">gene name</th>
                                    <th className="pr-4 text-left">product</th>
                                    <th className="pr-4 text-left">start</th>
                                    <th className="pr-4 text-left">end</th>
                                    <th className="pr-4 text-left">strand</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {nearby.map((g, idx) => (
                                    <tr key={idx}>
                                      <td className="pr-4">{g.locus}</td>
                                      <td className="pr-4">{g.gene}</td>
                                      <td className="pr-4">{g.function || ""}</td>
                                      <td className="pr-4">{g.start}</td>
                                      <td className="pr-4">{g.end}</td>
                                      <td className="pr-4">{g.strand || ""}</td>
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
                      <span>No valid mismatch match (site not completed)</span>
                    </label>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Confirm */}
      {hasSaved && (
        <button className="btn mt-6" onClick={handleConfirm} disabled={!allCompleted} title={!allCompleted ? "Complete all sites first" : ""}>
          Confirm and continue →
        </button>
      )}
    </div>
  );
}

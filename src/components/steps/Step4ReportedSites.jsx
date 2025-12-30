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
// Proxy (same as Step1)
// -----------------------------
const PROXY = "https://corsproxy.io/?";
const BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchTextViaCorsProxy(url, { retries = 2, delayMs = 600 } = {}) {
  let lastErr = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(PROXY + encodeURIComponent(url));
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
        // 403/429/5xx -> wait and retry
        if ([403, 429].includes(res.status) || res.status >= 500) {
          await sleep(delayMs * (attempt + 1));
          continue;
        }
        throw lastErr;
      }

      const txt = await res.text();
      // sometimes proxies return HTML error pages
      const t = (txt || "").trim().toLowerCase();
      if (t.startsWith("<!doctype html") || t.startsWith("<html")) {
        lastErr = new Error("Unexpected HTML response from proxy");
        await sleep(delayMs * (attempt + 1));
        continue;
      }
      return txt;
    } catch (e) {
      lastErr = e;
      await sleep(delayMs * (attempt + 1));
    }
  }

  throw lastErr || new Error("Failed to fetch via corsproxy");
}

function ncbiUrl({ id, rettype, retmode = "text", db = "nuccore" }) {
  const u = new URL(BASE);
  u.searchParams.set("db", db);
  u.searchParams.set("id", id);
  u.searchParams.set("rettype", rettype);
  u.searchParams.set("retmode", retmode);
  return u.toString();
}

// -----------------------------
// MAIN
// -----------------------------
export default function Step4ReportedSites() {
  const { genomeList, step4Data, setStep4Data, goToNextStep } = useCuration();

  const [accordion, setAccordion] = useState({ a1: true, a2: true, a3: false });
  const toggleAcc = (k) => setAccordion((p) => ({ ...p, [k]: !p[k] }));

  const [siteType, setSiteType] = useState("variable");
  const [rawSites, setRawSites] = useState("");

  const [sites, setSites] = useState([]);
  const [exactHits, setExactHits] = useState({});
  const [fuzzyHits, setFuzzyHits] = useState({});
  const [choice, setChoice] = useState({});
  const [showFuzzy, setShowFuzzy] = useState(false);
  const [activeSite, setActiveSite] = useState(null);

  // requirement #8
  const [hasSaved, setHasSaved] = useState(false);

  // genome loading
  const [genomes, setGenomes] = useState([]);
  const [loadingGenomes, setLoadingGenomes] = useState(false);
  const [genomeMsg, setGenomeMsg] = useState("");

  const genomeCacheRef = useRef(new Map());

  // restore
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

  // load genomes
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
          const fastaUrl = ncbiUrl({ id: acc, rettype: "fasta", retmode: "text" });
          const fastaText = await fetchTextViaCorsProxy(fastaUrl);
          const seq = fastaText.replace(/>.*/g, "").replace(/[^ATCGatcg]/g, "").toUpperCase();
          if (!seq || seq.length < 100) throw new Error(`Empty/invalid FASTA for ${acc}`);

          // IMPORTANT: lighter GenBank to avoid proxy 403
          // was: gbwithparts (huge) -> now: gb (much smaller)
          const gbUrl = ncbiUrl({ id: acc, rettype: "gb", retmode: "text" });
          const gbText = await fetchTextViaCorsProxy(gbUrl);

          const parsed = genbankParser(gbText);
          const entry = parsed?.[0];
          const features = entry?.features || [];

          // merge by locus_tag, prefer CDS /product
          const locusMap = new Map();

          for (const f of features) {
            if (f.type !== "gene" && f.type !== "CDS") continue;

            const locus = f.notes?.locus_tag?.[0] || "";
            if (!locus) continue;

            const geneName = f.notes?.gene?.[0] || "";
            const product = f.notes?.product?.[0] || ""; // ✅ ALWAYS product
            const start = f.start;
            const end = f.end;

            const strand =
              f.strand === -1 || f.complement === true || String(f.location || "").includes("complement")
                ? "-"
                : "+";

            if (!locusMap.has(locus)) {
              locusMap.set(locus, {
                locus,
                gene: geneName,
                function: product,
                start,
                end,
                strand,
                hasCDS: f.type === "CDS",
              });
            } else {
              const ex = locusMap.get(locus);
              ex.start = Math.min(ex.start, start);
              ex.end = Math.max(ex.end, end);
              if (!ex.gene && geneName) ex.gene = geneName;

              if (f.type === "CDS" && product) {
                ex.function = product;
                ex.hasCDS = true;
              } else if (!ex.function && product) {
                ex.function = product;
              }

              if (strand === "-") ex.strand = "-";
            }
          }

          const genes = Array.from(locusMap.values()).sort((a, b) => a.start - b.start);

          const payload = { sequence: seq, genes };
          genomeCacheRef.current.set(acc, payload);
          out.push({ acc, ...payload });

          // throttle a bit to avoid proxy limits
          await sleep(250);
        } catch (err) {
          console.error("Error loading genome:", acc, err);
          out.push({ acc, sequence: "", genes: [], error: String(err?.message || err) });
          await sleep(400);
        }
      }

      if (cancelled) return;

      setGenomes(out);
      const bad = out.filter((x) => !x.sequence).length;
      setGenomeMsg(
        bad > 0
          ? `Loaded ${out.length} genome(s). Some downloads failed (see console).`
          : `Loaded ${out.length} genome(s) successfully.`
      );
      setLoadingGenomes(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [genomeList]);

  // Requirement #3: anchor gene = first to the RIGHT, then expand by ±150 gaps
  function findGenesForHit(acc, hitStart, hitEnd) {
    const genome = genomes.find((g) => g.acc === acc);
    if (!genome || !genome.genes || genome.genes.length === 0) return [];

    const genes = genome.genes;

    let anchorIdx = genes.findIndex((g) => g.start > hitEnd);
    if (anchorIdx === -1) anchorIdx = genes.length - 1; // fallback to last if none to the right

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

    pushUnique(genes[anchorIdx]);

    // left
    let i = anchorIdx - 1;
    while (i >= 0) {
      const current = genes[i];
      const next = genes[i + 1];
      const gap = next.start - current.end;
      if (gap > 150) break;
      pushUnique(current);
      i--;
    }

    // right
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

  function isCompleted(site) {
    const c = choice?.[site];
    return typeof c === "string" && (c.startsWith("ex-") || c.startsWith("fz-"));
  }

  const allCompleted = useMemo(() => {
    if (!sites?.length) return false;
    return sites.every((s) => isCompleted(s));
  }, [sites, choice]);

  function computeExactHitsForSites(siteArr) {
    const all = {};

    siteArr.forEach((site) => {
      const rc = revComp(site);
      const L = site.length;
      all[site] = [];

      genomes.forEach((g) => {
        if (!g.sequence) return;
        const seq = g.sequence;

        let i = seq.indexOf(site);
        while (i !== -1) {
          all[site].push({ type: "exact", site, match: site, start: i, end: i + L - 1, acc: g.acc, strand: "+" });
          i = seq.indexOf(site, i + 1);
        }

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

  function handleSave() {
    const arr = rawSites
      .split(/\r?\n/g)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    setSites(arr);
    setHasSaved(true);

    const ch = {};
    arr.forEach((s) => (ch[s] = null));
    setChoice(ch);

    setFuzzyHits({});
    setShowFuzzy(false);
    setActiveSite(arr[0] || null);

    // if genomes already loaded, compute now; otherwise it will compute automatically later
    if (genomes.some((g) => !!g.sequence)) {
      setExactHits(computeExactHitsForSites(arr));
    } else {
      setExactHits({});
    }
  }

  // auto compute once genomes arrive
  useEffect(() => {
    if (!hasSaved) return;
    if (!sites?.length) return;
    if (Object.keys(exactHits || {}).length > 0) return;
    if (!genomes.some((g) => !!g.sequence)) return;

    setExactHits(computeExactHitsForSites(sites));
  }, [genomes, hasSaved, sites, exactHits]);

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

  return (
    <div className="space-y-8">
      <div className="text-sm">
        {loadingGenomes ? (
          <span className="text-blue-300">{genomeMsg || "Loading genome data..."}</span>
        ) : (
          <span className="text-green-300">{genomeMsg || "Genome data ready."}</span>
        )}
      </div>

      {/* ACCORDION 1 */}
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

      {/* SELECT SITE */}
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

      {/* ACCORDION 2 — only after Save */}
      {hasSaved && (
        <div className="bg-surface border border-border rounded p-4">
          <button className="flex justify-between w-full font-semibold mb-3" onClick={() => toggleAcc("a2")}>
            <span>Exact site matches</span>
            <span>{accordion.a2 ? "▲" : "▼"}</span>
          </button>

          {accordion.a2 && (
            <div className="space-y-4 text-sm">
              {Object.keys(exactHits || {}).length === 0 ? (
                <div className="text-xs text-muted">Matches will appear once genome data is available.</div>
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

      {/* ACCORDION 3 */}
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

      {hasSaved && (
        <button className="btn mt-6" onClick={handleConfirm} disabled={!allCompleted} title={!allCompleted ? "Complete all sites first" : ""}>
          Confirm and continue →
        </button>
      )}
    </div>
  );
}

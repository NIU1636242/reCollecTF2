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
    // AllOrigins raw
    case "allorigins":
      return `https://api.allorigins.win/raw?url=${enc}`;

    // corsproxy
    case "corsproxy":
      return `https://corsproxy.io/?${enc}`;

    // isomorphic-git proxy
    case "isomorphic":
      return `https://cors.isomorphic-git.org/${url}`;

    // direct is intentionally not used (GitHub Pages → NCBI will CORS-fail)
    case "direct":
    default:
      return url;
  }
}

// fetch with timeout + fallback
async function fetchTextWithFallback(originalUrl, { timeoutMs = 12000 } = {}) {
  // IMPORTANT: avoid "direct" first to reduce CORS noise
  const proxyOrder = ["allorigins", "corsproxy", "isomorphic"];

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

      // heuristic: discard HTML error pages
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

  // Step4 state
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

  // Requirement #8: exact accordion shown only after Save
  const [hasSaved, setHasSaved] = useState(false);

  // Genomes local state
  const [genomes, setGenomes] = useState([]);
  const [loadingGenomes, setLoadingGenomes] = useState(false);
  const [genomeMsg, setGenomeMsg] = useState("");

  // Cache in memory: accession -> {sequence, genes}
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

    const restoredSites = step4Data.sites || [];
    setActiveSite(step4Data.activeSite || restoredSites[0] || null);

    // if we already have sites, we consider Save was done
    setHasSaved(!!restoredSites.length);
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
      setGenomeMsg("Loading genomes from NCBI...");

      const out = [];
      for (const g of genomeList) {
        const acc = g.accession;
        if (!acc) continue;

        // cache hit
        if (genomeCacheRef.current.has(acc)) {
          out.push({ acc, ...genomeCacheRef.current.get(acc) });
          continue;
        }

        try {
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

          if (!seq || seq.length < 100) {
            throw new Error(`Empty/invalid FASTA for ${acc}`);
          }

          // Keep your original (working) choice: gbwithparts
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
          // Requirement #6: ALWAYS use /product (never /function)
          const locusMap = new Map();

          for (const f of features) {
            if (f.type !== "gene" && f.type !== "CDS") continue;

            const locus = f.notes?.locus_tag?.[0] || "";
            if (!locus) continue;

            const geneName = f.notes?.gene?.[0] || "";
            const product = f.notes?.product?.[0] || ""; // <-- ONLY product
            const start = f.start;
            const end = f.end;

            // strand (genbank-parser usually provides 1/-1; normalize)
            const strand =
              f.strand === -1 || f.strand === "-" ? "-" :
              f.strand === 1 || f.strand === "+" ? "+" :
              "";

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

              // prefer CDS product if present
              if (f.type === "CDS" && product) {
                existing.product = product;
                existing.hasCDS = true;
              } else if (!existing.product && product) {
                existing.product = product;
              }

              if (!existing.strand && strand) existing.strand = strand;
            }
          }

          const genes = Array.from(locusMap.values()).sort(
            (a, b) => a.start - b.start
          );

          const payload = { sequence: seq, genes };
          genomeCacheRef.current.set(acc, payload);

          out.push({ acc, ...payload });
        } catch (err) {
          console.error("Error loading genome:", acc, err);
          out.push({
            acc,
            sequence: "",
            genes: [],
            error: String(err?.message || err),
          });
        }
      }

      if (cancelled) return;

      setGenomes(out);

      const bad = out.filter((x) => !x.sequence).length;
      if (bad > 0) {
        setGenomeMsg(`Loaded ${out.length} genomes. ${bad} failed (see console).`);
      } else {
        setGenomeMsg(`Loaded ${out.length} genomes successfully.`);
      }

      setLoadingGenomes(false);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [genomeList]);

  // -----------------------------
  // GIVEN A HIT, FIND NEARBY GENES
  // Requirement #3:
  //   - anchor = FIRST gene to the RIGHT (gene.start >= hitEnd)
  //   - if none, anchor = last gene
  //   - then expand left/right if neighbor gap <= 150
  //   - ALWAYS return at least the anchor gene (if genes exist)
  // -----------------------------
  function findGenesForHit(acc, hitStart, hitEnd) {
    const genome = genomes.find((g) => g.acc === acc);
    if (!genome || !genome.genes || genome.genes.length === 0) return [];

    const genes = genome.genes;

    // anchor: first gene to the right
    let anchorIdx = genes.findIndex((g) => g.start >= hitEnd);
    if (anchorIdx === -1) anchorIdx = genes.length - 1; // site after last gene

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

    // always include anchor
    pushUnique(genes[anchorIdx]);

    // expand left: neighbor gap <= 150
    let i = anchorIdx - 1;
    while (i >= 0) {
      const current = genes[i];
      const next = genes[i + 1];
      const gap = next.start - current.end; // negative => overlap
      if (gap > 150) break;
      pushUnique(current);
      i--;
    }

    // expand right
    i = anchorIdx + 1;
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

  // -----------------------------
  // Completion rules
  // -----------------------------
  function isCompleted(site) {
    const c = choice?.[site];
    return (
      typeof c === "string" && (c.startsWith("ex-") || c.startsWith("fz-"))
    );
  }

  const allCompleted = useMemo(() => {
    if (!sites?.length) return false;
    return sites.every((s) => isCompleted(s));
  }, [sites, choice]);

  // -----------------------------
  // SEARCH EXACT
  // -----------------------------
  function findExact() {
    const arr = rawSites
      .split(/\r?\n/g)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    setSites(arr);
    setHasSaved(true); // Requirement #8: enable exact accordion now

    const all = {};

    arr.forEach((site) => {
      const rc = revComp(site);
      const L = site.length;
      all[site] = [];

      genomes.forEach((g) => {
        if (!g.sequence) return;
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

    setActiveSite(arr[0] || null);
  }

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
      // also store hasSaved
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
      {/* Load status (Requirement #4: no emojis) */}
      <div className="text-sm text-muted">
        {loadingGenomes ? "Loading genome data..." : genomeMsg || "Genomes ready."}
      </div>

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

            {/* Requirement #2: no “wait for genomes” gating */}
            <button className="btn" onClick={findExact}>
              Save
            </button>
          </div>
        )}
      </div>

      {/* SELECT A SITE */}
      {sites.length > 0 && (
        <div className="bg-surface border border-border rounded p-3">
          <div className="text-sm font-semibold mb-2">Select a site</div>

          <div className="border border-border rounded overflow-hidden">
            {sites.map((s) => {
              const selected = activeSite === s;
              const done = isCompleted(s);

              // Requirement #5: better palette than grey
              const base =
                "w-full text-left px-3 py-2 text-sm border-b last:border-b-0 hover:bg-muted/40";
              const selectedCls =
                "bg-accent/10 ring-1 ring-inset ring-accent/30";
              const doneCls = "text-green-400 font-semibold";

              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setActiveSite(s)}
                  className={[
                    base,
                    selected ? selectedCls : "",
                    done ? doneCls : "",
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

      {/* ACCORDION 2 — EXACT MATCHES (Requirement #8) */}
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
                              setActiveSite(site);
                            }}
                          />
                          <div>
                            <div className="font-mono">
                              {hit.site} {hit.strand}[{hit.start + 1},{hit.end + 1}]{" "}
                              {hit.acc}
                            </div>

                            {/* Requirement #6 + #7 */}
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
                                      <td className="pr-4">{g.product || ""}</td>
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
              })}
            </div>
          )}
        </div>
      )}

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
                                      <td className="pr-4">{g.product || ""}</td>
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

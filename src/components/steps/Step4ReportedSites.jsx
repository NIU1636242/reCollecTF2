// src/components/steps/Step4ReportedSites.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
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
// NCBI + Proxy helpers (same style as Step1/Step2)
// =======================================================
const PROXY = "https://corsproxy.io/?";
const NCBI_EFETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";

function buildNcbiEfetchUrl({ db = "nuccore", id, rettype, retmode = "text" }) {
  const u = new URL(NCBI_EFETCH);
  u.searchParams.set("db", db);
  u.searchParams.set("id", id);
  u.searchParams.set("rettype", rettype);
  u.searchParams.set("retmode", retmode);
  // opcional, pero útil para NCBI:
  u.searchParams.set("tool", "reCollectTF2");
  return u.toString();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchTextViaCorsproxy(url, { timeoutMs = 20000, retryOnce = true } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(PROXY + encodeURIComponent(url), {
      method: "GET",
      signal: ctrl.signal,
      headers: { Accept: "text/plain,*/*" },
    });

    if (!res.ok) {
      // A veces 403/429 es temporal: un único reintento suave.
      if (retryOnce && (res.status === 403 || res.status === 429 || res.status >= 500)) {
        clearTimeout(t);
        await sleep(1200);
        return fetchTextViaCorsproxy(url, { timeoutMs, retryOnce: false });
      }
      throw new Error(`HTTP ${res.status}`);
    }

    const txt = await res.text();
    return txt;
  } finally {
    clearTimeout(t);
  }
}

// =======================================================
// MAIN COMPONENT
// =======================================================
export default function Step4ReportedSites() {
  const {
    genomeList,
    step4Data,
    setStep4Data,
    goToNextStep,
  } = useCuration();

  // Accordions open/closed
  const [accordion, setAccordion] = useState({
    a1: true,
    a2: true,
    a3: false,
  });
  const toggleAcc = (k) => setAccordion((p) => ({ ...p, [k]: !p[k] }));

  // User input
  const [siteType, setSiteType] = useState("variable");
  const [rawSites, setRawSites] = useState("");

  // Sites + hits
  const [sites, setSites] = useState([]);
  const [exactHits, setExactHits] = useState({});
  const [fuzzyHits, setFuzzyHits] = useState({});
  const [choice, setChoice] = useState({});
  const [showFuzzy, setShowFuzzy] = useState(false);

  // Selector
  const [activeSite, setActiveSite] = useState(null);

  // Gate: accordion2 only after Save
  const [hasSaved, setHasSaved] = useState(false);

  // Genomes
  const [genomes, setGenomes] = useState([]);
  const [loadingGenomes, setLoadingGenomes] = useState(false);
  const [loadError, setLoadError] = useState("");

  // cache (memory + localStorage)
  const memCacheRef = useRef(new Map()); // acc -> { sequence, genes }
  const LS_PREFIX = "recollecttf2_step4_genome_";

  // =======================================================
  // Restore state
  // =======================================================
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
    setHasSaved(!!(step4Data.sites && step4Data.sites.length));
  }, [step4Data]);

  useEffect(() => {
    if (!sites?.length) {
      setActiveSite(null);
      return;
    }
    setActiveSite((prev) => (prev && sites.includes(prev) ? prev : sites[0]));
  }, [sites]);

  // =======================================================
  // Load genomes (FASTA + GenBank)
  //  - uses rettype=gb (NOT gbwithparts) to reduce size
  //  - product always from /product
  // =======================================================
  useEffect(() => {
    if (!genomeList || genomeList.length === 0) return;

    let cancelled = false;

    async function loadAll() {
      setLoadingGenomes(true);
      setLoadError("");

      const out = [];

      // Gentle throttling to reduce proxy bans
      const THROTTLE_MS = 450;

      for (const g of genomeList) {
        const acc = g.accession;
        if (!acc) continue;

        // memory cache
        if (memCacheRef.current.has(acc)) {
          out.push({ acc, ...memCacheRef.current.get(acc) });
          continue;
        }

        // localStorage cache
        try {
          const ls = localStorage.getItem(LS_PREFIX + acc);
          if (ls) {
            const parsed = JSON.parse(ls);
            if (parsed?.sequence && Array.isArray(parsed?.genes)) {
              memCacheRef.current.set(acc, { sequence: parsed.sequence, genes: parsed.genes });
              out.push({ acc, sequence: parsed.sequence, genes: parsed.genes });
              continue;
            }
          }
        } catch {
          // ignore cache parse errors
        }

        try {
          // FASTA (sequence)
          const fastaUrl = buildNcbiEfetchUrl({
            db: "nuccore",
            id: acc,
            rettype: "fasta",
            retmode: "text",
          });

          const fastaText = await fetchTextViaCorsproxy(fastaUrl);
          const seq = fastaText
            .replace(/>.*/g, "")
            .replace(/[^ATCGatcg]/g, "")
            .toUpperCase();

          if (!seq || seq.length < 50) {
            throw new Error("FASTA response is empty or invalid.");
          }

          await sleep(THROTTLE_MS);

          // GenBank (features) - IMPORTANT: gb (not gbwithparts)
          const gbUrl = buildNcbiEfetchUrl({
            db: "nuccore",
            id: acc,
            rettype: "gb",
            retmode: "text",
          });

          const gbText = await fetchTextViaCorsproxy(gbUrl);

          const parsedGb = genbankParser(gbText);
          const entry = parsedGb?.[0];
          const features = entry?.features || [];

          // Merge by locus_tag; product ALWAYS from /product (prefer CDS)
          const locusMap = new Map();

          for (const f of features) {
            if (f.type !== "gene" && f.type !== "CDS") continue;

            const locus = f.notes?.locus_tag?.[0] || "";
            if (!locus) continue;

            const geneName = f.notes?.gene?.[0] || "";

            // IMPORTANT: product only
            const product = f.notes?.product?.[0] || "";

            // start/end might be 0/1 based depending on parser; you were using it as-is before.
            // We keep it consistent with your previous logic.
            const start = f.start;
            const end = f.end;

            // strand in genbank-parser: often 1/-1 or "+" / "-"
            const rawStrand = f.strand;
            const strand =
              rawStrand === -1 || rawStrand === "-" ? "-" :
              rawStrand === 1 || rawStrand === "+" ? "+" :
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

              // prefer CDS product
              if (f.type === "CDS" && product) {
                existing.product = product;
                existing.hasCDS = true;
              } else if (!existing.product && product) {
                existing.product = product;
              }

              // prefer explicit strand if missing
              if (!existing.strand && strand) existing.strand = strand;
            }
          }

          const genes = Array.from(locusMap.values()).sort((a, b) => a.start - b.start);

          const payload = { sequence: seq, genes };
          memCacheRef.current.set(acc, payload);

          try {
            localStorage.setItem(LS_PREFIX + acc, JSON.stringify(payload));
          } catch {
            // localStorage may be full; ignore
          }

          out.push({ acc, ...payload });
        } catch (e) {
          console.error("Error loading genome:", acc, e);
          out.push({ acc, sequence: "", genes: [], error: String(e?.message || e) });

          // Do not spam retries. Just continue.
        }

        await sleep(THROTTLE_MS);
      }

      if (cancelled) return;

      setGenomes(out);
      setLoadingGenomes(false);

      const failed = out.filter((x) => !x.sequence).length;
      if (failed > 0) {
        setLoadError(
          `Some genomes could not be loaded (${failed}). This is usually a temporary proxy (HTTP 403/429) limitation. Try again later or reduce the number of genomes.`
        );
      }
    }

    loadAll();

    return () => {
      cancelled = true;
    };
  }, [genomeList]);

  // =======================================================
  // Given a hit, find genes:
  //   - ALWAYS pick the FIRST gene to the RIGHT (start >= hitEnd)
  //   - if none exists (site after last gene), use the last gene
  //   - then expand left/right while neighbor gaps <= 150
  // =======================================================
  function findGenesForHit(acc, hitStart, hitEnd) {
    const genome = genomes.find((g) => g.acc === acc);
    if (!genome || !genome.genes || genome.genes.length === 0) return [];

    const genes = genome.genes; // sorted by start

    // 1) first gene to the right
    let anchorIdx = genes.findIndex((g) => g.start >= hitEnd);

    // if none to the right, use last gene
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

    // 2) add anchor
    pushUnique(genes[anchorIdx]);

    // 3) expand left (neighbor gap <= 150)
    let i = anchorIdx - 1;
    while (i >= 0) {
      const current = genes[i];
      const next = genes[i + 1];
      const gap = next.start - current.end; // if negative => overlap
      if (gap > 150) break;
      pushUnique(current);
      i--;
    }

    // 4) expand right
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

  // =======================================================
  // Completion
  // =======================================================
  function isCompleted(site) {
    const c = choice?.[site];
    return typeof c === "string" && (c.startsWith("ex-") || c.startsWith("fz-"));
  }

  const allCompleted = useMemo(() => {
    if (!sites?.length) return false;
    return sites.every((s) => isCompleted(s));
  }, [sites, choice]);

  const visibleSites = useMemo(() => {
    if (!sites?.length) return [];
    if (activeSite && sites.includes(activeSite)) return [activeSite];
    return [sites[0]];
  }, [sites, activeSite]);

  // =======================================================
  // Search exact
  // =======================================================
  function findExact() {
    const arr = rawSites
      .split(/\r?\n/g)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    setSites(arr);
    setHasSaved(true);

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

    const ch = {};
    arr.forEach((s) => (ch[s] = null));
    setChoice(ch);

    setFuzzyHits({});
    setShowFuzzy(false);

    setActiveSite(arr[0] || null);
    setAccordion((p) => ({ ...p, a2: true }));
  }

  // =======================================================
  // Search fuzzy (1–2 mismatches)
  // =======================================================
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

  // =======================================================
  // Confirm & continue
  // =======================================================
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

  // =======================================================
  // UI
  // =======================================================
  return (
    <div className="space-y-8">
      {/* Load status (no emojis) */}
      <div className="text-sm">
        {loadingGenomes ? (
          <span className="text-muted">Loading genome data from NCBI…</span>
        ) : (
          <span className="text-muted">Genome data loaded.</span>
        )}
        {loadError && <div className="mt-1 text-xs text-red-400">{loadError}</div>}
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

            {/* Requirement #2: no “wait until loaded” gating */}
            <button className="btn" onClick={findExact}>
              Save
            </button>
          </div>
        )}
      </div>

      {/* Site selector only after Save (because sites come from Save) */}
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
                    "hover:bg-muted/40",
                    // Requirement #5: better palette than grey
                    selected ? "bg-accent/10 ring-1 ring-inset ring-accent/30" : "",
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

      {/* Requirement #8: Exact matches accordion hidden until Save */}
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
                              {hit.site} {hit.strand}[{hit.start + 1},{hit.end + 1}] {hit.acc}
                            </div>

                            {/* Requirement #3 + #7: ALWAYS show genes list (right-anchor + chain) */}
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

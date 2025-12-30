import React, { useEffect, useMemo, useState, useCallback } from "react";
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

// Normalize user input sequences
function normalizeSitesInput(raw) {
  return raw
    .split(/\r?\n/g)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .map((s) => s.replace(/[^ACGT]/g, "")) // keep only DNA letters
    .filter(Boolean);
}

// =======================================================
// MAIN COMPONENT
// =======================================================
export default function Step4ReportedSites() {
  const { genomeList, step4Data, setStep4Data, goToNextStep, genomes, setGenomes } =
    useCuration();

  // Accordions open/closed
  const [accordion, setAccordion] = useState({
    a1: true,
    a2: true,
    a3: false,
  });

  const toggleAcc = (k) =>
    setAccordion((p) => ({
      ...p,
      [k]: !p[k],
    }));

  // User input / state
  const [siteType, setSiteType] = useState("variable");
  const [rawSites, setRawSites] = useState("");
  const [sites, setSites] = useState([]);

  const [exactHits, setExactHits] = useState({});
  const [fuzzyHits, setFuzzyHits] = useState({});
  const [choice, setChoice] = useState({});
  const [showFuzzy, setShowFuzzy] = useState(false);

  // Site selector
  const [activeSite, setActiveSite] = useState(null);

  // Status messages (no emojis)
  const [statusMsg, setStatusMsg] = useState("");

  // If user saved sites before genomes finished loading, we compute when ready
  const [pendingMatchCompute, setPendingMatchCompute] = useState(false);

  // =======================================================
  // RESTORE STATE WHEN COMING BACK
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

    const restoredSites = step4Data.sites || [];
    setActiveSite(step4Data.activeSite || restoredSites[0] || null);
  }, [step4Data]);

  // If sites changes, pick a valid activeSite
  useEffect(() => {
    if (!sites?.length) {
      setActiveSite(null);
      return;
    }
    setActiveSite((prev) => (prev && sites.includes(prev) ? prev : sites[0]));
  }, [sites]);

  // =======================================================
  // LOAD GENOMES (FASTA + GENBANK)
  // =======================================================
  useEffect(() => {
    if (!genomeList || genomeList.length === 0) return;

    let cancelled = false;

    async function load() {
      const out = [];
      setStatusMsg("Loading genome data...");

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

          // Merge gene + CDS by locus_tag
          // IMPORTANT FIX: Use /product as "function" (prefer CDS product),
          // fallback to /function only if product missing.
          const locusMap = new Map();

          for (const f of features) {
            if (f.type !== "gene" && f.type !== "CDS") continue;

            const locus = f.notes?.locus_tag?.[0] || "";
            if (!locus) continue;

            const geneName = f.notes?.gene?.[0] || "";
            const product = f.notes?.product?.[0] || "";
            const funcFallback = f.notes?.function?.[0] || "";
            const bestFunction = product || funcFallback || "";

            const start = Number(f.start);
            const end = Number(f.end);
            const strand = f.strand === -1 ? "-" : f.strand === 1 ? "+" : ""; // genbank-parser often uses 1 / -1

            if (!locusMap.has(locus)) {
              locusMap.set(locus, {
                locus,
                gene: geneName,
                function: bestFunction,
                start,
                end,
                strand,
                hasCDS: f.type === "CDS",
              });
            } else {
              const existing = locusMap.get(locus);

              // Merge coordinates
              existing.start = Math.min(existing.start, start);
              existing.end = Math.max(existing.end, end);

              // Keep gene name if missing
              if (!existing.gene && geneName) existing.gene = geneName;

              // Prefer CDS product as function
              if (f.type === "CDS") {
                if (product) existing.function = product;
                else if (!existing.function && funcFallback) existing.function = funcFallback;
                existing.hasCDS = true;
              } else {
                // If no function stored yet, accept from gene
                if (!existing.function && bestFunction) existing.function = bestFunction;
              }

              // Strand: keep if present
              if (!existing.strand && strand) existing.strand = strand;
            }
          }

          const genes = Array.from(locusMap.values()).sort((a, b) => a.start - b.start);

          out.push({
            acc: g.accession,
            sequence: seq,
            genes,
          });
        } catch (err) {
          console.error("Error loading genome:", err);
        }
      }

      if (cancelled) return;

      setGenomes(out);

      if (out.length > 0) setStatusMsg(`Loaded ${out.length} genome(s) successfully.`);
      else setStatusMsg("No genomes could be loaded.");

      // If user already entered sites, compute matches now
      setPendingMatchCompute((prev) => {
        return prev; // keep state; actual compute happens in effect below
      });
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [genomeList, setGenomes]);

  const genomesReady = (genomes?.length || 0) > 0;

  // =======================================================
  // Given a hit, ALWAYS return at least the closest gene.
  // Then expand left/right while neighbor gaps <= 150 nt.
  // =======================================================
  function findGenesForHit(acc, hitStart, hitEnd) {
    const genome = genomes.find((g) => g.acc === acc);
    if (!genome || !genome.genes || genome.genes.length === 0) return [];

    const genes = genome.genes; // sorted by start

    // 1) Anchor = nearest gene to the RIGHT
    // first gene whose start is >= hitEnd (site end)
    let anchorIdx = genes.findIndex((g) => g.start >= hitEnd);

    // 2) If nothing to the right, anchor = last gene (to the left)
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

    // Always include anchor gene
    pushUnique(genes[anchorIdx]);

    // 3) Expand left while adjacent genes gap <= 150
    let i = anchorIdx - 1;
    while (i >= 0) {
      const current = genes[i];
      const next = genes[i + 1];
      const gap = next.start - current.end; // negative => overlap
      if (gap > 150) break;
      pushUnique(current);
      i--;
    }

    // 4) Expand right while adjacent genes gap <= 150
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


  // =======================================================
  // Match finding (exact + fuzzy)
  // =======================================================
  const computeExactHits = useCallback(
    (arr) => {
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

        if (all[site].length === 0) all[site] = ["none"];
      });

      return all;
    },
    [genomes]
  );

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

  // Save sites (user can do it anytime)
  function handleSaveSites() {
    const arr = normalizeSitesInput(rawSites);

    setSites(arr);

    // reset per-site choices
    const ch = {};
    arr.forEach((s) => (ch[s] = null));
    setChoice(ch);

    // reset fuzzy
    setFuzzyHits({});
    setShowFuzzy(false);

    // set active site
    setActiveSite(arr[0] || null);

    // If genomes are ready, compute exact hits immediately.
    // If not ready yet, store pending and compute once loaded.
    if (genomesReady) {
      const all = computeExactHits(arr);
      setExactHits(all);
      setPendingMatchCompute(false);
    } else {
      setExactHits({});
      setPendingMatchCompute(true);
    }
  }

  // If genomes finish loading after user saved sites, compute now
  useEffect(() => {
    if (!pendingMatchCompute) return;
    if (!genomesReady) return;
    if (!sites?.length) return;

    const all = computeExactHits(sites);
    setExactHits(all);
    setPendingMatchCompute(false);
  }, [pendingMatchCompute, genomesReady, sites, computeExactHits]);

  // =======================================================
  // Completion logic
  // =======================================================
  function isCompleted(site) {
    const c = choice?.[site];
    return typeof c === "string" && (c.startsWith("ex-") || c.startsWith("fz-"));
  }

  const allCompleted = useMemo(() => {
    if (!sites?.length) return false;
    return sites.every((s) => isCompleted(s));
  }, [sites, choice]);

  // Confirm and continue
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

  // Only show the active site results (less clutter)
  const visibleSites = useMemo(() => {
    if (!sites?.length) return [];
    if (activeSite && sites.includes(activeSite)) return [activeSite];
    return [sites[0]];
  }, [sites, activeSite]);

  // =======================================================
  // RENDER
  // =======================================================
  return (
    <div className="space-y-8">
      {/* Status */}
      {statusMsg && <div className="text-sm text-muted">{statusMsg}</div>}

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
                variable motif-associated
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={siteType === "nonmotif"}
                  onChange={() => setSiteType("nonmotif")}
                />
                non-motif-associated
              </label>
            </div>

            <textarea
              className="form-control w-full h-40 text-sm"
              value={rawSites}
              placeholder="AAGATTTCTTT"
              onChange={(e) => setRawSites(e.target.value)}
            />

            <button className="btn" onClick={handleSaveSites}>
              Save
            </button>

            {!genomesReady && sites.length === 0 && (
              <div className="text-xs text-muted">
                You can enter and save sites now. Matches will be computed automatically once genome data finishes
                loading.
              </div>
            )}
          </div>
        )}
      </div>

      {/* SELECTOR */}
      {sites.length > 0 && (
        <div className="bg-surface border border-border rounded p-3">
          <div className="text-sm font-semibold mb-2">Select a site</div>

          <div className="border border-border rounded overflow-hidden">
            {sites.map((s) => {
              const selected = activeSite === s;
              const done = isCompleted(s);

              // Palette improvements:
              // - selected: accent tint (not gray)
              // - done: emerald text
              const cls = [
                "w-full text-left px-3 py-2 text-sm border-b last:border-b-0 transition-colors",
                "hover:bg-accent/10",
                selected ? "bg-accent/15 ring-1 ring-accent/30" : "bg-transparent",
                done ? "text-emerald-400 font-semibold" : "text-foreground",
              ].join(" ");

              return (
                <button key={s} type="button" onClick={() => setActiveSite(s)} className={cls}>
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
            {!genomesReady && sites.length > 0 && (
              <div className="text-xs text-muted">
                Genome data is still loading. Exact matches will appear automatically when ready.
              </div>
            )}

            {visibleSites.map((site) => {
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

                        <div className="space-y-2">
                          <div className="font-mono">
                            {hit.site} {hit.strand}[{hit.start + 1},{hit.end + 1}] {hit.acc}
                          </div>

                          {/* Genes table (always: closest gene exists unless genome has no genes) */}
                          {nearby.length > 0 && (
                            <table className="mt-1 text-[11px] w-full">
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
                                    <td className="pr-3">{g.function || ""}</td>
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

                  {/* No exact match -> allow mismatches */}
                  <label className="flex items-center gap-2 text-xs cursor-pointer mt-2">
                    <input
                      type="radio"
                      name={`ex-${site}`}
                      checked={choice[site] === "none"}
                      onChange={() => {
                        setChoice((p) => ({ ...p, [site]: "none" }));
                        setActiveSite(site);
                        if (genomesReady) findFuzzy(site);
                      }}
                      disabled={!genomesReady}
                    />
                    <span>No valid exact match → search mismatches</span>
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

                          <div className="space-y-2">
                            <div className="font-mono whitespace-pre leading-4">
                              {hit.site}
                              {"\n"}
                              {hit.bars}
                              {"\n"}
                              {hit.match} {hit.strand}[{hit.start + 1},{hit.end + 1}] {hit.acc}
                            </div>

                            {nearby.length > 0 && (
                              <table className="mt-1 text-[11px] w-full">
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
                                      <td className="pr-3">{g.function || ""}</td>
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

                    {/* No mismatches either (not valid => not "done") */}
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
                      <span>No valid match</span>
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

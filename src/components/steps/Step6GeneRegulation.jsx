// src/components/steps/Step6GeneRegulation.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useCuration } from "../../context/CurationContext";

export default function Step6GeneRegulation() {
  const {
    step4Data,
    step6Data,
    setStep6Data,
    goToNextStep,
    genomes,       // must contain the genomes + genes loaded previously (same shape as Step 4 used)
    strainData,    // from Step 2 (expressionInfo flag)
  } = useCuration();

  const expressionEnabled = !!strainData?.expressionInfo;

  const sites = step4Data?.sites || [];
  const choice = step4Data?.choice || {};
  const exactHits = step4Data?.exactHits || {};
  const fuzzyHits = step4Data?.fuzzyHits || {};

  const [regulation, setRegulation] = useState({});
  const [activeSite, setActiveSite] = useState(null);

  // -----------------------------
  // RESTORE STATE
  // -----------------------------
  useEffect(() => {
    if (step6Data) setRegulation(step6Data);
  }, [step6Data]);

  useEffect(() => {
    if (!sites.length) {
      setActiveSite(null);
      return;
    }
    setActiveSite((prev) => (prev && sites.includes(prev) ? prev : sites[0]));
  }, [sites]);

  if (!step4Data) {
    return (
      <div className="text-sm text-red-400">
        Step 4 data not found. Please complete Reported Sites first.
      </div>
    );
  }

  // -----------------------------
  // RECONSTRUCT FINAL HIT (chosen in Step 4)
  // -----------------------------
  function getSelectedHit(site) {
    const sel = choice?.[site];
    if (!sel) return null;

    if (sel.startsWith("ex-")) {
      const idx = parseInt(sel.split("-")[1], 10);
      const hit = exactHits?.[site]?.[idx];
      return hit && hit !== "none" ? hit : null;
    }

    if (sel.startsWith("fz-")) {
      const idx = parseInt(sel.split("-")[1], 10);
      const hit = fuzzyHits?.[site]?.[idx];
      return hit && hit !== "none" ? hit : null;
    }

    return null;
  }

  // -----------------------------
  // FIND NEARBY GENES (±150 nt chain logic)
  // -----------------------------
  function findGenesForHit(acc, hitStart1, hitEnd1) {
  const genome = (genomes || []).find((g) => g.acc === acc);
  if (!genome || !Array.isArray(genome.genes) || genome.genes.length === 0) return [];

  const genes = genome.genes;
  const hitEnd = hitEnd1;

  // IMPORTANT: anchor to the first gene on the RIGHT (start >= hitEnd)
  let anchorIdx = genes.findIndex((g) => Number(g.start) >= Number(hitEnd));
  if (anchorIdx === -1) anchorIdx = genes.length - 1;

  const out = [];
  const pushUnique = (g) => {
    if (!g) return;
    if (!out.some((x) => x.locus === g.locus)) {
      out.push({
        locus: g.locus || "",
        geneLabel: g.geneLabel || g.gene || g.proteinId || "—",
        product: g.product || "",
        start: g.start,
        end: g.end,
        strand: g.strand || "+",
      });
    }
  };

  pushUnique(genes[anchorIdx]);

  // extend left by gene-to-gene gaps
  let i = anchorIdx - 1;
  while (i >= 0) {
    const current = genes[i];
    const next = genes[i + 1];
    const gap = Number(next.start) - Number(current.end);
    if (gap > 150) break;
    pushUnique(current);
    i--;
  }

  // extend right by gene-to-gene gaps
  i = anchorIdx + 1;
  while (i < genes.length) {
    const prev = genes[i - 1];
    const current = genes[i];
    const gap = Number(current.start) - Number(prev.end);
    if (gap > 150) break;
    pushUnique(current);
    i++;
  }

  out.sort((a, b) => Number(a.start) - Number(b.start));
  return out;
}

  // -----------------------------
  // TOGGLE GENE SELECTION (only if expressionEnabled)
  // -----------------------------
  function toggleGene(site, gene) {
    if (!expressionEnabled) return;

    setRegulation((prev) => {
      const current = prev?.[site]?.regulatedGenes || [];
      const exists = current.some((g) => g.locus === gene.locus);

      const updated = exists
        ? current.filter((g) => g.locus !== gene.locus)
        : [...current, gene];

      return {
        ...prev,
        [site]: {
          ...(prev?.[site] || {}),
          regulatedGenes: updated,
        },
      };
    });
  }

  // -----------------------------
  // CONFIRM
  // -----------------------------
  function handleConfirm() {
    // Even if expression is disabled, we still persist (likely empty) and allow next step.
    setStep6Data(regulation);
    goToNextStep();
  }

  const visibleSites = useMemo(() => {
    if (!sites.length) return [];
    if (activeSite && sites.includes(activeSite)) return [activeSite];
    return [sites[0]];
  }, [sites, activeSite]);

  // -----------------------------
  // RENDER
  // -----------------------------
  return (
    <div className="space-y-6 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Gene regulation (experimental support)</h2>
      </div>

      {!expressionEnabled && (
        <div className="bg-surface border border-border rounded p-4 text-sm text-muted">
          Expression data was not indicated in Step 2, so gene regulation cannot be curated for this manuscript.
          You can review the nearby genes, but selection is disabled.
        </div>
      )}

      {sites.length > 0 && (
        <div className="bg-surface border border-border rounded p-3">
          <div className="text-sm font-semibold mb-2">Select a site</div>

          <div className="border border-border rounded overflow-hidden">
            {sites.map((s) => {
              const selected = activeSite === s;
              const hit = getSelectedHit(s);
              const hasHit = !!hit;

              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setActiveSite(s)}
                  className={[
                    "w-full text-left px-3 py-2 text-sm border-b last:border-b-0",
                    "hover:bg-muted",
                    selected ? "bg-accent text-black" : "hover:bg-muted text-gray-300",
                    !hasHit ? "opacity-60" : "",
                  ].join(" ")}
                  title={!hasHit ? "No selected genomic mapping in Step 4" : ""}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {visibleSites.map((site) => {
        const hit = getSelectedHit(site);
        if (!hit) {
          return (
            <div key={site} className="bg-surface border border-border rounded p-4 text-muted">
              No genomic mapping selected for <span className="font-mono">{site}</span> in Step 4.
            </div>
          );
        }

        const genes = findGenesForHit(hit.acc, hit.start + 1, hit.end + 1);

        return (
          <div key={site} className="bg-surface border border-border rounded p-4 space-y-3">
            <div className="font-mono text-xs">
              {hit.site} {hit.strand}[{hit.start + 1},{hit.end + 1}] {hit.acc}
            </div>

            {genes.length === 0 ? (
              <div className="text-muted">No nearby genes found for this mapping.</div>
            ) : (
              <div className="space-y-2">
                {genes.map((g) => {
                  const checked =
                    regulation?.[site]?.regulatedGenes?.some((x) => x.locus === g.locus) || false;

                  return (
                    <label
                      key={g.locus || `${g.start}-${g.end}`}
                      className={[
                        "flex items-start gap-2 cursor-pointer border border-border rounded px-3 py-2",
                        "hover:bg-muted/30",
                        !expressionEnabled ? "opacity-70 cursor-not-allowed" : "",
                      ].join(" ")}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!expressionEnabled}
                        onChange={() => toggleGene(site, g)}
                        className="mt-1"
                      />

                      <div className="min-w-0">
                        <div className="font-semibold">
                          {g.locus}
                          {g.geneLabel && g.geneLabel !== "—" ? ` (${g.geneLabel})` : ""}
                        </div>

                        <div className="text-xs text-muted">
                          {g.product || "—"}
                        </div>

                        <div className="text-xs text-muted mt-1">
                          start: {g.start} &nbsp; end: {g.end}
                          {g.strand ? `  |  strand: ${g.strand}` : ""}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <button className="btn mt-4" onClick={handleConfirm}>
        Confirm and continue →
      </button>
    </div>
  );
}

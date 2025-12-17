import React, { useState, useEffect } from "react";
import { useCuration } from "../../context/CurationContext";

// MAIN COMPONENT
export default function Step6GeneRegulation() {
  const {
    step4Data,
    step6Data,
    setStep6Data,
    goToNextStep,
  } = useCuration();

  const { genomes } = useCuration(); // mismos genomas cargados en step4

  const [regulation, setRegulation] = useState({});

  // ============================
  // RESTORE STATE
  // ============================
  useEffect(() => {
    if (step6Data) {
      setRegulation(step6Data);
    }
  }, []);

  if (!step4Data) {
    return (
      <div className="text-sm text-red-400">
        Step 4 data not found. Please complete reported sites first.
      </div>
    );
  }

  const { sites, choice, exactHits, fuzzyHits } = step4Data;

  // ============================
  // RECONSTRUCT FINAL HIT
  // ============================
  function getSelectedHit(site) {
    const sel = choice[site];
    if (!sel) return null;

    if (sel.startsWith("ex-")) {
      const idx = parseInt(sel.split("-")[1], 10);
      return exactHits[site]?.[idx] || null;
    }

    if (sel.startsWith("fz-")) {
      const idx = parseInt(sel.split("-")[1], 10);
      return fuzzyHits[site]?.[idx] || null;
    }

    return null;
  }

  // ============================
  // FIND NEARBY GENES (±150 nt)
  // ============================
  function findGenesForHit(acc, hitStart, hitEnd) {
    const genome = genomes.find((g) => g.acc === acc);
    if (!genome || !genome.genes) return [];

    const genes = genome.genes;

    const distToSite = (gene) => {
      if (hitEnd < gene.start) return gene.start - hitEnd;
      if (hitStart > gene.end) return hitStart - gene.end;
      return 0;
    };

    let bestIdx = -1;
    let bestDist = Infinity;

    genes.forEach((g, i) => {
      const d = distToSite(g);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    });

    if (bestIdx === -1 || bestDist > 150) return [];

    const out = [];
    const push = (g) => {
      if (!out.some((x) => x.locus === g.locus)) {
        out.push({
          locus: g.locus,
          gene: g.gene,
          function: g.function,
        });
      }
    };

    push(genes[bestIdx]);

    let i = bestIdx - 1;
    while (i >= 0 && genes[i + 1].start - genes[i].end <= 150) {
      push(genes[i--]);
    }

    i = bestIdx + 1;
    while (i < genes.length && genes[i].start - genes[i - 1].end <= 150) {
      push(genes[i++]);
    }

    return out;
  }

  // ============================
  // TOGGLE GENE SELECTION
  // ============================
  function toggleGene(site, gene) {
    setRegulation((prev) => {
      const current = prev[site]?.regulatedGenes || [];
      const exists = current.some((g) => g.locus === gene.locus);

      const updated = exists
        ? current.filter((g) => g.locus !== gene.locus)
        : [...current, gene];

      return {
        ...prev,
        [site]: {
          ...prev[site],
          regulatedGenes: updated,
        },
      };
    });
  }

  // ============================
  // CONFIRM
  // ============================
  function handleConfirm() {
    setStep6Data(regulation);
    goToNextStep();
  }

  // ============================
  // RENDER
  // ============================
  return (
    <div className="space-y-6 text-sm">
      <h2 className="font-semibold">
        Gene regulation (experimental support)
      </h2>

      {sites.map((site) => {
        const hit = getSelectedHit(site);
        if (!hit) return null;

        const genes = findGenesForHit(
          hit.acc,
          hit.start + 1,
          hit.end + 1
        );

        return (
          <div
            key={site}
            className="border border-border rounded p-4 space-y-2"
          >
            <div className="font-mono text-xs">
              {site} {hit.strand}[{hit.start + 1},{hit.end + 1}] {hit.acc}
            </div>

            <div className="space-y-1">
              {genes.map((g) => {
                const checked =
                  regulation[site]?.regulatedGenes?.some(
                    (x) => x.locus === g.locus
                  ) || false;

                return (
                  <label
                    key={g.locus}
                    className="flex items-start gap-2 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleGene(site, g)}
                    />
                    <div>
                      <div className="font-semibold">
                        {g.locus} {g.gene}
                      </div>
                      <div className="text-xs text-muted">
                        {g.function || "—"}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}

      <button className="btn mt-4" onClick={handleConfirm}>
        Confirm and continue →
      </button>
    </div>
  );
}

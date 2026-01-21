// src/components/steps/Step6GeneRegulation.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useCuration } from "../../context/CurationContext";

export default function Step6GeneRegulation() {
  const {
    step4Data,
    step6Data,
    setStep6Data,
    goToNextStep,
    genomes, // por si necesitamos fallback (casos antiguos sin selectedBySite)
    strainData, // from Step 2 (expressionInfo flag)
  } = useCuration();

  const expressionEnabled = !!strainData?.expressionInfo;

  const sites = step4Data?.sites || [];
  const choice = step4Data?.choice || {};
  const exactHits = step4Data?.exactHits || {};
  const fuzzyHits = step4Data?.fuzzyHits || {};

  // NUEVO: leído directamente de Step4 (si existe)
  const selectedBySite = step4Data?.selectedBySite || {};

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
  // NUEVO: obtener el "paquete" elegido en Step4
  // { kind: "hit" | "none", hit: {...} | null, nearbyGenes: [...] }
  // -----------------------------
  function getSelectedBundle(site) {
  return selectedBySite?.[site] || { kind: "none", hit: null, nearbyGenes: [] };
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
      <h2 className="text-2xl font-bold">Step 6 – Gene Regulation</h2>

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
              const bundle = getSelectedBundle(s);
              const hasHit = bundle?.kind === "hit" && !!bundle?.hit;

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
        const bundle = getSelectedBundle(site);

        if (!bundle || bundle.kind !== "hit" || !bundle.hit) {
          return (
            <div key={site} className="bg-surface border border-border rounded p-4 text-muted">
              No genomic mapping selected for <span className="font-mono">{site}</span> in Step 4.
            </div>
          );
        }

        const hit = bundle.hit;
        const genes = Array.isArray(bundle.nearbyGenes) ? bundle.nearbyGenes : [];

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

                        <div className="text-xs text-muted">{g.product || "—"}</div>

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

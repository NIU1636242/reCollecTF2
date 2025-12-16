import React, { useEffect, useState } from "react";
import { useCuration } from "../../context/CurationContext";

export default function Step5SiteAnnotation() {
  const {
    reportedSitesData,
    siteAnnotations,
    setSiteAnnotations,
    techniques,
    goToNextStep,
  } = useCuration();

  const { sites, exactHits, fuzzyHits, choice } = reportedSitesData;

  // =======================================================
  // CONSTANTES
  // =======================================================

  const TF_TYPES = ["monomer", "dimer", "tetramer", "other", "not specified"];
  const TF_FUNCS = ["activator", "repressor", "dual", "not specified"];

  const [bulkTfType, setBulkTfType] = useState("monomer");
  const [bulkTfFunc, setBulkTfFunc] = useState("activator");

  // =======================================================
  // RESTAURAR DATOS AL VOLVER DESDE STEP6 → STEP5
  // =======================================================

  useEffect(() => {
    if (!sites || sites.length === 0) return;

    setSiteAnnotations((prev) => {
      const next = { ...prev };
      sites.forEach((s) => {
        if (!next[s]) {
          next[s] = {
            selected: false,
            tfType: "monomer",
            tfFunc: "activator",
            useTechniques: false,
          };
        }
      });
      return next;
    });
  }, [sites]);

  // =======================================================
  // RENDER
  // =======================================================

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Step 5 – Site annotation</h2>

      <div className="bg-surface border border-border rounded p-4">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-2 py-1">Site</th>
              <th className="text-left px-2 py-1">TF-type</th>
              <th className="text-left px-2 py-1">TF-function</th>
              <th className="text-left px-2 py-1">Experimental techniques</th>
            </tr>
          </thead>

          <tbody>
            {/* ================= BULK ROW ================= */}
            <tr className="border-b border-border bg-muted/40">
              <td className="px-2 py-1">
                <button
                  className="text-blue-400 hover:text-blue-300 underline"
                  onClick={() => {
                    const anySelected = sites.some(
                      (s) => siteAnnotations[s]?.selected
                    );

                    const updated = {};
                    sites.forEach((s) => {
                      updated[s] = {
                        ...(siteAnnotations[s] || {}),
                        selected: !anySelected,
                      };
                    });
                    setSiteAnnotations(updated);
                  }}
                >
                  Select / Unselect all
                </button>
              </td>

              <td className="px-2 py-1">
                <select
                  className="form-control text-xs"
                  value={bulkTfType}
                  onChange={(e) => setBulkTfType(e.target.value)}
                />
                <button
                  className="text-blue-400 hover:text-blue-300 underline text-[11px]"
                  onClick={() => {
                    const updated = {};
                    sites.forEach((s) => {
                      const prev = siteAnnotations[s] || {};
                      updated[s] = {
                        ...prev,
                        tfType: prev.selected ? bulkTfType : prev.tfType,
                      };
                    });
                    setSiteAnnotations(updated);
                  }}
                >
                  Apply to selected
                </button>
              </td>

              <td className="px-2 py-1">
                <select
                  className="form-control text-xs"
                  value={bulkTfFunc}
                  onChange={(e) => setBulkTfFunc(e.target.value)}
                />
                <button
                  className="text-blue-400 hover:text-blue-300 underline text-[11px]"
                  onClick={() => {
                    const updated = {};
                    sites.forEach((s) => {
                      const prev = siteAnnotations[s] || {};
                      updated[s] = {
                        ...prev,
                        tfFunc: prev.selected ? bulkTfFunc : prev.tfFunc,
                      };
                    });
                    setSiteAnnotations(updated);
                  }}
                >
                  Apply to selected
                </button>
              </td>

              <td className="px-2 py-1">
                {techniques?.length > 0 ? techniques.join(", ") : "—"}
              </td>
            </tr>

            {/* ================= PER-SITE ROWS ================= */}
            {sites.map((site) => {
              const ann = siteAnnotations[site] || {
                selected: false,
                tfType: "monomer",
                tfFunc: "activator",
                useTechniques: false,
              };

              let text = site;
              const sel = choice[site];

              if (sel?.startsWith("ex-")) {
                const idx = parseInt(sel.split("-")[1], 10);
                const h = exactHits[site]?.[idx];
                if (h) {
                  text = `${h.site} ${h.strand}[${h.start + 1},${
                    h.end + 1
                  }] ${h.acc}`;
                }
              }

              if (sel?.startsWith("fz-")) {
                const idx = parseInt(sel.split("-")[1], 10);
                const h = fuzzyHits[site]?.[idx];
                if (h) {
                  text = `${h.site}\n${h.bars}\n${h.match} ${h.strand}[${
                    h.start + 1
                  },${h.end + 1}] ${h.acc}`;
                }
              }

              return (
                <tr key={site} className="border-b border-border">
                  <td className="px-2 py-2 align-top">
                    <label className="flex gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={ann.selected}
                        onChange={() =>
                          setSiteAnnotations((p) => ({
                            ...p,
                            [site]: { ...ann, selected: !ann.selected },
                          }))
                        }
                      />
                      <span className="font-mono text-[11px] whitespace-pre-wrap">
                        {text}
                      </span>
                    </label>
                  </td>

                  <td className="px-2 py-2">
                    <select
                      className="form-control text-xs"
                      value={ann.tfType}
                      onChange={(e) =>
                        setSiteAnnotations((p) => ({
                          ...p,
                          [site]: { ...ann, tfType: e.target.value },
                        }))
                      }
                    >
                      {TF_TYPES.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </td>

                  <td className="px-2 py-2">
                    <select
                      className="form-control text-xs"
                      value={ann.tfFunc}
                      onChange={(e) =>
                        setSiteAnnotations((p) => ({
                          ...p,
                          [site]: { ...ann, tfFunc: e.target.value },
                        }))
                      }
                    >
                      {TF_FUNCS.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </td>

                  <td className="px-2 py-2">
                    {techniques?.length > 0 ? (
                      <label className="inline-flex gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={ann.useTechniques}
                          onChange={(e) =>
                            setSiteAnnotations((p) => ({
                              ...p,
                              [site]: {
                                ...ann,
                                useTechniques: e.target.checked,
                              },
                            }))
                          }
                        />
                        {techniques.join(", ")}
                      </label>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ================= FINAL BUTTON ================= */}
      <button className="btn mt-4" onClick={goToNextStep}>
        Confirm and continue →
      </button>
    </div>
  );
}

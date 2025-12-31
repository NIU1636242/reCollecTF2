// src/components/steps/Step5SiteAnnotation.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useCuration } from "../../context/CurationContext";

// MAIN COMPONENT
export default function Step5SiteAnnotation() {
  const { step4Data, techniques, step5Data, setStep5Data, goToNextStep } = useCuration();

  const sites = step4Data?.sites || [];
  const exactHits = step4Data?.exactHits || {};
  const fuzzyHits = step4Data?.fuzzyHits || {};
  const choice = step4Data?.choice || {};

  // annotations[site] = { selected, tfType, tfFunc, techniques: { ecoId: boolean } }
  const [annotations, setAnnotations] = useState({});

  const TF_TYPES = ["monomer", "dimer", "tetramer", "other", "not specified"];
  const TF_FUNCS = ["activator", "repressor", "dual", "not specified"];

  const [bulkTfType, setBulkTfType] = useState("monomer");
  const [bulkTfFunc, setBulkTfFunc] = useState("activator");

  // ----------------------------
  // Normalize techniques coming from Step 3
  // Supports: ["ECO:..."] or [{ecoId,name}] or other common shapes
  // ----------------------------
  const techList = useMemo(() => {
    const arr = Array.isArray(techniques) ? techniques : [];
    return arr
      .map((t) => {
        const id =
          (typeof t === "string" && t) ||
          t?.ecoId ||
          t?.eco ||
          t?.EO_term ||
          t?.id ||
          t?.code ||
          t?.identifier ||
          "";

        if (!id) return null;

        const label = t?.name || t?.label || id;
        return { id, label };
      })
      .filter(Boolean);
  }, [techniques]);

  const emptyTechMap = useMemo(() => {
    const m = {};
    techList.forEach((t) => (m[t.id] = false));
    return m;
  }, [techList]);

  // ----------------------------
  // Restore / initialize state
  // - Keeps compatibility with old step5Data where useTechniques:boolean existed
  // ----------------------------
  useEffect(() => {
    const next = {};

    // restore previous annotations if any
    const restored = step5Data?.annotations || {};

    sites.forEach((site) => {
      const prev = restored[site] || {};

      // Old format compatibility: if useTechniques was true, mark all techniques true
      const oldUseAll = prev.useTechniques === true;

      const prevTechMap = prev.techniques || {};
      const mergedTechMap = { ...emptyTechMap };

      Object.keys(mergedTechMap).forEach((ecoId) => {
        mergedTechMap[ecoId] = oldUseAll ? true : !!prevTechMap[ecoId];
      });

      next[site] = {
        selected: !!prev.selected,
        tfType: prev.tfType || "monomer",
        tfFunc: prev.tfFunc || "activator",
        techniques: mergedTechMap,
      };
    });

    setAnnotations(next);

    if (step5Data) {
      setBulkTfType(step5Data.bulkTfType || "monomer");
      setBulkTfFunc(step5Data.bulkTfFunc || "activator");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites.length, techList.length]);

  // ----------------------------
  // Helpers
  // ----------------------------
  function siteDisplayText(site) {
    const sel = choice[site];
    const ex = exactHits[site];
    const fz = fuzzyHits[site];

    let text = site;

    if (sel && sel.startsWith("ex-")) {
      const idx = parseInt(sel.split("-")[1], 10);
      const h = ex?.[idx];
      if (h) text = `${h.site} ${h.strand}[${h.start + 1},${h.end + 1}] ${h.acc}`;
    } else if (sel && sel.startsWith("fz-")) {
      const idx = parseInt(sel.split("-")[1], 10);
      const h = fz?.[idx];
      if (h) text = `${h.site}\n${h.bars}\n${h.match} ${h.strand}[${h.start + 1},${h.end + 1}] ${h.acc}`;
    }

    return text;
  }

  function toggleSelectAll() {
    const any = sites.some((s) => annotations[s]?.selected);
    const next = { ...annotations };
    sites.forEach((s) => {
      next[s] = { ...(next[s] || {}), selected: !any };
    });
    setAnnotations(next);
  }

  function applyTfTypeToSelected() {
    const next = { ...annotations };
    sites.forEach((s) => {
      if (!next[s]?.selected) return;
      next[s] = { ...next[s], tfType: bulkTfType };
    });
    setAnnotations(next);
  }

  function applyTfFuncToSelected() {
    const next = { ...annotations };
    sites.forEach((s) => {
      if (!next[s]?.selected) return;
      next[s] = { ...next[s], tfFunc: bulkTfFunc };
    });
    setAnnotations(next);
  }

  function applyTechniqueToSelected(ecoId) {
    const next = { ...annotations };
    sites.forEach((s) => {
      if (!next[s]?.selected) return;
      next[s] = {
        ...next[s],
        techniques: { ...(next[s].techniques || {}), [ecoId]: true },
      };
    });
    setAnnotations(next);
  }

  function clearTechniqueAll(ecoId) {
    const next = { ...annotations };
    sites.forEach((s) => {
      next[s] = {
        ...next[s],
        techniques: { ...(next[s].techniques || {}), [ecoId]: false },
      };
    });
    setAnnotations(next);
  }

  // ----------------------------
  // Confirm and continue
  // ----------------------------
  function handleConfirm() {
    setStep5Data({
      annotations,
      bulkTfType,
      bulkTfFunc,
    });
    goToNextStep();
  }

  // ----------------------------
  // Render
  // ----------------------------
  return (
    <div className="space-y-8">
      <div className="bg-surface border border-border rounded p-4">
        <div className="flex justify-between w-full font-semibold mb-3">
          <span>Site annotation</span>
        </div>

        <div className="text-sm overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-2 py-1">Site</th>
                <th className="text-left px-2 py-1">TF-type</th>
                <th className="text-left px-2 py-1">TF-function</th>

                {/* One column per selected technique (CollecTF-style) */}
                {techList.length > 0 ? (
                  techList.map((t) => (
                    <th key={t.id} className="text-left px-2 py-1 align-bottom whitespace-normal min-w-[140px]">
                      <div className="font-semibold leading-4">{t.label}</div>
                      <div className="flex gap-2 text-[11px] mt-1">
                        <button
                          type="button"
                          className="text-blue-400 hover:text-blue-300 underline"
                          onClick={() => applyTechniqueToSelected(t.id)}
                        >
                          Apply to selected
                        </button>
                        <button
                          type="button"
                          className="text-blue-400 hover:text-blue-300 underline"
                          onClick={() => clearTechniqueAll(t.id)}
                        >
                          Clear all
                        </button>
                      </div>
                    </th>
                  ))
                ) : (
                  <th className="text-left px-2 py-1">Experimental techniques</th>
                )}
              </tr>
            </thead>

            <tbody>
              {/* BULK ROW */}
              <tr className="border-b border-border bg-muted/40">
                <td className="px-2 py-2 align-top">
                  <button type="button" className="text-blue-400 hover:text-blue-300 underline" onClick={toggleSelectAll}>
                    Select/Unselect all
                  </button>
                </td>

                <td className="px-2 py-2 align-top">
                  <div className="flex flex-col gap-1">
                    <select className="form-control text-xs" value={bulkTfType} onChange={(e) => setBulkTfType(e.target.value)}>
                      {TF_TYPES.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>

                    <button
                      type="button"
                      className="text-blue-400 hover:text-blue-300 underline text-[11px]"
                      onClick={applyTfTypeToSelected}
                    >
                      Apply to selected
                    </button>
                  </div>
                </td>

                <td className="px-2 py-2 align-top">
                  <div className="flex flex-col gap-1">
                    <select className="form-control text-xs" value={bulkTfFunc} onChange={(e) => setBulkTfFunc(e.target.value)}>
                      {TF_FUNCS.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>

                    <button
                      type="button"
                      className="text-blue-400 hover:text-blue-300 underline text-[11px]"
                      onClick={applyTfFuncToSelected}
                    >
                      Apply to selected
                    </button>
                  </div>
                </td>

                {/* If no techniques selected, show placeholder */}
                {techList.length === 0 && <td className="px-2 py-2 text-muted">—</td>}

                {/* If techniques exist, leave bulk-row technique cells empty (controls are in headers) */}
                {techList.length > 0 && techList.map((t) => <td key={t.id} className="px-2 py-2" />)}
              </tr>

              {/* SITE ROWS */}
              {sites.map((site) => {
                const ann = annotations[site] || {
                  selected: false,
                  tfType: "monomer",
                  tfFunc: "activator",
                  techniques: { ...emptyTechMap },
                };

                return (
                  <tr key={site} className="border-b border-border">
                    <td className="px-2 py-2 align-top">
                      <label className="flex gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!ann.selected}
                          onChange={() =>
                            setAnnotations((p) => ({
                              ...p,
                              [site]: { ...ann, selected: !ann.selected },
                            }))
                          }
                        />
                        <span className="font-mono text-[11px] whitespace-pre-wrap">{siteDisplayText(site)}</span>
                      </label>
                    </td>

                    <td className="px-2 py-2 align-top">
                      <select
                        className="form-control text-xs"
                        value={ann.tfType}
                        onChange={(e) =>
                          setAnnotations((p) => ({
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

                    <td className="px-2 py-2 align-top">
                      <select
                        className="form-control text-xs"
                        value={ann.tfFunc}
                        onChange={(e) =>
                          setAnnotations((p) => ({
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

                    {/* One checkbox per technique */}
                    {techList.length > 0 ? (
                      techList.map((t) => (
                        <td key={t.id} className="px-2 py-2 align-top">
                          <input
                            type="checkbox"
                            checked={!!ann.techniques?.[t.id]}
                            onChange={(e) =>
                              setAnnotations((p) => ({
                                ...p,
                                [site]: {
                                  ...ann,
                                  techniques: { ...(ann.techniques || {}), [t.id]: e.target.checked },
                                },
                              }))
                            }
                          />
                        </td>
                      ))
                    ) : (
                      <td className="px-2 py-2 text-muted">—</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <button className="btn mt-6" onClick={handleConfirm}>
        Confirm and continue →
      </button>
    </div>
  );
}

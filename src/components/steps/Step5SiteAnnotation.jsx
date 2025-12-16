import React, { useEffect, useState } from "react";
import { useCuration } from "../../context/CurationContext";

export default function Step5SiteAnnotation() {
  const {
    techniques,
    goToNextStep,
    // viene del step4 persistido
    step4State,
    // persistir anotaciones del step5
    step5State,
    setStep5State,
  } = useCuration();

  const sites = step4State?.sites || [];
  const exactHits = step4State?.exactHits || {};
  const fuzzyHits = step4State?.fuzzyHits || {};
  const choice = step4State?.choice || {};

  // Accordion (solo a4 aquí)
  const [accordion, setAccordion] = useState({
    a4: true,
  });

  const toggleAcc = (k) =>
    setAccordion((p) => ({
      ...p,
      [k]: !p[k],
    }));

  // Datos del acordeón 4 (Site annotation)
  const [annotations, setAnnotations] = useState({});

  const TF_TYPES = ["monomer", "dimer", "tetramer", "other", "not specified"];
  const TF_FUNCS = ["activator", "repressor", "dual", "not specified"];

  const [bulkTfType, setBulkTfType] = useState("monomer");
  const [bulkTfFunc, setBulkTfFunc] = useState("activator");

  // ============================
  // RESTORE cuando vuelves atrás
  // ============================
  useEffect(() => {
    if (!step5State) return;

    if (step5State.accordion) setAccordion(step5State.accordion);
    if (step5State.annotations) setAnnotations(step5State.annotations);
    if (step5State.bulkTfType) setBulkTfType(step5State.bulkTfType);
    if (step5State.bulkTfFunc) setBulkTfFunc(step5State.bulkTfFunc);
  }, [step5State]);

  const handleConfirm = () => {
    setStep5State({
      accordion,
      annotations,
      bulkTfType,
      bulkTfFunc,
    });
    goToNextStep();
  };

  return (
    <div className="space-y-8">
      {/* =======================================================
          ACCORDION 4 — SITE ANNOTATION
      ======================================================= */}
      <div className="bg-surface border border-border rounded p-4">
        <button
          className="flex justify-between w-full font-semibold mb-3"
          onClick={() => toggleAcc("a4")}
        >
          <span>Site annotation</span>
          <span>{accordion.a4 ? "▲" : "▼"}</span>
        </button>

        {accordion.a4 && (
          <div className="text-sm">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-2 py-1">Site</th>
                  <th className="text-left px-2 py-1">TF-type</th>
                  <th className="text-left px-2 py-1">TF-function</th>
                  <th className="text-left px-2 py-1">
                    Experimental techniques
                  </th>
                </tr>
              </thead>

              <tbody>
                {/* FILA BULK */}
                <tr className="border-b border-border bg-muted/40">
                  <td className="px-2 py-1">
                    <button
                      className="text-blue-400 hover:text-blue-300 underline"
                      onClick={() => {
                        const any = sites.some((s) => annotations[s]?.selected);
                        const a = {};
                        sites.forEach((s) => {
                          a[s] = {
                            ...(annotations[s] || {
                              tfType: "monomer",
                              tfFunc: "activator",
                              useTechniques: false,
                            }),
                            selected: !any,
                          };
                        });
                        setAnnotations(a);
                      }}
                    >
                      Select/Unselect all
                    </button>
                  </td>

                  <td className="px-2 py-1">
                    <div className="flex flex-col gap-1">
                      <select
                        className="form-control text-xs"
                        value={bulkTfType}
                        onChange={(e) => setBulkTfType(e.target.value)}
                      >
                        {TF_TYPES.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>

                      <button
                        className="text-blue-400 hover:text-blue-300 underline text-[11px]"
                        onClick={() => {
                          const a = {};
                          sites.forEach((s) => {
                            const p = annotations[s] || {};
                            a[s] = {
                              ...p,
                              tfType: p.selected ? bulkTfType : p.tfType,
                            };
                          });
                          setAnnotations(a);
                        }}
                      >
                        Apply to selected
                      </button>
                    </div>
                  </td>

                  <td className="px-2 py-1">
                    <div className="flex flex-col gap-1">
                      <select
                        className="form-control text-xs"
                        value={bulkTfFunc}
                        onChange={(e) => setBulkTfFunc(e.target.value)}
                      >
                        {TF_FUNCS.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>

                      <button
                        className="text-blue-400 hover:text-blue-300 underline text-[11px]"
                        onClick={() => {
                          const a = {};
                          sites.forEach((s) => {
                            const p = annotations[s] || {};
                            a[s] = {
                              ...p,
                              tfFunc: p.selected ? bulkTfFunc : p.tfFunc,
                            };
                          });
                          setAnnotations(a);
                        }}
                      >
                        Apply to selected
                      </button>
                    </div>
                  </td>

                  <td className="px-2 py-1">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs">
                        {techniques?.map((t) => t.name).join(", ") || "—"}
                      </span>

                      {techniques?.length > 0 && (
                        <div className="flex gap-2 text-[11px]">
                          <button
                            className="text-blue-400 hover:text-blue-300 underline"
                            onClick={() => {
                              const a = {};
                              sites.forEach((s) => {
                                const p = annotations[s] || {};
                                a[s] = {
                                  ...p,
                                  useTechniques:
                                    p.selected || p.useTechniques,
                                };
                              });
                              setAnnotations(a);
                            }}
                          >
                            Apply to selected
                          </button>

                          <button
                            className="text-blue-400 hover:text-blue-300 underline"
                            onClick={() => {
                              const a = {};
                              sites.forEach((s) => {
                                const p = annotations[s] || {};
                                a[s] = { ...p, useTechniques: false };
                              });
                              setAnnotations(a);
                            }}
                          >
                            Clear all
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>

                {/* FILAS POR SITIO */}
                {sites.map((site) => {
                  const ann = annotations[site] || {
                    selected: false,
                    tfType: "monomer",
                    tfFunc: "activator",
                    useTechniques: false,
                  };

                  const sel = choice[site];
                  const ex = exactHits[site];
                  const fz = fuzzyHits[site];

                  let text = site;

                  if (sel && sel.startsWith("ex-")) {
                    const idx = parseInt(sel.split("-")[1], 10);
                    const h = ex?.[idx];
                    if (h) {
                      text = `${h.site} ${h.strand}[${h.start + 1},${
                        h.end + 1
                      }] ${h.acc}`;
                    }
                  } else if (sel && sel.startsWith("fz-")) {
                    const idx = parseInt(sel.split("-")[1], 10);
                    const h = fz?.[idx];
                    if (h) {
                      text = `${h.site}\n${h.bars}\n${h.match} ${h.strand}[${
                        h.start + 1
                      },${h.end + 1}] ${h.acc}`;
                    }
                  } else if (sel === "none-both") {
                    text = site;
                  }

                  return (
                    <tr key={site} className="border-b border-border">
                      <td className="px-2 py-2 align-top">
                        <label className="flex gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={ann.selected}
                            onChange={() =>
                              setAnnotations((p) => ({
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

                      <td className="px-2 py-2 align-top">
                        {techniques?.length > 0 ? (
                          <label className="inline-flex gap-2 text-xs cursor-pointer">
                            <input
                              type="checkbox"
                              checked={ann.useTechniques}
                              onChange={(e) =>
                                setAnnotations((p) => ({
                                  ...p,
                                  [site]: {
                                    ...ann,
                                    useTechniques: e.target.checked,
                                  },
                                }))
                              }
                            />
                            {techniques.map((t) => t.name).join(", ")}
                          </label>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* BOTÓN FINAL STEP5 */}
            <div className="pt-4">
              <button className="btn" onClick={handleConfirm}>
                Confirm and continue →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

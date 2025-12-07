import React, { useState, useEffect } from "react";
import { useCuration } from "../../context/CurationContext";


// =============================================================================
// Helpers
// =============================================================================

function revComp(seq) {
  const map = { A: "T", T: "A", C: "G", G: "C" };
  return seq
    .toUpperCase()
    .split("")
    .reverse()
    .map((n) => map[n] || "N")
    .join("");
}

function mismatches(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) n++;
  }
  return n;
}

function buildBars(a, b) {
  return a
    .split("")
    .map((c, i) => (c === b[i] ? "|" : " "))
    .join("");
}



// =============================================================================
// PARSER DEL GENBANK
// =============================================================================

function parseGenesFromGenBank(txt) {
  const genes = [];
  const lines = txt.split("\n");
  let current = null;

  for (let raw of lines) {
    const line = raw.trim();

    // Detectar nueva FEATURE gene
    if (line.startsWith("gene")) {
      // gene  190..255
      const coords = line.replace("gene", "").trim();
      const parts = coords.split("..");

      const start = parseInt(parts[0]);
      const end = parseInt(parts[1]);

      current = {
        start,
        end,
        locus_tag: "",
        gene_name: "",
        function: "",
      };

      genes.push(current);
      continue;
    }

    if (!current) continue;

    // fields
    if (line.startsWith("/locus_tag=")) {
      current.locus_tag = line.split("=")[1].replace(/"/g, "");
    }

    if (line.startsWith("/gene=")) {
      current.gene_name = line.split("=")[1].replace(/"/g, "");
    }

    if (line.startsWith("/product=") || line.startsWith("/function=")) {
      current.function = line.split("=")[1].replace(/"/g, "");
    }
  }

  return genes;
}


// =============================================================================
// SEARCH: EXACT MATCHES
// =============================================================================

function findExactMatches(genomeSeq, site) {
  const seq = site.toUpperCase();
  const rc = revComp(seq);
  const len = seq.length;

  const hits = [];

  // forward
  let i = genomeSeq.indexOf(seq);
  while (i !== -1) {
    hits.push({
      siteSeq: seq,
      genomeSeq: seq,
      start: i,
      end: i + len - 1,
      strand: "+",
    });
    i = genomeSeq.indexOf(seq, i + 1);
  }

  // reverse
  let j = genomeSeq.indexOf(rc);
  while (j !== -1) {
    hits.push({
      siteSeq: seq,
      genomeSeq: rc,
      start: j,
      end: j + len - 1,
      strand: "-",
    });
    j = genomeSeq.indexOf(rc, j + 1);
  }

  return hits;
}



// =============================================================================
// SEARCH: FUZZY MATCHES
// =============================================================================

function findFuzzyMatches(genomeSeq, site, max = 2) {
  const seq = site.toUpperCase();
  const rc = revComp(seq);
  const len = seq.length;

  const res = [];

  for (let i = 0; i <= genomeSeq.length - len; i++) {
    const sub = genomeSeq.slice(i, i + len);

    // forward
    const mm1 = mismatches(sub, seq);
    if (mm1 > 0 && mm1 <= max) {
      res.push({
        siteSeq: seq,
        genomeSeq: sub,
        bars: buildBars(seq, sub),
        start: i,
        end: i + len - 1,
        strand: "+",
      });
    }

    // reverse
    const mm2 = mismatches(sub, rc);
    if (mm2 > 0 && mm2 <= max) {
      res.push({
        siteSeq: rc,
        genomeSeq: sub,
        bars: buildBars(rc, sub),
        start: i,
        end: i + len - 1,
        strand: "-",
      });
    }
  }

  return res;
}



// =============================================================================
// FIND NEARBY GENES
// =============================================================================

function findNearbyGenes(genes, hit) {
  if (!genes || !genes.length) return [];

  function dist(g) {
    return Math.max(g.start, hit.start) - Math.min(g.end, hit.end);
  }

  const withDist = genes.map((g) => ({
    ...g,
    _dist: dist(g),
  }));

  const min = Math.min(...withDist.map((g) => g._dist));

  return withDist.filter((g) => g._dist === min);
}



// =============================================================================
// COMPONENTE
// =============================================================================

export default function Step4ReportedSites() {
  const { genomeList } = useCuration();

  // estado acordeones
  const [open1, setOpen1] = useState(true);
  const [open2, setOpen2] = useState(true);
  const [open3, setOpen3] = useState(false);
  const [open4, setOpen4] = useState(true);

  // datos
  const [siteType, setSiteType] = useState("variable");
  const [rawInput, setRawInput] = useState("");
  const [sites, setSites] = useState([]);

  const [genomeData, setGenomeData] = useState({});
  const [exact, setExact] = useState([]);
  const [fuzzy, setFuzzy] = useState({});
  const [selected, setSelected] = useState({});
  const [finalChoice, setFinalChoice] = useState({});

  const [loadingGenomes, setLoadingGenomes] = useState(false);

  const PROXY = "https://corsproxy.io/?";
  const BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";


  // ==========================================================================
  // LOAD GENOMES (GENBANK FULL)
  // ==========================================================================

  useEffect(() => {
    async function load() {
      if (!genomeList?.length) return;

      setLoadingGenomes(true);
      const store = {};

      for (const g of genomeList) {
        try {
          const url = `${BASE}/efetch.fcgi?db=nuccore&id=${g.accession}&rettype=gb&retmode=text`;
          const res = await fetch(PROXY + encodeURIComponent(url));
          const txt = await res.text();

          const seq = txt
            .split("\n")
            .filter((l) => !l.startsWith(">") && !l.startsWith("LOCUS"))
            .join("")
            .replace(/[^ATCGatcg]/g, "")
            .toUpperCase();

          const genes = parseGenesFromGenBank(txt);

          store[g.accession] = {
            acc: g.accession,
            sequence: seq,
            genes,
          };
        } catch (err) {
          console.error(err);
        }
      }

      setGenomeData(store);
      setLoadingGenomes(false);
    }

    load();
  }, [genomeList]);



  // ==========================================================================
  // PROCESS SITES
  // ==========================================================================

  function handleSave() {
    const arr = rawInput
      .split(/\r?\n/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    setSites(arr);

    const all = [];

    arr.forEach((site) => {
      for (const g of Object.values(genomeData)) {
        const hits = findExactMatches(g.sequence, site);

        hits.forEach((h) => {
          const near = findNearbyGenes(g.genes, h);
          all.push({ ...h, genomeAcc: g.acc, nearbyGenes: near });
        });
      }
    });

    setExact(all);

    // reset
    const sel = {};
    arr.forEach((s) => (sel[s] = null));
    setSelected(sel);
    setFinalChoice(sel);
  }



  // ==========================================================================
  // COMPUTE FUZZY
  // ==========================================================================

  function computeFuzzy(site) {
    const all = [];

    for (const g of Object.values(genomeData)) {
      const hits = findFuzzyMatches(g.sequence, site, 2);

      hits.forEach((h) => {
        const near = findNearbyGenes(g.genes, h);
        all.push({ ...h, genomeAcc: g.acc, nearbyGenes: near });
      });
    }

    setFuzzy((p) => ({ ...p, [site]: all }));
  }



  // ==========================================================================
  // RENDER UI
  // ==========================================================================

  function Section({ title, open, setOpen, children }) {
    return (
      <div className="border border-border rounded bg-surface">
        <button
          className="w-full text-left px-4 py-3 font-semibold"
          onClick={() => setOpen(!open)}
        >
          {title}
        </button>

        {open && <div className="px-4 pb-4">{children}</div>}
      </div>
    );
  }



  // ==========================================================================
  // RETURN
  // ==========================================================================

  const showFuzzy = Object.values(selected).some((v) => v === "none");

  return (
    <div className="space-y-8">

      {/* =================================================================== */}
      <Section title="Reported sites" open={open1} setOpen={setOpen1}>
        {/* site type */}
        <div className="space-y-2 text-sm mb-4">

          <div className="font-medium">Site type</div>

          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={siteType === "motif"}
              onChange={() => setSiteType("motif")}
            />
            <span>motif-associated (new motif)</span>
          </label>

          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={siteType === "variable"}
              onChange={() => setSiteType("variable")}
            />
            <span>variable motif associated</span>
          </label>

          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={siteType === "nonmotif"}
              onChange={() => setSiteType("nonmotif")}
            />
            <span>non-motif associated</span>
          </label>

        </div>

        <textarea
          className="form-control w-full h-40 text-sm"
          value={rawInput}
          onChange={(e) => setRawInput(e.target.value)}
        />

        <button className="btn mt-3" onClick={handleSave}>
          {loadingGenomes ? "Loading genomes..." : "Save"}
        </button>
      </Section>



      {/* =================================================================== */}
      <Section title="Exact site matches" open={open2} setOpen={setOpen2}>

        {sites.map((site) => {
          const hits = exact.filter((h) => h.siteSeq === site);
          const sel = selected[site];

          return (
            <div key={site} className="border border-border rounded p-3 space-y-2 mb-4">

              <h4 className="font-semibold text-accent">{site}</h4>

              {hits.map((m, i) => (
                <label key={i} className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name={`match-${site}`}
                    checked={sel === i}
                    onChange={() => {
                      setSelected((p) => ({ ...p, [site]: i }));
                      setFinalChoice((p) => ({
                        ...p,
                        [site]: { type: "exact", data: m },
                      }));
                      setOpen4(true);
                    }}
                  />

                  <div className="font-mono text-xs flex-1 leading-4">
                    {m.siteSeq} {m.strand}[{m.start + 1},{m.end + 1}] {m.genomeAcc}

                    {m.nearbyGenes?.length > 0 && (
                      <table className="text-xs w-full mt-1">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left pr-4">locus tag</th>
                            <th className="text-left pr-4">gene name</th>
                            <th className="text-left">function</th>
                          </tr>
                        </thead>
                        <tbody>
                          {m.nearbyGenes.map((g, gi) => (
                            <tr key={gi}>
                              <td className="pr-4">{g.locus_tag}</td>
                              <td className="pr-4">{g.gene_name}</td>
                              <td>{g.function}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </label>
              ))}

              {/* no match */}
              <label className="flex items-center gap-2 text-xs cursor-pointer mt-2">
                <input
                  type="radio"
                  name={`match-${site}`}
                  checked={sel === "none"}
                  onChange={() => {
                    setSelected((p) => ({ ...p, [site]: "none" }));
                    setFinalChoice((p) => ({ ...p, [site]: { type: "none" } }));
                    computeFuzzy(site);
                    setOpen3(true);
                    setOpen4(false);
                  }}
                />
                <span>No valid match.</span>
              </label>
            </div>
          );
        })}
      </Section>



      {/* =================================================================== */}
      {showFuzzy && (
        <Section title="Inexact matches" open={open3} setOpen={setOpen3}>

          {sites.map((site) => {
            if (selected[site] !== "none") return null;

            const arr = fuzzy[site] || [];
            const sel = selected[site];

            return (
              <div key={site} className="border border-border rounded p-3 space-y-2 mb-4">

                <h4 className="font-semibold text-accent">{site}</h4>

                {arr.map((m, i) => (
                  <label
                    key={i}
                    className="flex items-start gap-2 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name={`fuzzy-${site}`}
                      checked={sel === `fz-${i}`}
                      onChange={() => {
                        setSelected((p) => ({ ...p, [site]: `fz-${i}` }));
                        setFinalChoice((p) => ({
                          ...p,
                          [site]: { type: "fuzzy", data: m },
                        }));
                        setOpen4(true);
                      }}
                    />

                    <div className="font-mono text-xs flex-1 leading-4 whitespace-pre">
                      {m.siteSeq}
                      {"\n"}
                      {m.bars}
                      {"\n"}
                      {m.genomeSeq} {m.strand}[{m.start + 1},{m.end + 1}] {m.genomeAcc}

                      {m.nearbyGenes?.length > 0 && (
                        <table className="text-xs w-full mt-1">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="text-left pr-4">locus tag</th>
                              <th className="text-left pr-4">gene name</th>
                              <th className="text-left">function</th>
                            </tr>
                          </thead>
                          <tbody>
                            {m.nearbyGenes.map((g, gi) => (
                              <tr key={gi}>
                                <td className="pr-4">{g.locus_tag}</td>
                                <td className="pr-4">{g.gene_name}</td>
                                <td>{g.function}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </label>
                ))}

                {/* no match */}
                <label className="flex items-center gap-2 text-xs cursor-pointer mt-2">
                  <input
                    type="radio"
                    name={`fuzzy-${site}`}
                    checked={sel === "fz-none"}
                    onChange={() => {
                      setSelected((p) => ({ ...p, [site]: "fz-none" }));
                      setFinalChoice((p) => ({ ...p, [site]: { type: "none" } }));
                      setOpen4(true);
                    }}
                  />
                  <span>No valid match.</span>
                </label>
              </div>
            );
          })}
        </Section>
      )}



      {/* =================================================================== */}
      <Section title="Site annotation" open={open4} setOpen={setOpen4}>

        {sites.map((site) => {
          const sel = finalChoice[site];

          // caso simple: no match
          if (!sel || sel.type === "none") {
            return (
              <p key={site} className="font-mono text-xs leading-4">{site}</p>
            );
          }

          // exact
          if (sel.type === "exact") {
            const m = sel.data;
            return (
              <div key={site} className="font-mono text-xs leading-4">
                {m.siteSeq} {m.strand}[{m.start + 1},{m.end + 1}] {m.genomeAcc}

                {m.nearbyGenes?.length > 0 && (
                  <table className="text-xs w-full mt-1">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left pr-4">locus tag</th>
                        <th className="text-left pr-4">gene name</th>
                        <th className="text-left">function</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.nearbyGenes.map((g, gi) => (
                        <tr key={gi}>
                          <td className="pr-4">{g.locus_tag}</td>
                          <td className="pr-4">{g.gene_name}</td>
                          <td>{g.function}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          }

          // fuzzy
          if (sel.type === "fuzzy") {
            const m = sel.data;
            return (
              <div key={site} className="font-mono text-xs leading-4 whitespace-pre">
                {m.siteSeq}
                {"\n"}
                {m.bars}
                {"\n"}
                {m.genomeSeq} {m.strand}[{m.start + 1},{m.end + 1}] {m.genomeAcc}

                {m.nearbyGenes?.length > 0 && (
                  <table className="text-xs w-full mt-1">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left pr-4">locus tag</th>
                        <th className="text-left pr-4">gene name</th>
                        <th className="text-left">function</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.nearbyGenes.map((g, gi) => (
                        <tr key={gi}>
                          <td className="pr-4">{g.locus_tag}</td>
                          <td className="pr-4">{g.gene_name}</td>
                          <td>{g.function}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          }

          return null;
        })}
      </Section>

    </div>
  );
}

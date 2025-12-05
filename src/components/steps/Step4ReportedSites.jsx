import { useState, useEffect } from "react";
import { useCuration } from "../../context/CurationContext";

const PROXY = "https://corsproxy.io/?";
const NCBI = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

export default function Step4ReportedSites() {

  const { genomeList } = useCuration();

  // ================================
  // UI STATES
  // ================================

  const [siteType, setSiteType] = useState("motif-associated");

  const [expanded, setExpanded] = useState({
    step1: true,
    step2: false,
    step3: false,
    step4: false,
  });

  const [siteInput, setSiteInput] = useState("");
  const [parsedSites, setParsedSites] = useState([]);

  const [genomeSequences, setGenomeSequences] = useState({});
  const [exactMatches, setExactMatches] = useState([]);

  const [loadingGenomes, setLoadingGenomes] = useState(false);
  const [loadingExact, setLoadingExact] = useState(false);

  // ================================
  // DNA UTILITIES
  // ================================

  function revComp(seq) {
    const map = { A: "T", T: "A", C: "G", G: "C" };
    return seq
      .split("")
      .reverse()
      .map(n => map[n] || "N")
      .join("");
  }

  // ================================
  // DOWNLOAD GENOMES
  // ================================

  async function fetchGenome(acc) {
    const url = `${NCBI}/efetch.fcgi?db=nuccore&id=${acc}&rettype=fasta&retmode=text`;
    const res = await fetch(PROXY + encodeURIComponent(url));
    const txt = await res.text();

    const seq = txt
      .split("\n")
      .filter(l => !l.startsWith(">"))
      .join("")
      .toUpperCase();

    return seq;
  }

  async function loadGenomes() {
    if (!genomeList.length) return;

    setLoadingGenomes(true);
    const result = {};

    for (const g of genomeList) {
      try {
        const seq = await fetchGenome(g.accession);
        result[g.accession] = seq;
      } catch (err) {
        console.error("Error loading genome", g.accession);
      }
    }

    console.log("Loaded genomes:", result);
    setGenomeSequences(result);
    setLoadingGenomes(false);
  }

  useEffect(() => {
    loadGenomes();
  }, [genomeList]);

  // ================================
  // STEP 1: PARSE SITES
  // ================================

  function parseSites() {
    const arr = siteInput
      .split("\n")
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);

    setParsedSites(arr);

    setExpanded({ step1: false, step2: true, step3: false, step4: false });
  }

  // ================================
  // EXACT MATCH SEARCH
  // ================================

  function findExactMatches(seq, genomeSeq, accession) {
    const result = [];
    const len = seq.length;

    // forward
    let i = genomeSeq.indexOf(seq);
    while (i >= 0) {
      result.push({
        site: seq,
        accession,
        start: i,
        end: i + len,
        strand: "+",
        TF_type: "monomer",
        TF_function: "activator",
        techniques: [],
        selected: false,
      });
      i = genomeSeq.indexOf(seq, i + 1);
    }

    // reverse
    const rc = revComp(seq);
    let j = genomeSeq.indexOf(rc);
    while (j >= 0) {
      result.push({
        site: seq,
        accession,
        start: j,
        end: j + len,
        strand: "-",
        TF_type: "monomer",
        TF_function: "activator",
        techniques: [],
        selected: false,
      });
      j = genomeSeq.indexOf(rc, j + 1);
    }

    return result;
  }

  function runExact() {
    if (!parsedSites.length) return;

    setLoadingExact(true);
    const all = [];

    for (const s of parsedSites) {
      for (const [acc, seq] of Object.entries(genomeSequences)) {
        const f = findExactMatches(s, seq, acc);
        all.push(...f);
      }
    }

    console.log("Exact matches:", all);
    setExactMatches(all);
    setLoadingExact(false);

    setExpanded({ step1: false, step2: true, step3: true, step4: true });
  }

  // ================================
  // UI HELPERS
  // ================================

  function toggle(key) {
    setExpanded(s => ({ ...s, [key]: !s[key] }));
  }

  function toggleSelect(i) {
    setExactMatches(arr =>
      arr.map((m, idx) =>
        idx === i ? { ...m, selected: !m.selected } : m
      )
    );
  }

  function setField(i, field, val) {
    setExactMatches(arr =>
      arr.map((m, idx) =>
        idx === i ? { ...m, [field]: val } : m
      )
    );
  }

  function applyToSelected(field, value) {
    setExactMatches(arr =>
      arr.map(m =>
        m.selected ? { ...m, [field]: value } : m
      )
    );
  }

  // ================================
  // UI
  // ================================

  return (
    <div className="space-y-6">

      <h2 className="text-2xl font-bold">Step 4 – Reported sites</h2>

      {/* =========================== */}
      {/* STEP 1: INPUT & PARSE       */}
      {/* =========================== */}

      <Acordeon
  title="1. Enter reported sites"
  open={expanded.step1}
  toggle={() => toggle("step1")}
>
  {/* ---------- SITE TYPE ---------- */}

  <div className="flex flex-col space-y-3 mb-4">
    <label className="font-semibold text-sm">Site type</label>

    <label className="flex items-center space-x-2 text-sm cursor-pointer">
      <input
        type="radio"
        name="siteType"
        value="motif-associated"
        checked={siteType === "motif-associated"}
        onChange={e => setSiteType(e.target.value)}
      />
      <span>motif-associated (new motif)</span>
    </label>

    <label className="flex items-center space-x-2 text-sm cursor-pointer">
      <input
        type="radio"
        name="siteType"
        value="variable-motif-associated"
        checked={siteType === "variable-motif-associated"}
        onChange={e => setSiteType(e.target.value)}
      />
      <span>variable motif associated</span>
    </label>

    <label className="flex items-center space-x-2 text-sm cursor-pointer">
      <input
        type="radio"
        name="siteType"
        value="non-motif-associated"
        checked={siteType === "non-motif-associated"}
        onChange={e => setSiteType(e.target.value)}
      />
      <span>non-motif associated</span>
    </label>

    <a
      href="#"
      className="text-xs text-sky-400 hover:text-sky-300 underline"
    >
      [motif examples]
    </a>
  </div>

  {/* ---------- SITES TEXTAREA ---------- */}

  <label className="font-semibold text-sm">Sites</label>

  <textarea
    className="w-full h-36 bg-black/60 border border-gray-600 rounded p-2 text-sm"
    value={siteInput}
    onChange={e => setSiteInput(e.target.value)}
    placeholder="One site per line (e.g., AAGATTACATT)"
  />

  <button
    className="px-4 py-2 bg-blue-600 rounded mt-3"
    onClick={parseSites}
  >
    Parse
  </button>
</Acordeon>


      {/* =========================== */}
      {/* STEP 2: EXACT MATCHES       */}
      {/* =========================== */}

      <Acordeon
        title="2. Exact site matches"
        open={expanded.step2}
        toggle={() => toggle("step2")}
      >

        <button
          className="px-4 py-2 bg-blue-600 rounded"
          onClick={runExact}
          disabled={loadingExact || loadingGenomes}
        >
          {loadingExact ? "Searching..." : "Search exact matches"}
        </button>

        <div className="mt-2 text-sm text-gray-400">
          {exactMatches.length} matches found.
        </div>

      </Acordeon>

      {/* =========================== */}
      {/* STEP 3: INEXACT MATCHES     */}
      {/* =========================== */}

      <Acordeon
        title="3. Inexact matches (mismatches)"
        open={expanded.step3}
        toggle={() => toggle("step3")}
      >

        <div className="text-gray-400 italic">
          Not implemented yet
        </div>

      </Acordeon>

      {/* =========================== */}
      {/* STEP 4: ANNOTATION UI       */}
      {/* =========================== */}

      <Acordeon
        title="4. Annotate sites"
        open={expanded.step4}
        toggle={() => toggle("step4")}
      >

        {exactMatches.length === 0 ? (
          <p className="text-gray-400 italic text-sm">
            No matches found yet.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th></th>
                <th>Site</th>
                <th>TF-type</th>
                <th>TF-function</th>
              </tr>
            </thead>
            <tbody>
              {exactMatches.map((m, i) => (
                <tr key={i} className="border-t border-gray-700">
                  <td>
                    <input
                      type="checkbox"
                      checked={m.selected}
                      onChange={() => toggleSelect(i)}
                    />
                  </td>
                  <td>
                    <div className="font-mono">{m.site}</div>
                    <small className="text-gray-400">
                      {m.start}–{m.end} {m.strand} ({m.accession})
                    </small>
                  </td>

                  <td>
                    <select
                      value={m.TF_type}
                      onChange={e => setField(i, "TF_type", e.target.value)}
                      className="bg-black border border-gray-600 rounded p-1"
                    >
                      <option>monomer</option>
                      <option>dimer</option>
                      <option>multimer</option>
                    </select>
                  </td>

                  <td>
                    <select
                      value={m.TF_function}
                      onChange={e =>
                        setField(i, "TF_function", e.target.value)
                      }
                      className="bg-black border border-gray-600 rounded p-1"
                    >
                      <option>activator</option>
                      <option>repressor</option>
                    </select>
                  </td>

                </tr>
              ))}
            </tbody>
          </table>
        )}

        {exactMatches.some(m => m.selected) && (
          <div className="mt-3 space-x-2 text-xs">
            <button
              className="px-2 py-1 bg-sky-600 rounded"
              onClick={() => applyToSelected("TF_type", "monomer")}
            >
              Apply TF-type
            </button>
            <button
              className="px-2 py-1 bg-sky-600 rounded"
              onClick={() => applyToSelected("TF_function", "activator")}
            >
              Apply TF-function
            </button>
          </div>
        )}
      </Acordeon>

    </div>
  );
}


// ===========================================
// REUSABLE ACCORDION COMPONENT
// ===========================================
function Acordeon({ title, open, toggle, children }) {
  return (
    <div className="border border-gray-600 p-4 rounded bg-black/40">

      <div
        className="flex justify-between cursor-pointer"
        onClick={toggle}
      >
        <h3 className="text-xl font-semibold">{title}</h3>
        <span>{open ? "▲" : "▼"}</span>
      </div>

      {open && <div className="mt-4 space-y-4">{children}</div>}
    </div>
  );
}

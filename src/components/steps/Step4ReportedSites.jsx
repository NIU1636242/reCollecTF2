import { useState } from "react";
import { useCuration } from "../../context/CurationContext";

// --- utilities ---
function reverseComplement(seq) {
  const map = { A: "T", T: "A", C: "G", G: "C" };
  return seq
    .split("")
    .reverse()
    .map((n) => map[n] || "N")
    .join("");
}

function findExactMatches(genomeSeq, site) {
  const matches = [];
  const forward = site;
  const reverse = reverseComplement(site);

  // plus strand
  let idx = genomeSeq.indexOf(forward);
  while (idx !== -1) {
    matches.push({
      seq: forward,
      strand: "+",
      start: idx,
      end: idx + forward.length - 1,
    });
    idx = genomeSeq.indexOf(forward, idx + 1);
  }

  // minus strand
  idx = genomeSeq.indexOf(reverse);
  while (idx !== -1) {
    matches.push({
      seq: reverse,
      strand: "-",
      start: idx,
      end: idx + reverse.length - 1,
    });
    idx = genomeSeq.indexOf(reverse, idx + 1);
  }

  return matches;
}

export default function Step4ReportedSites() {
  const { genomeList } = useCuration();

  const [siteType, setSiteType] = useState("motif");
  const [inputText, setInputText] = useState("");
  const [results, setResults] = useState([]);

  async function handleSearch() {
    if (!inputText.trim()) return;

    const sites = inputText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    const output = [];

    for (const site of sites) {
      const allMatches = [];

      for (const g of genomeList) {
        if (!g.sequence) {
          console.warn("Genome has no sequence loaded:", g.accession);
          continue;
        }

        const matches = findExactMatches(g.sequence, site);

        allMatches.push({
          genome: g.accession,
          matches,
        });
      }

      output.push({
        site,
        genomes: allMatches,
      });
    }

    setResults(output);
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Step 4 – Reported sites</h2>

      {/* site type */}
      <div className="space-y-2">
        <label className="font-medium">Site type</label>

        <div className="flex gap-4 text-sm">
          <label>
            <input
              type="radio"
              checked={siteType === "motif"}
              onChange={() => setSiteType("motif")}
            />
            <span className="ml-1">motif-associated</span>
          </label>

          <label>
            <input
              type="radio"
              checked={siteType === "variable"}
              onChange={() => setSiteType("variable")}
            />
            <span className="ml-1">variable motif associated</span>
          </label>

          <label>
            <input
              type="radio"
              checked={siteType === "non"}
              onChange={() => setSiteType("non")}
            />
            <span className="ml-1">non-motif associated</span>
          </label>
        </div>
      </div>

      {/* input sequences */}
      <div>
        <label className="font-medium block mb-1">Sites</label>
        <textarea
          className="form-control w-full h-40"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="AAGATTACATT&#10;AAGATAACATT"
        />
      </div>

      <button className="btn" onClick={handleSearch}>
        Search matches
      </button>

      {/* results */}
      {results.length > 0 && (
        <div className="space-y-6">
          {results.map((r, i) => (
            <div key={i} className="border p-4 rounded bg-surface">
              <h3 className="font-semibold text-lg">{r.site}</h3>

              {r.genomes.map((g, j) => (
                <div key={j} className="ml-4 mt-2">
                  <p className="font-medium">{g.genome}</p>

                  {g.matches.length === 0 && (
                    <p className="text-sm text-muted">
                      No exact matches found.
                    </p>
                  )}

                  {g.matches.map((m, k) => (
                    <div
                      key={k}
                      className="text-sm border-b py-1 flex gap-4"
                    >
                      <span>{m.seq}</span>
                      <span>{m.strand}</span>
                      <span>
                        [{m.start} , {m.end}]
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

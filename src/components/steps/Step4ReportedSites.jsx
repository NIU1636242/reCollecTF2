import React, { useState, useEffect } from "react";
import { useCuration } from "../../context/CurationContext";
import genbankParser from "genbank-parser";

/* =======================
   HELPERS
======================= */
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

/* =======================
   MAIN COMPONENT
======================= */
export default function Step4ReportedSites() {
    const {
        genomeList,
        genomes,
        setGenomes,
        step4Data,
        setStep4Data,
        goToNextStep,
    } = useCuration();

    /* ---------- UI state ---------- */
    const [accordion, setAccordion] = useState({
        a1: true,
        a2: true,
        a3: false,
    });

    const toggleAcc = (k) =>
        setAccordion((p) => ({ ...p, [k]: !p[k] }));

    /* ---------- Data state ---------- */
    const [siteType, setSiteType] = useState("variable");
    const [rawSites, setRawSites] = useState("");
    const [sites, setSites] = useState([]);
    const [activeSite, setActiveSite] = useState(null);

    const [exactHits, setExactHits] = useState({});
    const [fuzzyHits, setFuzzyHits] = useState({});
    const [choice, setChoice] = useState({});
    const [showFuzzy, setShowFuzzy] = useState(false);

    /* =======================
       RESTORE STATE
    ======================= */
    useEffect(() => {
        if (!step4Data) return;

        setSiteType(step4Data.siteType || "variable");
        setRawSites(step4Data.rawSites || "");
        setSites(step4Data.sites || []);
        setExactHits(step4Data.exactHits || {});
        setFuzzyHits(step4Data.fuzzyHits || {});
        setChoice(step4Data.choice || {});
        setShowFuzzy(step4Data.showFuzzy || false);
        setActiveSite(step4Data.sites?.[0] || null);
    }, []);

    /* =======================
       LOAD GENOMES
    ======================= */
    useEffect(() => {
        if (!genomeList?.length) return;

        async function load() {
            const out = [];

            for (const g of genomeList) {
                try {
                    const fastaURL =
                        "https://corsproxy.io/?" +
                        encodeURIComponent(
                            `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=${g.accession}&rettype=fasta&retmode=text`
                        );
                    const fastaText = await (await fetch(fastaURL)).text();
                    const seq = fastaText
                        .replace(/>.*/g, "")
                        .replace(/[^ATCG]/gi, "")
                        .toUpperCase();

                    const gbURL =
                        "https://corsproxy.io/?" +
                        encodeURIComponent(
                            `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=${g.accession}&rettype=gbwithparts&retmode=text`
                        );
                    const gbText = await (await fetch(gbURL)).text();

                    const parsed = genbankParser(gbText)?.[0];
                    const locusMap = new Map();

                    (parsed?.features || []).forEach((f) => {
                        if (f.type !== "gene" && f.type !== "CDS") return;
                        const locus = f.notes?.locus_tag?.[0];
                        if (!locus) return;

                        if (!locusMap.has(locus)) {
                            locusMap.set(locus, {
                                locus,
                                gene: f.notes?.gene?.[0] || "",
                                function:
                                    f.notes?.function?.[0] ||
                                    f.notes?.product?.[0] ||
                                    "",
                                start: f.start,
                                end: f.end,
                            });
                        }
                    });

                    out.push({
                        acc: g.accession,
                        sequence: seq,
                        genes: Array.from(locusMap.values()).sort(
                            (a, b) => a.start - b.start
                        ),
                    });
                } catch (e) {
                    console.error(e);
                }
            }
            setGenomes(out);
        }

        load();
    }, [genomeList]);

    /* =======================
       GENE SEARCH
    ======================= */
    function findGenesForHit(acc, hitStart, hitEnd) {
        const genome = genomes.find((g) => g.acc === acc);
        if (!genome) return [];

        const genes = genome.genes;
        const dist = (g) =>
            hitEnd < g.start
                ? g.start - hitEnd
                : hitStart > g.end
                    ? hitStart - g.end
                    : 0;

        let best = null;
        let bestDist = Infinity;

        genes.forEach((g) => {
            const d = dist(g);
            if (d < bestDist) {
                bestDist = d;
                best = g;
            }
        });

        if (!best || bestDist > 150) return [];

        return genes
            .filter((g) => Math.abs(dist(g)) <= 150)
            .map((g) => ({
                locus: g.locus,
                gene: g.gene,
                function: g.function,
            }));
    }

    /* =======================
       EXACT SEARCH
    ======================= */
    function findExact() {
        const arr = rawSites
            .split(/\r?\n/)
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean);

        const all = {};
        const ch = {};

        arr.forEach((site) => {
            const rc = revComp(site);
            const L = site.length;
            all[site] = [];

            genomes.forEach((g) => {
                let i = g.sequence.indexOf(site);
                while (i !== -1) {
                    all[site].push({
                        site,
                        match: site,
                        start: i,
                        end: i + L - 1,
                        acc: g.acc,
                        strand: "+",
                    });
                    i = g.sequence.indexOf(site, i + 1);
                }

                let j = g.sequence.indexOf(rc);
                while (j !== -1) {
                    all[site].push({
                        site,
                        match: rc,
                        start: j,
                        end: j + L - 1,
                        acc: g.acc,
                        strand: "-",
                    });
                    j = g.sequence.indexOf(rc, j + 1);
                }
            });

            if (!all[site].length) all[site] = ["none"];
            ch[site] = null;
        });

        setSites(arr);
        setExactHits(all);
        setChoice(ch);
        setFuzzyHits({});
        setShowFuzzy(false);
        setActiveSite(arr[0] || null);
    }

    /* =======================
       FUZZY SEARCH
    ======================= */
    function findFuzzy(site) {
        const L = site.length;
        const rc = revComp(site);
        const found = [];

        genomes.forEach((g) => {
            for (let i = 0; i <= g.sequence.length - L; i++) {
                const sub = g.sequence.slice(i, i + L);
                if (mismatches(sub, site) > 0 && mismatches(sub, site) <= 2)
                    found.push({
                        site,
                        match: sub,
                        bars: buildBars(site, sub),
                        start: i,
                        end: i + L - 1,
                        acc: g.acc,
                        strand: "+",
                    });

                if (mismatches(sub, rc) > 0 && mismatches(sub, rc) <= 2)
                    found.push({
                        site,
                        match: sub,
                        bars: buildBars(rc, sub),
                        start: i,
                        end: i + L - 1,
                        acc: g.acc,
                        strand: "-",
                    });
            }
        });

        if (!found.length) found.push("none");

        setFuzzyHits((p) => ({ ...p, [site]: found }));
        setShowFuzzy(true);
        setAccordion((p) => ({ ...p, a3: true }));
    }

    /* =======================
       CONFIRM
    ======================= */
    function handleConfirm() {
        setStep4Data({
            siteType,
            rawSites,
            sites,
            exactHits,
            fuzzyHits,
            choice,
            showFuzzy,
        });
        goToNextStep();
    }

    /* =======================
       RENDER
    ======================= */
    return (
        <div className="space-y-8">
            {/* ---------- INPUT ---------- */}
            <div className="bg-surface border border-border rounded p-4">
                <textarea
                    className="form-control h-40"
                    value={rawSites}
                    onChange={(e) => setRawSites(e.target.value)}
                />
                <button className="btn mt-3" onClick={findExact}>
                    Save
                </button>
            </div>

            {/* ---------- SITE LIST ---------- */}
            {sites.length > 0 && (
                <div className="bg-surface border border-border rounded p-4">
                    <div className="mb-3 font-semibold">Binding sites</div>

                    {sites.map((s) => (
                        <button
                            key={s}
                            onClick={() => setActiveSite(s)}
                            className={`w-full text-left px-3 py-2 text-sm border-b last:border-0
                ${activeSite === s
                                    ? "bg-muted font-semibold text-accent"
                                    : "hover:bg-muted/50"
                                }`}
                        >
                            {s}
                        </button>
                    ))}
                </div>
            )}

            {/* ---------- DETAILS ---------- */}
            {activeSite && (
                <div className="bg-surface border border-border rounded p-4 space-y-4">
                    <div className="font-semibold text-accent">{activeSite}</div>

                    {(exactHits[activeSite] || []).map((hit, i) => {
                        if (hit === "none") return null;
                        const nearby = findGenesForHit(
                            hit.acc,
                            hit.start + 1,
                            hit.end + 1
                        );

                        return (
                            <label key={i} className="flex gap-2 text-xs">
                                <input
                                    type="radio"
                                    checked={choice[activeSite] === `ex-${i}`}
                                    onChange={() =>
                                        setChoice((p) => ({
                                            ...p,
                                            [activeSite]: `ex-${i}`,
                                        }))
                                    }
                                />
                                <div>
                                    <div className="font-mono">
                                        {hit.site} {hit.strand}[{hit.start + 1},{hit.end + 1}]{" "}
                                        {hit.acc}
                                    </div>

                                    {nearby.length > 0 && (
                                        <table className="mt-1 text-[11px]">
                                            <tbody>
                                                {nearby.map((g, idx) => (
                                                    <tr key={idx}>
                                                        <td className="pr-4">{g.locus}</td>
                                                        <td className="pr-4">{g.gene}</td>
                                                        <td>{g.function}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            </label>
                        );
                    })}

                    {/* NO VALID MATCH */}
                    <label className="flex gap-2 text-xs mt-2">
                        <input
                            type="radio"
                            checked={choice[activeSite] === "none"}
                            onChange={() => {
                                setChoice((p) => ({ ...p, [activeSite]: "none" }));
                                findFuzzy(activeSite);
                            }}
                        />
                        No valid match
                    </label>

                    {/* ---------- FUZZY (ONLY THIS SITE) ---------- */}
                    {showFuzzy && fuzzyHits[activeSite] && (
                        <div className="border-t pt-3 space-y-2">
                            {fuzzyHits[activeSite].map((hit, i) => {
                                if (hit === "none") return null;
                                return (
                                    <label key={i} className="flex gap-2 text-xs">
                                        <input
                                            type="radio"
                                            checked={choice[activeSite] === `fz-${i}`}
                                            onChange={() =>
                                                setChoice((p) => ({
                                                    ...p,
                                                    [activeSite]: `fz-${i}`,
                                                }))
                                            }
                                        />
                                        <pre className="font-mono leading-4">
                                            {hit.site}
                                            {hit.bars}
                                            {hit.match} {hit.strand}[{hit.start + 1},{hit.end + 1}] {hit.acc}
                                        </pre>
                                    </label>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            <button className="btn" onClick={handleConfirm}>
                Confirm and continue →
            </button>
        </div>
    );
}

import { useState, useEffect } from "react";
import { useCuration } from "../../context/CurationContext";

export default function Step1Publication() {
  const { publication, setPublication, goToNextStep } = useCuration();

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [article, setArticle] = useState(null);
  const [error, setError] = useState("");

  const PROXY = "https://corsproxy.io/?";
  const BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

  useEffect(() => {
    if (publication) {
      setArticle(publication);
      if (publication.pmid) setQuery(publication.pmid);
    }
  }, [publication]);

  // Normalitzar títol per comparar (sense puntuació, minúscules, espais simples)
  function normalizeTitle(str) {
    return String(str || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  //DOI → PMID helper
  async function lookupPMIDfromTitle(title) {
    const esearchUrl = `${BASE}/esearch.fcgi?db=pubmed&retmode=json&term=${encodeURIComponent(
      title
    )}`;
    const res = await fetch(PROXY + encodeURIComponent(esearchUrl));
    const json = await res.json();

    const pmid = json.esearchresult?.idlist?.[0];
    return pmid || null;
  }

  //Main search function
  async function handleSearch(e) {
    e.preventDefault();
    setError("");
    setArticle(null);

    if (!query.trim()) return;

    setLoading(true);

    try {
      let data = null;
      const q = query.trim();
      const isPMID = /^\d+$/.test(q);
      const isDOI = q.includes("/");

      //Search by PMID
      if (isPMID) {
        const url = `${BASE}/esummary.fcgi?db=pubmed&id=${q}&retmode=json`;
        const res = await fetch(PROXY + encodeURIComponent(url));
        const json = await res.json();
        const rec = json.result?.[q];

        if (rec) {
          data = {
            pmid: q,
            title: rec.title || "Title not available",
            authors: (rec.authors || []).map((a) => a.name).join(", "),
            journal: rec.fulljournalname || "Unknown",
            pubdate: rec.pubdate || "No date",
            doi: rec.elocationid || "No DOI",
          };
        }
      }

      //Search by DOI (CrossRef → PMID → ESummary)
      else if (isDOI) {
        const url = `https://api.crossref.org/works/${encodeURIComponent(q)}`;
        const res = await fetch(PROXY + encodeURIComponent(url));
        const json = await res.json();
        const rec = json.message;

        if (!rec) throw new Error("No CrossRef record found.");

        // Try to get PMID using PubMed title search
        const pmid = await lookupPMIDfromTitle(rec.title?.[0] || "");

        let pubmedRec = null;

        if (pmid) {
          const sumUrl = `${BASE}/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json`;
          const r2 = await fetch(PROXY + encodeURIComponent(sumUrl));
          const js2 = await r2.json();
          pubmedRec = js2.result?.[pmid];
        }

        data = {
          pmid: pmid || "—",
          title: rec.title?.[0] || "Title not available",
          authors: rec.author
            ?.map((a) => `${a.given || ""} ${a.family || ""}`)
            .join(", "),
          journal:
            pubmedRec?.fulljournalname ||
            rec["container-title"]?.[0] ||
            "Unknown",
          pubdate:
            pubmedRec?.pubdate ||
            rec.created?.["date-time"]?.split("T")[0] ||
            "No date",
          doi: q,
        };
      }

      //Search by TITLE (ESearch → ESummary, pero solo si el título coincide)
      else {
        const normQuery = normalizeTitle(q);

        // Buscamos por título (campo [ti])
        const esearchUrl = `${BASE}/esearch.fcgi?db=pubmed&retmode=json&term=${encodeURIComponent(
          q
        )}[ti]`;
        const r1 = await fetch(PROXY + encodeURIComponent(esearchUrl));
        const js1 = await r1.json();

        const pmid = js1.esearchresult?.idlist?.[0];
        if (!pmid) throw new Error("No PubMed matches found.");

        const esumUrl = `${BASE}/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json`;
        const r2 = await fetch(PROXY + encodeURIComponent(esumUrl));
        const js2 = await r2.json();

        const rec = js2.result?.[pmid];
        if (rec) {
          const normTitle = normalizeTitle(rec.title || "");

          // Si el títol retornat NO coincideix amb el que ha escrit l'usuari,
          // considerem que la cerca no és prou específica.
          if (!normTitle || normTitle !== normQuery) {
            throw new Error("No exact title match found.");
          }

          data = {
            pmid,
            title: rec.title || "Title not available",
            authors: (rec.authors || []).map((a) => a.name).join(", "),
            journal: rec.fulljournalname || "Unknown",
            pubdate: rec.pubdate || "No date",
            doi: rec.elocationid || "No DOI",
          };
        }
      }

      if (!data) throw new Error("No results found.");
      setArticle(data);
    } catch (e) {
      console.error(e);
      setError("Error searching the article.");
    } finally {
      setLoading(false);
    }
  }

  const handleConfirm = () => {
    if (article) {
      setPublication(article);
      goToNextStep();
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold mb-4">Step 1 – Publication</h2>

      <div className="flex gap-2">
        <input
          className="form-control"
          placeholder="PMID, DOI or Title"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn" onClick={handleSearch} disabled={loading}>
          {loading ? "Searching..." : "Search"}
        </button>
      </div>

      <a
        href="https://pubmed.ncbi.nlm.nih.gov/"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-sm text-blue-400 hover:text-blue-300 underline mt-1"
      >
        Search directly on PubMed
      </a>

      {error && <p className="text-red-400">{error}</p>}

      {article && (
        <div className="bg-surface border border-border rounded p-4 space-y-1">
          <h3 className="text-xl font-semibold">{article.title}</h3>
          <p>
            <strong>Authors:</strong> {article.authors}
          </p>
          <p>
            <strong>Journal:</strong> {article.journal}
          </p>
          <p>
            <strong>Date:</strong> {article.pubdate}
          </p>
          <p>
            <strong>PMID:</strong> {article.pmid}
          </p>
          <p>
            <strong>DOI:</strong> {article.doi}
          </p>

          <div className="pt-3">
            <button className="btn" onClick={handleConfirm}>
              Confirm and continue →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

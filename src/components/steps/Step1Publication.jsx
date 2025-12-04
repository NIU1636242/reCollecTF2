import { useState, useEffect } from "react";
import { useCuration } from "../../context/CurationContext";

export default function Step1Publication() {
  const { publication, setPublication, goToNextStep } = useCuration();

  const [query, setQuery] = useState(""); //input
  const [loading, setLoading] = useState(false); //si està buscant
  const [article, setArticle] = useState(null);
  const [error, setError] = useState("");

  const PROXY = "https://corsproxy.io/?";
  const BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

  useEffect(() => { //mostra dades al anar enrere
    if (publication) {
      setArticle(publication);
      if (publication.pmid) setQuery(publication.pmid);
    }
  }, [publication]);

  //Main search function (PMID o DOI SOLO)
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

      // Si no parece ni PMID ni DOI → error
      if (!isPMID && !isDOI) {
        throw new Error(
          "Please enter a valid PMID or DOI. For title searches use the PubMed link below."
        );
      }

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

      //Search by DOI directamente en PubMed (ESearch [doi] → ESummary)
      if (isDOI) {
        const esearchUrl = `${BASE}/esearch.fcgi?db=pubmed&retmode=json&term=${encodeURIComponent(
          q
        )}[doi]`;
        const r1 = await fetch(PROXY + encodeURIComponent(esearchUrl));
        const js1 = await r1.json();

        const pmid = js1.esearchresult?.idlist?.[0];
        if (!pmid) throw new Error("No PubMed matches found for this DOI.");

        const esumUrl = `${BASE}/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json`;
        const r2 = await fetch(PROXY + encodeURIComponent(esumUrl));
        const js2 = await r2.json();

        const rec = js2.result?.[pmid];
        if (rec) {
          data = {
            pmid,
            title: rec.title || "Title not available",
            authors: (rec.authors || []).map((a) => a.name).join(", "),
            journal: rec.fulljournalname || "Unknown",
            pubdate: rec.pubdate || "No date",
            doi: rec.elocationid || q || "No DOI",
          };
        }
      }

      if (!data) throw new Error("No results found.");
      setArticle(data);
    } catch (e) {
      console.error(e);
      setError("Error searching the article, please introduce a valid PubMedID or DOI.");
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
          placeholder="PMID or DOI"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn" onClick={handleSearch} disabled={loading}>
          {loading ? "Searching..." : "Search"}
        </button>
      </div>

      <a
        href="https://pubmed.ncbi.nlm.nih.gov/" //enllaç a pubmed
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-sm text-blue-400 hover:text-blue-300 underline mt-1"
      >
        Search article directly on PubMed
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

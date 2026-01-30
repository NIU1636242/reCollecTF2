// src/components/steps/Step1Publication.jsx
import { useState, useEffect } from "react";
import { useCuration } from "../../context/CurationContext";

// --------------------
// CORS-safe fetch helper (proxy fallback)
// --------------------
const PROXIES = [
  // AllOrigins (raw) is usually stable
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  // Isomorphic CORS proxy
  (u) => `https://cors.isomorphic-git.org/${u}`,
  // corsproxy.io
  (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
];

async function fetchJsonWithProxyFallback(url, { timeoutMs = 12000 } = {}) {
  let lastErr = null;

  for (const makeProxyUrl of PROXIES) {
    const proxiedUrl = makeProxyUrl(url);

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const res = await fetch(proxiedUrl, {
        method: "GET",
        signal: ctrl.signal,
        headers: { Accept: "application/json,text/plain,*/*" },
      });

      clearTimeout(t);

      // If proxy blocks (403/429/etc), try next proxy
      if (!res.ok) {
        lastErr = new Error(`Proxy HTTP ${res.status}`);
        continue;
      }

      // Some proxies return HTML error pages. Detect and skip.
      const text = await res.text();
      if (!text || text.toLowerCase().includes("<html")) {
        lastErr = new Error("Proxy returned HTML/empty response");
        continue;
      }

      // Try parse JSON
      try {
        return JSON.parse(text);
      } catch (e) {
        lastErr = new Error("Proxy returned non-JSON response");
        continue;
      }
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      continue;
    }
  }

  throw lastErr || new Error("All proxies failed");
}

// --------------------
// Component
// --------------------
export default function Step1Publication() {
  const { publication, setPublication, goToNextStep } = useCuration();

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [article, setArticle] = useState(null);
  const [error, setError] = useState("");

  const BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

  useEffect(() => {
    if (publication) {
      setArticle({
        ...publication,
        doi: normalizeDOI(publication.doi),
      });
      if (publication.pmid) setQuery(publication.pmid);
      else if (publication.doi) setQuery(publication.doi);
    }
  }, [publication]);

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

      // SEARCH BY PMID
      if (isPMID) {
        const url = `${BASE}/esummary.fcgi?db=pubmed&id=${q}&retmode=json`;
        const json = await fetchJsonWithProxyFallback(url);

        const rec = json?.result?.[q];
        if (!rec) throw new Error("PMID not found.");

        data = {
          pmid: q,
          title: rec.title || "Title not available",
          authors: (rec.authors || []).map((a) => a.name).join(", "),
          journal: rec.fulljournalname || "Unknown",
          pubdate: rec.pubdate || "No date",
          doi: normalizeDOI(rec.elocationid),
        };
      }

      // SEARCH BY DOI (PubMed → fallback CrossRef)
      if (!data && isDOI) {
        // Try PubMed first
        const esearchUrl = `${BASE}/esearch.fcgi?db=pubmed&retmode=json&term=${encodeURIComponent(
          q
        )}[doi]`;

        const js1 = await fetchJsonWithProxyFallback(esearchUrl);
        const pmid = js1?.esearchresult?.idlist?.[0];

        if (pmid) {
          const esumUrl = `${BASE}/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json`;
          const js2 = await fetchJsonWithProxyFallback(esumUrl);
          const rec = js2?.result?.[pmid];

          if (rec) {
            data = {
              pmid,
              title: rec.title || "Title not available",
              authors: (rec.authors || []).map((a) => a.name).join(", "),
              journal: rec.fulljournalname || "Unknown",
              pubdate: rec.pubdate || "No date",
              doi: normalizeDOI(rec.elocationid || q),
            };
          }
        }

        // Fallback: CrossRef (also via proxy fallback)
        if (!data) {
          const crUrl = `https://api.crossref.org/works/${encodeURIComponent(q)}`;
          const crJson = await fetchJsonWithProxyFallback(crUrl);
          const m = crJson?.message;

          if (!m) throw new Error("DOI not found in CrossRef.");

          data = {
            pmid: null,
            title: m.title?.[0] || "Title not available",
            authors: (m.author || [])
              .map((a) => `${a.family || ""} ${a.given || ""}`.trim())
              .filter(Boolean)
              .join(", "),
            journal: m["container-title"]?.[0] || "Unknown journal",
            pubdate: m.issued?.["date-parts"]?.[0]?.join("-") || "No date",
            doi: q,
          };
        }
      }

      // SEARCH BY TITLE (PubMed)
      if (!data && !isPMID && !isDOI) {
        const esearchUrl = `${BASE}/esearch.fcgi?db=pubmed&retmode=json&retmax=1&term=${encodeURIComponent(
          q
        )}[title]`;

        const js1 = await fetchJsonWithProxyFallback(esearchUrl);
        const pmid = js1?.esearchresult?.idlist?.[0];

        if (!pmid) {
          throw new Error("No PubMed articles found with this title.");
        }

        const esumUrl = `${BASE}/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json`;
        const js2 = await fetchJsonWithProxyFallback(esumUrl);
        const rec = js2?.result?.[pmid];

        data = {
          pmid,
          title: rec?.title || "Title not available",
          authors: (rec?.authors || []).map((a) => a.name).join(", "),
          journal: rec?.fulljournalname || "Unknown",
          pubdate: rec?.pubdate || "No date",
          doi: normalizeDOI(rec?.elocationid),
        };
      }

      if (!data) throw new Error("No results found.");
      setArticle(data);
    } catch (e) {
      console.error(e);

      const msg = String(e?.message || e);
      const looksLikeProxy =
        msg.includes("Proxy HTTP") ||
        msg.includes("All proxies failed") ||
        msg.includes("AbortError") ||
        msg.includes("HTML/empty") ||
        msg.includes("non-JSON");

      setError(
        looksLikeProxy
          ? "CORS/Proxy blocked temporarily. Try again in a moment."
          : "Error searching the article. Please enter a PMID, DOI or article title."
      );
    } finally {
      setLoading(false);
    }
  }

  function normalizeDOI(raw) {
    if (!raw) return "No DOI";
    const m = String(raw).match(/10\.\d{4,9}\/\S+/i);
    return m ? m[0] : raw;
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
          placeholder="PMID, DOI or article title"
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
            <strong>PMID:</strong> {article.pmid || "—"}
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

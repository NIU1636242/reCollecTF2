import { useState, useEffect } from "react";
import { useCuration } from "../../context/CurationContext"; //Per a guardar la publicació i el next step

export default function Step1Publication() {
  const { setPublication, goToNextStep } = useCuration();

  //Definimi 4 estats, per al PMID, missatge de càrrega, article o error
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [article, setArticle] = useState(null);
  const [error, setError] = useState("");

  const PROXY = "https://corsproxy.io/?";
  const BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

  useEffect(() => {
  if (publication) {
    setQuery(publication.pmid);  
    setArticle(publication);      //Mostra info guardada al tornar enrere
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

      if (/^\d+$/.test(query.trim())) {
        const url = `${BASE}/esummary.fcgi?db=pubmed&id=${query.trim()}&retmode=json`;
        const res = await fetch(PROXY + encodeURIComponent(url));
        const json = await res.json();
        const rec = json.result?.[query.trim()];
        if (rec) {
          data = {
            pmid: query.trim(),
            title: rec.title || "Títol no disponible",
            authors: (rec.authors || []).map((a) => a.name).join(", "),
            journal: rec.fulljournalname || "Desconegut",
            pubdate: rec.pubdate || "Sense data",
            doi: rec.elocationid || "Sense DOI",
          };
        }
      }

      if (!data) throw new Error("No s'han trobat resultats");
      setArticle(data);
    } catch (e) {
      console.error(e);
      setError("Error buscant l'article.");
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
          placeholder="PMID (37907733)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn" onClick={handleSearch} disabled={loading}>
          {loading ? "Buscant..." : "Buscar"}
        </button>
      </div>

      {error && <p className="text-red-400">{error}</p>}

      {article && (
        <div className="bg-surface border border-border rounded p-4 space-y-1">
          <h3 className="text-xl font-semibold">{article.title}</h3>
          <p><strong>Autors:</strong> {article.authors}</p>
          <p><strong>Revista:</strong> {article.journal}</p>
          <p><strong>Data:</strong> {article.pubdate}</p>
          <p><strong>PMID:</strong> {article.pmid}</p>
          <p><strong>DOI:</strong> {article.doi}</p>

          <div className="pt-3">
            <button
              className="btn"
              onClick={handleConfirm}
              disabled={!article.title}
            >
              Confirmar i continuar →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

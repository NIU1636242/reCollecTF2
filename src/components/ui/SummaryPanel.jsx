// src/components/ui/SummaryPanel.jsx
import { useCuration } from "../../context/CurationContext";

export default function SummaryPanel() {
  const {
    publication,
    tf,
    genomeList,
    uniprotList,
    refseqList,
    strainData,
    techniques,
  } = useCuration();

  const firstGenome = genomeList[0];
  const firstUniProt = uniprotList[0];
  const firstRefseq = refseqList[0];

  function techId(t) {
    return typeof t === "string"
      ? t
      : t?.ecoId || t?.eco || t?.EO_term || t?.id || t?.code || "";
  }

  function techName(t) {
    return typeof t === "string" ? "" : (t?.name || t?.label || "");
  }

  return (
    <div className="bg-gray-800 p-4 rounded-lg border border-gray-700 w-72">
      <h3 className="text-xl font-bold mb-3 text-accent">Summary</h3>

      {/* PUBLICATION */}
      <div className="mb-4">
        <h4 className="font-semibold text-sky-300">Publication</h4>
        {publication ? (
          <ul className="text-sm mt-1">
            <li>
              <strong>PMID:</strong> {publication.pmid}
            </li>
            <li>
              <strong>Title:</strong> {publication.title}
            </li>
            <li>
              <strong>DOI:</strong> {publication.doi}
            </li>
          </ul>
        ) : (
          <p className="text-sm text-gray-400">Not selected</p>
        )}
      </div>

      {/* TF INFORMATION */}
      <div className="mb-4">
        <h4 className="font-semibold text-sky-300">Selected TF</h4>
        {tf ? (
          <ul className="text-sm mt-1">
            <li>
              <strong>Name:</strong> {tf.name}
            </li>
            <li>
              <strong>Family:</strong> {tf.family || tf.family_name}
            </li>
          </ul>
        ) : (
          <p className="text-sm text-gray-400">Not selected</p>
        )}
      </div>

      {/* GENOME & ACCESSION NUMBERS */}
      <div className="mb-4">
        <h4 className="font-semibold text-sky-300">Genome & TF accessions</h4>
        {firstGenome || firstUniProt || firstRefseq ? (
          <ul className="text-sm mt-1 space-y-1">
            {firstGenome && (
              <li>
                <strong>Genome:</strong> {firstGenome.accession}
              </li>
            )}
            {firstUniProt && (
              <li>
                <strong>UniProt:</strong> {firstUniProt.accession}
              </li>
            )}
            {firstRefseq && (
              <li>
                <strong>RefSeq:</strong> {firstRefseq.accession}
              </li>
            )}
          </ul>
        ) : (
          <p className="text-sm text-gray-400">None added</p>
        )}
      </div>

      {/* EXPERIMENTAL METHODS (STEP3) */}
      <div className="mb-4">
        <h4 className="font-semibold text-sky-300">Experimental Methods</h4>
        {Array.isArray(techniques) && techniques.length > 0 ? (
          <ul className="text-sm mt-1 list-disc pl-4 space-y-1">
            {techniques.map((t, i) => {
              const id = techId(t);
              const name = techName(t);
              return (
                <li key={i}>
                  {name ? `${id} — ${name}` : id || "—"}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-gray-400">None added</p>
        )}
      </div>

      {/* PROMOTER / EXPRESSION FLAGS */}
      <div className="mb-2">
        <h4 className="font-semibold text-sky-300">Additional info</h4>
        <ul className="text-sm mt-1">
          <li>
            <strong>Promoter data:</strong>{" "}
            {strainData?.promoterInfo ? "Yes" : "No"}
          </li>
          <li>
            <strong>Expression data:</strong>{" "}
            {strainData?.expressionInfo ? "Yes" : "No"}
          </li>
        </ul>
      </div>
    </div>
  );
}

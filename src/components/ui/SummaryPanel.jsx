import { useCuration } from "../../context/CurationContext";

export default function SummaryPanel() {
  const { publication, tf } = useCuration();

  return (
    <div className="bg-gray-800 p-4 rounded-lg border border-gray-700 w-72">
      <h3 className="text-xl font-bold mb-3 text-accent">Resum</h3>

      {/* PUBLICATION */}
      <div className="mb-4">
        <h4 className="font-semibold text-sky-300">Publicació</h4>
        {publication ? (
          <ul className="text-sm mt-1">
            <li><strong>PMID:</strong> {publication.pmid}</li>
            <li><strong>Títol:</strong> {publication.title}</li>
            <li><strong>DOI:</strong> {publication.doi}</li>
          </ul>
        ) : (
          <p className="text-sm text-gray-400">No seleccionada</p>
        )}
      </div>

      {/* TF INFORMATION */}
      <div className="mb-4">
        <h4 className="font-semibold text-sky-300">TF seleccionat</h4>
        {tf ? (
          <ul className="text-sm mt-1">
            <li><strong>Nom:</strong> {tf.name}</li>
            <li><strong>Família:</strong> {tf.family || tf.family_name}</li>
            <li><strong>Descripció:</strong> {tf.description || "—"}</li>
          </ul>
        ) : (
          <p className="text-sm text-gray-400">No seleccionat</p>
        )}
      </div>

      {/*Afegir Step3, Step4, Step5*/}
    </div>
  );
}

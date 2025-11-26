import { useCuration } from "../../context/CurationContext";

export default function SummaryPanel() {
  const { publication, tf, techniques } = useCuration();

  return (
    <div className="bg-gray-800 p-4 rounded-lg border border-gray-700 w-72">
      <h3 className="text-xl font-bold mb-3 text-accent">Summary</h3>

      {/* PUBLICATION */}
      <div className="mb-4">
        <h4 className="font-semibold text-sky-300">Publication</h4>
        {publication ? (
          <ul className="text-sm mt-1">
            <li><strong>PMID:</strong> {publication.pmid}</li>
            <li><strong>Title:</strong> {publication.title}</li>
            <li><strong>DOI:</strong> {publication.doi}</li>
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
            <li><strong>Name:</strong> {tf.name}</li>
            <li><strong>Family:</strong> {tf.family || tf.family_name}</li>
          </ul>
        ) : (
          <p className="text-sm text-gray-400">Not selected</p>
        )}
      </div>

      {/* STEP 3 INFO */}
      <div className="mb-4">
        <h4 className="font-semibold text-sky-300">Experimental Methods</h4>
        {techniques && techniques.length > 0 ? (
          <ul className="text-sm list-disc pl-6">
            {techniques.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-400">None added</p>
        )}
      </div>
    </div>
  );
}

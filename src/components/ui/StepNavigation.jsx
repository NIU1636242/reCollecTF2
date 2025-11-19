//Mostra una barra amb els passos del pipeline

import { useCuration } from "../../context/CurationContext";

export default function StepNavigation() {
  const { step, setStep, publication } = useCuration();

  const steps = ["Publication","Genome & TF","Experimental Methods","Reported Sites","Annotation","Gene Regulation","Finalize"];

  const canGo = (index) => {
    if (index === 0) return true; //step1
    if (index === 1) return publication != null; //step2
    if (index === 2) return publication != null; //step3...
    return false; //Anar afegint els próxims steps
  };

  return ( //HTML visible
    <div className="flex gap-2 mb-6">
      {steps.map((label, i) => { //Obtenim el text i la posició 
        const current = i + 1 === step;
        const enabled = canGo(i);
        return (
          <button
            key={i}
            onClick={() => enabled && setStep(i + 1)}
            disabled={!enabled}
            className={`px-3 py-2 rounded font-semibold ${
              current
                ? "bg-sky-500 text-gray-900"
                : enabled
                ? "bg-gray-700 text-gray-200"
                : "bg-gray-800 text-gray-500 cursor-not-allowed"
            }`}
          >
            Step {i + 1}: {label}
          </button>
        );
      })}
    </div>
  );
}

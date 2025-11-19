//Mostra una barra amb els passos del pipeline

import { useCuration } from "../../context/CurationContext";

export default function StepNavigation() {
  const { currentStep, goToStep } = useCuration();

  const steps = [
    "Publication",
    "Genome & TF",
    "Experimental Methods",
    "Reported Sites",
    "Annotation",
    "Gene Regulation",
    "Finalize",
  ];

  return (
    <div className="mb-8">
      {/* Barra de pasos */}
      <div className="flex gap-2 mb-4">
        {steps.map((label, index) => {
          const stepNumber = index + 1;
          return (
            <button
              key={index}
              className={`px-4 py-2 rounded-md 
                ${currentStep === stepNumber ? "bg-accent text-black" : "bg-surface text-gray-300"}
              `}
              onClick={() => goToStep(stepNumber)}
              disabled={stepNumber > currentStep} 
            >
              Step {stepNumber}: {label}
            </button>
          );
        })}
      </div>

      {/* Botón de retroceso */}
      <div className="flex">
        <button
          className="btn"
          disabled={currentStep === 1}
          onClick={() => goToStep(currentStep - 1)}
        >
          ← Back
        </button>
      </div>
    </div>
  );
}

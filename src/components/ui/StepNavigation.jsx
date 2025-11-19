//Mostra una barra amb els passos del pipeline

import { useCuration } from "../../context/CurationContext";

export default function StepNavigation() {
  const { currentStep, goToStep } = useCuration();

  const steps = ["Publication","Genome & TF","Experimental Methods","Reported Sites","Annotation","Gene Regulation","Finalize"];

  return (
    <div className="mb-8">
      {/* Barra de passos */}
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
              // Només desbloqueja passos anteriors o el current
            >
              Step {stepNumber}: {label}
            </button>
          );
        })}
      </div>

      {/* Controls: back & next */}
      <div className="flex justify-between mt-4">
        <button
          className="btn"
          disabled={currentStep === 1}
          onClick={() => goToStep(currentStep - 1)}
        >
          ← Back
        </button>

        <button
          className="btn"
          disabled={currentStep === steps.length}
          onClick={() => goToStep(currentStep + 1)}
        >
          Next →
        </button>
      </div>
    </div>
  );
}

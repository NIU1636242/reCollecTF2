//Component principal que mostra per pantalla el necessari segons on estem.

import { useCuration } from "./context/CurationContext";
import StepNavigation from "./components/ui/StepNavigation"; //Component que pinta la barra dels passos
import Step1Publicacio from "./components/steps/Step1Publication";
import Step2GenomaTF from "./components/steps/Step2GenomeTF";

export default function App() {
  const { currentStep } = useCuration();

  return (
    <div className="max-w-5xl mx-auto p-8">
      <h1 className="text-4xl font-bold mb-6 text-accent">CURATION PIPELINE</h1>

      <StepNavigation />

      {currentStep === 1 && <Step1Publicacio />}
      {currentStep === 2 && <Step2GenomaTF />}

    </div>
  );
}

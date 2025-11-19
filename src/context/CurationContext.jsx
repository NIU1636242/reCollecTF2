//Cervell del pipeline. Guarda les dades a compartir entre components/steps. (Pas que s'està fent, publicació seleccionada...)

import { createContext, useContext, useState } from "react"; //Creem 3 eines de React

const CurationContext = createContext();

export function useCuration() { //Hook per a que desde tots els components puguem accedir a les dades de useCuration
  return useContext(CurationContext);
}

export function CurationProvider({ children }) {
  const [currentStep, setCurrentStep] = useState(1); //currentStep per a guardar el step en el que estem, al principi el 1
  const [publication, setPublication] = useState(null); //guardem la publication del step1, al principi null
  const [tf, setTf] = useState(null); //TF step2
  const [techniques, setTechniques] = useState(null); //tècniques step3

  const goToNextStep = () => setCurrentStep((s) => s + 1);
  const goToStep = (n) => setCurrentStep(n); 

  return (
    <CurationContext.Provider
      value={{
        currentStep,
        goToStep,
        goToNextStep,
        publication,
        setPublication,
        tf,
        setTf,
        techniques,
        setTechniques
      }}
    >
      {children}
    </CurationContext.Provider>
  );
}

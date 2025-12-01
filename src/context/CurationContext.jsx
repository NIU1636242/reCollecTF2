//Cervell del pipeline. Guarda les dades a compartir entre components/steps. (Pas que s'està fent, publicació seleccionada...)

import { createContext, useContext, useState } from "react"; //Creem 3 eines de React

const CurationContext = createContext();

export function useCuration() {
  //Hook per a que desde tots els components puguem accedir a les dades de useCuration
  return useContext(CurationContext);
}

export function CurationProvider({ children }) {
  const [currentStep, setCurrentStep] = useState(1); //currentStep per a guardar el step en el que estem, al principi el 1
  const [publication, setPublication] = useState(null); //guardem la publication del step1, al principi null

  // TF seleccionat o creat al Step2
  const [tf, setTf] = useState(null); //TF step2

  const [genomeList, setGenomeList] = useState([]); // [{accession, description, organism, existsInDB}]
  const [uniprotList, setUniprotList] = useState([]); // [{accession, description, organism, existsInDB, linkedRefseq}]
  const [refseqList, setRefseqList] = useState([]); // [{accession, description, organism, existsInDB}]

  const [strainData, setStrainData] = useState({
    sameStrainGenome: false,
    sameStrainTF: false,
    organismTFBindingSites: "",
    organismReportedTF: "",
    promoterInfo: false,
    expressionInfo: false,
  });

  // Tècniques del Step3
  const [techniques, setTechniques] = useState([]);

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
        setTechniques,
        genomeList,
        setGenomeList,
        uniprotList,
        setUniprotList,
        refseqList,
        setRefseqList,
        strainData,
        setStrainData,
      }}
    >
      {children}
    </CurationContext.Provider>
  );
}

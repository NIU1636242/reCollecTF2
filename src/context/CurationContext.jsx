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

  const [tf, setTf] = useState(null); //TF step2
  const [genomeList, setGenomeList] = useState([]); // llistes accession numbers
  const [uniprotList, setUniprotList] = useState([]);
  const [refseqList, setRefseqList] = useState([]);
  const [strainData, setStrainData] = useState({
    sameStrainGenome: false, //checkboxes
    sameStrainTF: false,
    organismTFBindingSites: "",
    organismReportedTF: "",
    promoterInfo: false,
    expressionInfo: false,
  });

  const [techniques, setTechniques] = useState([]); //Tècniques del Step3

  const [reportedSitesData, setReportedSitesData] = useState({ //Info step4
    siteType: "variable",
    rawSites: "",
    sites: [],
    exactHits: {},
    fuzzyHits: {},
    choice: {},
  });

  const [siteAnnotations, setSiteAnnotations] = useState({}); //Info step5


  const goToNextStep = () => setCurrentStep((s) => s + 1); //anar al següent pas
  const goToStep = (n) => setCurrentStep(n); //anar a qualsevol pas

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
        reportedSitesData,
        setReportedSitesData,
        siteAnnotations,
        setSiteAnnotations,
      }}
    >
      {children}
    </CurationContext.Provider>
  );
}

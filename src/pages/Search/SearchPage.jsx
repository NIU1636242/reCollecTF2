import { Outlet, useNavigate, useParams } from "react-router-dom";
import { useState } from "react";
import { SearchContext } from '@/contexts/SearchContext';
import SearchResults from "../../components/search/result/SearchResults";
import SearchStep from "../../components/search/general/SearchStep";

function SearchPage() {

    const navigate = useNavigate();
    const {step} = useParams();

    const isIntro = step === undefined;

    // State to save user selection between steps
    const [selectedData, setSelectedData] = useState({
        TF: [],
        Species: [],
        Techniques: [], 
    });

    // Data to be persisted across steps
    const [searchTerms, setSearchTerms] = useState(["","",["","",""]]);
 
    // ALL DATA
    const [allFamilies, setAllFamilies] = useState(new Map());

    const [allSpecies, setAllSpecies] = useState(new Map()); 
    const [allRoots, setAllRoots] = useState([]);

    const [allExpressionTechniques, setAllExpressionTechniques] = useState(new Map()); 
    const [allBindingTechniques, setAllBindingTechniques] = useState(new Map()); 
    const [allInSilicoTechniques, setAllInSilicoTechniques] = useState(new Map()); 

    // CURRENT DATA SHOWN
    const [families, setFamilies] = useState(new Map());

    const [species, setSpecies] = useState(new Map());
    const [roots, setRoots] = useState([]);

    const [expressionTechniques, setExpressionTechniques] = useState(new Map());
    const [bindingTechniques, setBindingTechniques] = useState(new Map()); 
    const [inSilicoTechniques, setInSilicoTechniques] = useState(new Map());
    const [categorySelected, setCategorySelected] = useState(["Select...", "Select...", "Select..."]);

    // AND/OR logic
    const [andOrTuple, setAndOrTuple] = useState([false, false]);

    // UTILS
    const [hasInitialized, setHasInitialized] = useState([false, false, [false, false, false]]);


    const startSearch = () => {
        navigate('/Search/1'); 
    }

    return (
        <SearchContext.Provider value={{ 
            selectedData, setSelectedData,
            searchTerms, setSearchTerms,
            allFamilies, setAllFamilies,
            allSpecies, setAllSpecies,
            allRoots, setAllRoots,
            roots, setRoots,
            allExpressionTechniques, setAllExpressionTechniques,
            allBindingTechniques, setAllBindingTechniques,
            allInSilicoTechniques, setAllInSilicoTechniques,
            families, setFamilies,
            species, setSpecies,
            expressionTechniques, setExpressionTechniques,
            bindingTechniques, setBindingTechniques,
            inSilicoTechniques, setInSilicoTechniques,
            andOrTuple, setAndOrTuple,
            hasInitialized, setHasInitialized,
            categorySelected, setCategorySelected
        }}>
        {isIntro ? (
        <div className="flex flex-col items-center justify-center text-center p-8 space-y-6">
            <h1 className="text-4xl font-bold">COLLECTF'S SEARCH METHOD</h1>
            <h2 className="text-2xl font-semibold">How does it work?</h2>
            <ul className="text-lg list-disc text-left space-y-2 mt-4">
            <li>STEP 1 – Select one or more <strong>Transcription Factors</strong>.</li>
            <li>STEP 2 – Select one or more <strong>Species</strong>.</li>
            <li>STEP 3 – Select a set of <strong>Experimental Techniques</strong> that should back the reported sites.</li>
            <li>RESULT – Data for the <strong>Reported Sites</strong> matching the search parameters.</li>
            </ul>
            <div className="flex gap-4 mt-6">
            <button className="btn px-6 py-2 text-lg " onClick={startSearch}>START SEARCH</button>
            </div>
        </div>
        ) : step === "1" ? (
        <SearchStep />
        ) : step === "2" ? (
        <SearchStep />
        ) : step === "3" ? (
        <SearchStep />
        ) : step === "4" ? (
        <SearchResults />
        ) : (
        <h1 className="text-center text-2xl font-bold text-red-500">Invalid step</h1>
        )}
        </SearchContext.Provider>
    );
}
export default SearchPage;
import { Outlet, useNavigate, useParams } from "react-router-dom";
import { useState } from "react";
import { SearchContext } from "../../components/contexts/SearchContext";
import "./SearchPage.css"
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
        navigate('/CollecTF/Search/1'); 
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
            <div className="search-page">
                <h1>Search in CollecTF</h1>
                <h2>How does it work?</h2>
                <ul>
                    <li>STEP 1 - Select a Transcription Factor Family or Instance</li>
                    <li>STEP 2 - Select a taxonomic unit (species)</li>
                    <li>STEP 3 - Select a set of experimental techniques that should back the reported sites.</li>
                    <li>RESULT - Individual (TF/species) and/or ensemble (multiTF/species) reports.</li>
                </ul>
                <button onClick={startSearch}>START SEARCHING</button>
                <button onClick={() => navigate('/CollecTF/')}>Back to HOME</button>
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
            <p>Invalid step</p>
        )}
        </SearchContext.Provider>
    );
}
export default SearchPage;
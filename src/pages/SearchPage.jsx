import { Outlet, useNavigate } from "react-router-dom";
import { useState } from "react";
import { SearchContext } from "../components/contexts/SearchContext";
import "./SearchPage.css"

function SearchPage() {

    const navigate = useNavigate();

    const [step, setStep] = useState(0);

    // State to save user selection between steps
    const [selectedData, setSelectedData] = useState({
        TF: [],
        Species: [],
        Techniques: [], 
      });

    const startSearch = () => {
        setStep(1);
        navigate('1');
    }

    return (
        <SearchContext.Provider value={{ selectedData, setSelectedData, step, setStep }}>
        {(step === 0) ? (
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
        ):(
        <Outlet />)}
        </SearchContext.Provider>
    );
}
export default SearchPage;
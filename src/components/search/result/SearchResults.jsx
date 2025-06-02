import SearchStep from "../general/SearchStep";
import { useSearch } from "../../contexts/SearchContext";
import ResultSummary from "./ResultSummary";

function SearchResults() {

    const {selectedData, setSelectedData } = useSearch();

    // Get results data

    //We have

    // selectedData.TF: Array of selected transcription factors
        //Something like: [ tfname1, tfname2, ... ]
    // selectedData.Species: Array of selected species
        // Something like: [ speciesId1, speciesId2, ... ]
    // selectedData.Techniques: Array of selected experimental techniques
        // Something like: [ catid-techniqueId1, catid-techniqueId2, ... ] -> need to remove catid

    //TODO: Use effect to fetch results based on selectedData

    //TODO: Print ResultSummary component for each result
    return (
        <>
            <ResultSummary />
        </>
    );
}
export default SearchResults;
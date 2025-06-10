import BackSearchButton from "./BackSearchButton";
import NextSearchButton from "./NextSearchButton";
import FinishSearchButton from "./FinishSearchButton";
import SearchParams from "./SearchParams";
import { useParams } from "react-router-dom";
import { useSearch } from "../../contexts/SearchContext";

function SearchStep() {

    const { step } = useParams();
    const searchStep = parseInt(step);

    const { selectedData, setSelectedData } = useSearch();

    return (
        <>
            <BackSearchButton />
            {(searchStep === 3) ? <FinishSearchButton selectedData={setSelectedData}/>             
            :
            <NextSearchButton />
            }

            <SearchParams 
                selectedData={selectedData} 
                setSelectedData={setSelectedData}
            />
        </>
    );
}
export default SearchStep;
import SearchParams from "./SearchParams";
import { useParams } from "react-router-dom";
import { useSearch } from '@/contexts/SearchContext';
import SearchProgressBar from "@/components/search/general/SearchProgressBar";

function SearchStep() {

    const { step } = useParams();
    const searchStep = parseInt(step);

    const { selectedData, setSelectedData } = useSearch();

    return (
        <>
            <div className="mb-6">
                <SearchProgressBar step={searchStep} selectedData={selectedData}/>
            </div>
            <SearchParams 
                selectedData={selectedData} 
                setSelectedData={setSelectedData}
                searchStep={searchStep}
            />
        </>
    );
}
export default SearchStep;
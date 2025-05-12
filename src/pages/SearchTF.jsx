import "./SearchTF.css"
import BackButton from "../components/BackButton";
import NextButton from "../components/NextButton";
import SearchBar from "../components/SearchBar";
import { useSearch } from "../components/contexts/SearchContext";

function SearchTF() {

    const {selectedData, setSelectedData, step, setStep} = useSearch();

    return (
        <>
            <SearchBar step={step} selectedData={selectedData} setSelectedData={setSelectedData} setStep={setStep}/>
            <BackButton step={step} setStep={setStep}/>
            <NextButton searchStep={step} setStep={setStep}/>
        </>
    );
}
export default SearchTF;
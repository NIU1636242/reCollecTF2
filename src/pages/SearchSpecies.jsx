//import "./SearchSpecies.css"
import BackButton from "../components/BackButton";
import NextButton from "../components/NextButton";

function SearchSpecies() {

    return (
        <>
        <BackButton/>
        <NextButton searchStep={2}/>
        </>
    );
}
export default SearchSpecies;
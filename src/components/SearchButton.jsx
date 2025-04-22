import { useNavigate } from "react-router-dom";
//import "./SearchButton.css";

function SearchButton() {

    const navigate = useNavigate();

    return (
      <button onClick={() => navigate("/CollecTF/Search")} className="search-button">
        SEARCH
      </button>
    );
  }

export default SearchButton;
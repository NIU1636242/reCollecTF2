import { useNavigate } from "react-router-dom";
//import "./SearchButton.css";

function SearchButton() {

    const navigate = useNavigate();

    return (
      <button onClick={() => navigate("/Search")} className="btn">
        SEARCH
      </button>
    );
  }

export default SearchButton;
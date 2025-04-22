import { useState } from 'react';
import SearchResults from './SearchResults';

function SearchBar({step, selectedData, setSelectedData, setStep}) {

    const [barContent, setBarContent] = useState("");

    const handleChange = (e) => {
        setBarContent(e.target.value);
    }

    return (
      <>
        <input
          type="text" 
          placeholder="Search..."
          value={barContent}
          onChange={handleChange}
        />
        <SearchResults
          searchTerm={barContent}
          step={step}
          selectedData={selectedData}
          setSelectedData={setSelectedData}
          setStep={setStep}
        />
      </>
    );
  }

export default SearchBar;
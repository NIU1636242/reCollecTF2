import React from 'react';
import SearchManagement from './SearchManagement';
import { useParams } from 'react-router-dom';
import { useSearch } from '../../contexts/SearchContext';

function SearchParams({ selectedData, setSelectedData}) {

    const { searchTerms, setSearchTerms, andOrTuple, setAndOrTuple, categorySelected, setCategorySelected  } = useSearch();

    const { step } = useParams();
    const searchStep = parseInt(step);
    const indexStep = searchStep - 1;

    const handleChange = (e) => {
        const newSearchTerms = [...searchTerms];
        newSearchTerms[indexStep] = e.target.value;
        setSearchTerms(newSearchTerms);
    }

    return (
      <>
        {(searchStep === 1 || searchStep === 2) && (
            <input
                className="form-control"
                type="text" 
                placeholder="Search..."
                value={searchTerms[indexStep]}
                onChange={handleChange}
            />
        )}
        {searchStep == 1 && (            
            <SearchManagement
                searchStep={searchStep}
                searchTerm={searchTerms[indexStep]}
                selectedData={selectedData}
                setSelectedData={setSelectedData}
            />)
        }
        {searchStep == 2 && (            
            <SearchManagement
                searchStep={searchStep}
                searchTerm={searchTerms[indexStep]}
                selectedData={selectedData}
                setSelectedData={setSelectedData}
            />)
        }
        {searchStep === 3 && (
          <>
            {[...Array(3)].map((_, techniqueSearchNumber) => (
              <React.Fragment key={techniqueSearchNumber}>
                <input
                className="form-control"
                type="text" 
                placeholder="Search..."
                value={searchTerms[indexStep][techniqueSearchNumber]}
                onChange={(e) => {
                    const newSearchTerms = [...searchTerms[indexStep]];
                    newSearchTerms[techniqueSearchNumber] = e.target.value;
                    setSearchTerms((prev) => {
                      const updated = [...prev];
                      updated[indexStep] = newSearchTerms;
                      return updated;
                    });
                }}
                />
                <select
                    className="form-control"
                    value={categorySelected[techniqueSearchNumber]}
                    onChange={(e) => {
                            const newCategorySelected = [...categorySelected];
                            newCategorySelected[techniqueSearchNumber] = e.target.value;
                            setCategorySelected(newCategorySelected);
                        }
                    }
                >
                    <option value="Select...">Select...</option>
                    <option value="Expression">Expression</option>
                    <option value="Binding">Binding</option>
                    <option value="In Silico">In Silico</option>
                </select>
                <SearchManagement
                    searchStep={searchStep}
                    searchTerm={searchTerms[indexStep][techniqueSearchNumber]}
                    selectedData={selectedData}
                    setSelectedData={setSelectedData}
                    techniqueSearchNumber={techniqueSearchNumber}
                    andOrTuple={andOrTuple}
                    setAndOrTuple={setAndOrTuple}
                    categorySelected={categorySelected[techniqueSearchNumber]}
                />
              </React.Fragment>
            ))}
          </>
        )}
      </>
    );
  }
export default SearchParams;
import React from 'react';
import SearchManagement from './SearchManagement';
import { useSearch } from '@/contexts/SearchContext';
import BackSearchButton from "./BackSearchButton";
import NextSearchButton from "./NextSearchButton";
import FinishSearchButton from "./FinishSearchButton";

function SearchParams({ selectedData, setSelectedData, searchStep}) {

    const { searchTerms, setSearchTerms, andOrTuple, setAndOrTuple, categorySelected, setCategorySelected  } = useSearch();
    const indexStep = searchStep - 1;

    const handleChange = (e) => {
        const newSearchTerms = [...searchTerms];
        newSearchTerms[indexStep] = e.target.value;
        setSearchTerms(newSearchTerms);
    }

    const handleAndOr = (techniqueSearchNumber, state) => {
        setAndOrTuple((prevState) => {
            const newTuple = [...prevState];
            newTuple[techniqueSearchNumber - 1] = state;
            return newTuple;
        });
    }

    return (
      <>
        {(searchStep === 1 || searchStep === 2) && (
            <div className="flex items-center gap-4 w-full">
                <input
                    className="form-control flex-grow w-4-5"
                    type="text" 
                    placeholder="Search..."
                    value={searchTerms[indexStep]}
                    onChange={handleChange}
                />
                <div className="flex gap-2">
                    <BackSearchButton />
                    <NextSearchButton />
                </div>    
            </div>
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
            {[0,1,2].map((techniqueSearchNumber) => (
                <React.Fragment key={techniqueSearchNumber}>
                        {(techniqueSearchNumber == 1 || techniqueSearchNumber == 2) && (         
                                <div className="flex justify-center gap-4 my-2">   
                                    <label className="flex items-center gap-2 text-xl">
                                        <input
                                            type="radio" 
                                            onChange = {() => handleAndOr(techniqueSearchNumber, true)}
                                            checked={andOrTuple[techniqueSearchNumber - 1]}
                                        />
                                        AND
                                    </label>

                                    <label className="flex items-center gap-2 text-xl">
                                        <input 
                                            type="radio" 
                                            onChange = {() => handleAndOr(techniqueSearchNumber, false)}
                                            checked={!andOrTuple[techniqueSearchNumber - 1]}
                                        />
                                        OR
                                    </label> 
                                </div>
                        )}
                        <div className="border border-gray-300 rounded-md p-4 mb-4">
                            <div className="flex items-center gap-4 w-full mb-2">
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
                            </div>
                            <select
                                className="form-control w-full"
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
                        </div>
                </React.Fragment>
                
            ))}
            <div className="flex justify-end gap-2 w-full ">
                <BackSearchButton />
                <FinishSearchButton selectedData={setSelectedData}/>
            </div>
          </>
        )}
      </>
    );
  }
  
export default SearchParams;
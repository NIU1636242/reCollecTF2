import { useState, useEffect } from 'react'
import { getTFWithFamilies } from '../db/queries/search'
import TfFamily from './TfFamily';

const SearchResults = ({ searchTerm, step, selectedData, setSelectedData, setStep }) => {
    
    const [families, setFamilies] = useState([]); // Initialize with an empty array

    // Fetch data when the component mounts
    useEffect(() => {
        let initFamiliesMap = new Map() //We use Map to avoid duplicates
        let initFamilies = [] //We use an array to store the final result because we need to pass it to the component

        getTFWithFamilies().then((res) => {
            res.forEach((row) => {
                if (!initFamiliesMap.has(row.family_id)) {
                    initFamiliesMap.set(row.family_id, {
                        family_name: row.family_name,
                        elements: []
                    })
                }
                initFamiliesMap.get(row.family_id).elements.push(row.element_name)
            })

            initFamiliesMap.forEach((value, key) => {
                initFamilies.push({
                    family_id: key,
                    family_name: value.family_name,
                    elements: value.elements
                })
            })
            console.log("initFamilies", initFamilies);
            
            setFamilies(initFamilies)
        })
        .catch((error) => {
            console.error("Error fetching TF names:", error);
        });
    }, []);

    

    useEffect(() => {
        const filteredTF = families.filter((tf) => {
            return tf.toLowerCase().includes(searchTerm.toLowerCase());
        });
        setFamilies(filteredTF);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchTerm]); 

    return (
        <>    
            {step === 1 && (
                <TfFamily families={families} setFamilies={setFamilies} searchTerm={searchTerm}/>
            )}
        </>
    );




}

export default SearchResults
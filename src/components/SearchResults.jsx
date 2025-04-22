import { useState, useEffect } from 'react'
import { getTFNames } from '../db/queries/search'

const SearchResults = ({ searchTerm, step, selectedData, setSelectedData, setStep }) => {
    
    const [shownTF, setShownTF] = useState([]); // Initialize with an empty array

    // Fetch data when the component mounts
    useEffect(() => {

        let tfNames = []

        getTFNames().then((res) => {
            res.forEach((tf) => {
                tfNames.push(tf.name)
                console.log(tf.name)
            })
            setShownTF(tfNames)
        })
        .catch((error) => {
            console.error("Error fetching TF names:", error);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    

    const testTF = async () => {
        await getTFNames().then((res) => {console.log(res[8])});
    }

    const handleChange = (e) => {
        // TO DO: When the user selects a TF, it should be added to the selectedData object
    }

    useEffect(() => {
        const filteredTF = shownTF.filter((tf) => {
            return tf.toLowerCase().includes(searchTerm.toLowerCase());
        });
        setShownTF(filteredTF);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchTerm]);    

    return (
        <>
            <button onClick={testTF}>TEST</button>
    
            {step === 1 && (
                <section>
                    {shownTF.map((tf) => (
                        <label key={tf}>
                            <input
                                type="checkbox"
                                id={tf}
                                value={tf}
                                onChange={handleChange}
                            />
                            {tf}
                        </label>
                    ))}
                </section>
            )}
        </>
    );




}

export default SearchResults
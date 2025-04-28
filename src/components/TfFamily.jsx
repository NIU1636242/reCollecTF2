import "./TfFamily.css"


const TfFamily = ({families}) => {

    const handleFamilyChange = (e) => {
        // TO DO: When the user selects a TF, it should be added to the selectedData object
    }

    const handleTfChange = (e) => {
        // TO DO: When the user selects a TF, it should be added to the selectedData object
    }

    //JSX
    return (
        <section>
            {families.map((family) => (
                <>
                <label key={family.family_id}>
                    <input
                    type="checkbox"
                    id={family.family_id}
                    value={family.family_id}
                    onChange={handleFamilyChange}
                    />
                    <strong>{family.family_name}</strong>
                </label>

                <ul>
                    {family.elements.map((tf, index) => (
                    <li key={index}>
                        <label>
                        <input
                            type="checkbox"
                            value={tf}
                            onChange={() => handleTfChange(family.family_id, tf)}
                        />
                        {tf}
                        </label>
                    </li>
                    ))}
                </ul>
                </>
            ))}
        </section>
    )

}


export default TfFamily
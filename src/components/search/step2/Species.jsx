import SpeciesNode from "./SpeciesNode"

const Species = ({species, setSpecies, allSpecies, setAllSpecies, roots, selectedData, setSelectedData}) => {

    return (
        <>
            {roots.map((root) => {
                return (
                    <SpeciesNode 
                        key={root.id}
                        node={root} 
                        species={species} 
                        setSpecies={setSpecies}
                        allSpecies={allSpecies}
                        setAllSpecies={setAllSpecies}
                        roots={roots}
                        selectedData={selectedData}
                        setSelectedData={setSelectedData}
                    />
                )
            })}
        </>
    )

}


export default Species
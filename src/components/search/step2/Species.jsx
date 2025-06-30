import SpeciesNode from "./SpeciesNode"

const Species = ({species, setSpecies, allSpecies, setAllSpecies, roots, selectedData, setSelectedData}) => {

    const rootEntries = Array.from(roots.entries());
    const itemsPerColumn = Math.ceil(rootEntries.length / 3);
    const col1 = rootEntries.slice(0, itemsPerColumn);
    const col2 = rootEntries.slice(itemsPerColumn, itemsPerColumn * 2);
    const col3 = rootEntries.slice(itemsPerColumn * 2);

    return (
        
        <div className="flex gap-8">
            {[col1, col2, col3].map((col, i) => (
                <div key={i} className="flex-1">
                    {col.map(([id, root]) => (
                        <SpeciesNode 
                            key={id}
                            node={root} 
                            species={species} 
                            setSpecies={setSpecies}
                            allSpecies={allSpecies}
                            setAllSpecies={setAllSpecies}
                            roots={roots}
                            selectedData={selectedData}
                            setSelectedData={setSelectedData}
                        />
                    ))}
                </div>
            ))}
        </div>
    )

}


export default Species
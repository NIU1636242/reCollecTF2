import TechniqueOptions from './TechniqueOptions';

const Technique = ({expressionTechniques, bindingTechniques, inSilicoTechniques, 
    setExpressionTechniques, setBindingTechniques, setInSilicoTechniques, 
    allExpressionTechniques, setAllExpressionTechniques, 
    allBindingTechniques, setAllBindingTechniques, 
    allInSilicoTechniques, setAllInSilicoTechniques,
    selectedData, setSelectedData,
    categorySelected, techniqueSearchNumber}) => {
    
    return (
        <>
            {categorySelected === "Select..." && (
                <div className="text-center mt-4 mb-4">
                    <p>Please select a category to see the techniques.</p>
                </div>
            )}

            {categorySelected === "Expression" && (
                <TechniqueOptions 
                    techniques={expressionTechniques} 
                    setTechniques={setExpressionTechniques} 
                    allTechniques={allExpressionTechniques}
                    setAllTechniques={setAllExpressionTechniques}
                    selectedData={selectedData} 
                    setSelectedData={setSelectedData} 
                    techniqueSearchNumber={techniqueSearchNumber}
                />
            )}
            {categorySelected === "Binding" && (
                <TechniqueOptions 
                    techniques={bindingTechniques} 
                    setTechniques={setBindingTechniques} 
                    allTechniques={allBindingTechniques}
                    setAllTechniques={setAllBindingTechniques}
                    selectedData={selectedData} 
                    setSelectedData={setSelectedData} 
                    techniqueSearchNumber={techniqueSearchNumber}
                />
            )}
            {categorySelected === "In Silico" && (
                <TechniqueOptions 
                    techniques={inSilicoTechniques} 
                    setTechniques={setInSilicoTechniques} 
                    allTechniques={allInSilicoTechniques}
                    setAllTechniques={setAllInSilicoTechniques}
                    selectedData={selectedData} 
                    setSelectedData={setSelectedData} 
                    techniqueSearchNumber={techniqueSearchNumber}
                />
            )}
        </>

    );
}

export default Technique;
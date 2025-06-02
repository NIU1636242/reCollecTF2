import TechniqueOptions from './TechniqueOptions';

const Technique = ({expressionTechniques, bindingTechniques, inSilicoTechniques, 
    setExpressionTechniques, setBindingTechniques, setInSilicoTechniques, 
    allExpressionTechniques, setAllExpressionTechniques, 
    allBindingTechniques, setAllBindingTechniques, 
    allInSilicoTechniques, setAllInSilicoTechniques,
    selectedData, setSelectedData,
    categorySelected}) => {
    
    return (
        <>
            {categorySelected === "Select..." && (
                <p>Please select a category to see the techniques.</p>
            )}

            {categorySelected === "Expression" && (
                <TechniqueOptions 
                    techniques={expressionTechniques} 
                    setTechniques={setExpressionTechniques} 
                    allTechniques={allExpressionTechniques}
                    setAllTechniques={setAllExpressionTechniques}
                    selectedData={selectedData} 
                    setSelectedData={setSelectedData} 
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
                />
            )}
        </>

    );
}

export default Technique;
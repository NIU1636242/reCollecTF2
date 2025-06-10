import Technique from './Technique';
import React from 'react';

const TechniqueOptions = ({techniques, setTechniques, allTechniques, setAllTechniques, selectedData, setSelectedData}) => {
    
    const handleCategoryChange = (e) => {

        //techniques : Map():

        // {
        //   1: { category_name: 1, category_techniques: [{id: 1, name: technique_1}, {id: 1, name: technique_1}] },
        //   2: { category_name: 2, category_techniques: [{id: 3, name: technique_3}, {id: 4, name: technique_4}] },
        //   3: { category_name: 3, category_techniques: [{id: 5, name: technique_5}, {id: 6, name: technique_6}] }
        // }

        //Where 1, 2, 3 is category_id (key in the Map)

        const categoryId = Number(e.target.value)
        const isChecked = e.target.checked
        const categoryTechniques = techniques.get(categoryId).category_techniques;
        const newTechniques = new Map(techniques);
        const newAllTechniques = new Map(allTechniques);
        const currentCategory = newTechniques.get(categoryId);

        if (!currentCategory) return;

        const newStatus = isChecked ? 'checked' : 'unchecked';

        newTechniques.set(categoryId, {
            ...currentCategory,
            status: newStatus,
            category_techniques: currentCategory.category_techniques.map(technique => ({
                ...technique,
                status: newStatus
            }))
        });

        newAllTechniques.set(categoryId, {
            ...currentCategory,
            status: newStatus,
            category_techniques: currentCategory.category_techniques.map(technique => ({
                ...technique,
                status: newStatus
            }))
        });

        if (isChecked) {
            categoryTechniques.forEach(technique => {
                setSelectedData((prevState) => {
                    return {
                        ...prevState,
                        Techniques: [...prevState.Techniques, `${categoryId}-${technique.id}`]
                    }
                })
            });
        }
        else {
            categoryTechniques.forEach(technique => {
                setSelectedData((prevState) => {
                    return {
                        ...prevState,
                        Techniques: prevState.Techniques.filter((item) => item !== `${categoryId}-${technique.id}`)
                    }
                })
            });
        }

        setTechniques(newTechniques);
        setAllTechniques(newAllTechniques);
    }

    const handleTechniqueChange = (e) => {
        const categoryId = Number(e.target.value.split('-')[0]);
        const techniqueId = Number(e.target.value.split('-')[1]);
        const isChecked = e.target.checked
        const newTechniques = new Map(techniques);
        const newAllTechniques = new Map(allTechniques);
                
        const currentCategory = newTechniques.get(categoryId);
        const newStatus = isChecked ? 'checked' : 'unchecked';

        newTechniques.set(categoryId, {
            ...currentCategory,
            category_techniques: currentCategory.category_techniques.map(technique =>
                technique.id === techniqueId ? { ...technique, status: newStatus } : technique
            )
        });

        newAllTechniques.set(categoryId, {
            ...currentCategory,
            category_techniques: currentCategory.category_techniques.map(technique =>
                technique.id === techniqueId ? { ...technique, status: newStatus } : technique
            )
        });

        const updatedCategory = newTechniques.get(categoryId);
        const allChecked = updatedCategory.category_techniques.every(technique => technique.status === 'checked');
        const allUnchecked = updatedCategory.category_techniques.every(technique => technique.status === 'unchecked');

        const newCategoryStatus = allChecked ? 'checked' : allUnchecked ? 'unchecked' : 'intermediate';
        
        newTechniques.set(categoryId, {
            ...updatedCategory,
            status: newCategoryStatus
        });

        newAllTechniques.set(categoryId, {
            ...updatedCategory,
            status: newCategoryStatus
        });

        setSelectedData((prevState) => {
            return {
                ...prevState,
                Techniques: isChecked
                    ? [...prevState.Techniques, `${categoryId}-${techniqueId}`]
                    : prevState.Techniques.filter((item) => item !== `${categoryId}-${techniqueId}`)
            };
        });
        
        setTechniques(newTechniques);
        setAllTechniques(newAllTechniques);
        
    }

    const toggleCategoryOpen = (categoryId) => {
        const newTechniques = new Map(techniques);
        const allNewTechniques = new Map(allTechniques);
        const currentCategory = newTechniques.get(categoryId);

        if (!currentCategory) return;

        newTechniques.set(categoryId, {
            ...currentCategory,
            isOpen: !currentCategory.isOpen
        });

        allNewTechniques.set(categoryId, {
            ...currentCategory,
            isOpen: !currentCategory.isOpen
        });

        setTechniques(newTechniques);
        setAllTechniques(allNewTechniques);
    }

    return (
        <section className='text-left'>            
            <ul className="list-none pl-16 ml-32">
                {Array.from(techniques.entries()).map(([categoryId, categoryData]) => (
                    <li className="my-2.5" key={categoryId}>
                        <span onClick={() => toggleCategoryOpen(categoryId)} className="cursor-pointer select-none">
                            {categoryData.isOpen ? '▾' : '▸'}
                        </span>
                        <label className="inline-flex items-center gap-2" key={categoryId}>
                            <span>
                                <input
                                    className="form-control"
                                    type="checkbox"
                                    id={categoryId}
                                    value={categoryId}
                                    checked={techniques.get(categoryId).status === 'checked'}
                                    ref= {(el) => {
                                        if (el) el.indeterminate = techniques.get(categoryId)?.status === 'intermediate';
                                    }}  
                                    onChange={handleCategoryChange}
                                />
                            </span>
                            <span>
                                <strong>{categoryData.category_name}</strong>
                            </span>
                        </label>

                        {categoryData.isOpen &&(
                            <ul className="list-none pl-16 ml-32">                    
                                {categoryData.category_techniques.map((technique) => (
                                    <li className="my-2.5" key={`${categoryId}-${technique.id}`}>
                                        <label className="inline-flex items-center gap-2">
                                            <input
                                                className="form-control"
                                                type="checkbox"
                                                id={`${categoryId}-${technique.id}`}
                                                value={`${categoryId}-${technique.id}`}
                                                checked={selectedData.Techniques.includes(`${categoryId}-${technique.id}`)}
                                                onChange={handleTechniqueChange}
                                            />
                                        {technique.name}
                                        </label>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    )


}

export default TechniqueOptions;
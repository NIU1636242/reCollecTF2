import { getNameAndFamilyIdFromTf } from "@/db/queries/search"
import React from "react"



const TfFamily = ({families, setFamilies, allFamilies, setAllFamilies, selectedData, setSelectedData}) => {

    //families : Map():

        // {
        //   1: { family_name: 1, family_elements: [{id: 1, name: tf_1}, {id: 2, name: tf_2}] },
        //   2: { family_name: 2, family_elements: [{id: 3, name: tf_3}, {id: 4, name: tf_4}] },
        //   3: { family_name: 3, family_elements: [{id: 5, name: tf_5}, {id: 6, name: tf_6}] }
        // }

    //Where 1, 2, 3 is family_id (key in the Map)

    const handleFamilyChange = (e) => {
        const familyId = Number(e.target.value)
        const isChecked = e.target.checked
        const familyElements = families.get(familyId).family_elements;
        const newFamilies = new Map(families);
        const newAllFamilies = new Map(allFamilies);
        const currentFamily = newFamilies.get(familyId);
        
        if (!currentFamily) return;

        const newStatus = isChecked ? 'checked' : 'unchecked';
        newFamilies.set(familyId, {
            ...currentFamily,
            status: newStatus,
            family_elements: currentFamily.family_elements.map(tf => ({
                ...tf,
                status: newStatus
            }))
        });

        newAllFamilies.set(familyId, {
            ...currentFamily,
            status: newStatus,
            family_elements: currentFamily.family_elements.map(tf => ({
                ...tf,
                status: newStatus
            }))
        });
        
        if (isChecked) {
            familyElements.forEach(tf => {
                setSelectedData((prevState) => {
                    return {
                        ...prevState,
                        TF: [...prevState.TF, {name: tf.name, id: tf.id}]
                    }
                })
            });
        }
        else {
            familyElements.forEach(tf => {
                setSelectedData((prevState) => {
                    return {
                        ...prevState,
                        TF: prevState.TF.filter((item) => item.id !== tf.id)
                    }
                })
            });
        }
        setFamilies(newFamilies);
        setAllFamilies(newAllFamilies);
    }

    const handleTfChange = async (e) => {
        const tfId = Number(e.target.value);
        const isChecked = e.target.checked;
        const newFamilies = new Map(families);
        const newAllFamilies = new Map(allFamilies);

        const res = await getNameAndFamilyIdFromTf(tfId);
        const familyId = res[0].family_id;
        const tfName = res[0].name;

        const currentFamily = newFamilies.get(familyId);
        const newStatus = isChecked ? 'checked' : 'unchecked';

        newFamilies.set(familyId, {
            ...currentFamily,
            family_elements: currentFamily.family_elements.map(tf =>
                tf.id === tfId ? { ...tf, status: newStatus } : tf
            )
        });

        newAllFamilies.set(familyId, {
            ...currentFamily,
            family_elements: currentFamily.family_elements.map(tf =>
                tf.id === tfId ? { ...tf, status: newStatus } : tf
            )
        });

        const updatedFamily = newFamilies.get(familyId);
        const allChecked = updatedFamily.family_elements.every(tf => tf.status === 'checked');
        const allUnchecked = updatedFamily.family_elements.every(tf => tf.status === 'unchecked');

        const newFamilyStatus = allChecked ? 'checked' : allUnchecked ? 'unchecked' : 'indeterminate';
    
        newFamilies.set(familyId, {
            ...updatedFamily,
            status: newFamilyStatus
        });

        newAllFamilies.set(familyId, {
            ...updatedFamily,
            status: newFamilyStatus
        });

        setSelectedData((prevState) => {
            return {
                ...prevState,
                TF: isChecked
                    ? [...prevState.TF, {name: tfName, id: tfId}]
                    : prevState.TF.filter((item) => item.id !== tfId)
            };
        });
        
        setFamilies(newFamilies);
        setAllFamilies(newAllFamilies);
    };

    const toggleFamilyOpen = (familyId) => {
        const newFamilies = new Map(families);
        const allNewFamilies = new Map(allFamilies);
        const currentFamily = newFamilies.get(familyId);

        if (!currentFamily) return;

        newFamilies.set(familyId, {
            ...currentFamily,
            isOpen: !currentFamily.isOpen
        });

        allNewFamilies.set(familyId, {
            ...currentFamily,
            isOpen: !currentFamily.isOpen
        });

        setFamilies(newFamilies);
        setAllFamilies(allNewFamilies);
    }

    const familyEntries = Array.from(families.entries());
    const itemsPerColumn = Math.ceil(familyEntries.length / 3);
    const col1 = familyEntries.slice(0, itemsPerColumn);
    const col2 = familyEntries.slice(itemsPerColumn, itemsPerColumn * 2);
    const col3 = familyEntries.slice(itemsPerColumn * 2);

    return (
        <section className='text-left'>
            <div className="flex gap-8">  
                {[col1, col2, col3].map((col, i) => (
                    <ul key={i} className="flex-1 list-none">  
                        {col.map(([familyId, familyData]) => (
                            <li className="my-2.5" key={familyId} >
                                <span onClick={() => toggleFamilyOpen(familyId)} className="cursor-pointer select-none">
                                    {familyData.isOpen ? '▾' : '▸'}
                                </span>
                                <label className="inline-flex items-center gap-2 whitespace-nowrap" key={familyId}>
                                    <span>
                                        <input
                                            className="form-control"
                                            type="checkbox"
                                            id={familyId}
                                            value={familyId}
                                            checked={families.get(familyId).status === 'checked'}
                                            ref= {(el) => {
                                                if (el) el.indeterminate = families.get(familyId)?.status === 'indeterminate';
                                            }}  
                                            onChange={handleFamilyChange}
                                        />
                                    </span>
                                    <span>
                                        <strong>{familyData.family_name}</strong>
                                    </span>
                                </label>

                                {familyData.isOpen && (
                                    <ul className="list-none pl-1 ml-10">                    
                                        {familyData.family_elements.map((tf) => (
                                        <li className="my-2.5" key={tf.id}>
                                            <label className="inline-flex items-center gap-2 whitespace-nowrap">
                                                <input
                                                    className="form-control"
                                                    type="checkbox"
                                                    id={tf.id}
                                                    value={tf.id}
                                                    checked={selectedData.TF.some(item => item.id === tf.id)}
                                                    onChange={handleTfChange}
                                                />
                                            {tf.name}
                                            </label>
                                        </li>
                                        ))}
                                    </ul>
                                )}
                            </li>
                        ))}
                    </ul>
                ))}
            </div>
        </section>
    )

}


export default TfFamily
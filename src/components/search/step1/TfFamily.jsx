import "./TfFamily.css"
import { getFamilyIdByTf } from "@/db/queries/search"
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
                        TF: [...prevState.TF, tf.id]
                    }
                })
            });
        }
        else {
            familyElements.forEach(tf => {
                setSelectedData((prevState) => {
                    return {
                        ...prevState,
                        TF: prevState.TF.filter((item) => item !== tf.id)
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

        const res = await getFamilyIdByTf(tfId);
        const familyId = res[0].family_id;

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

        const newFamilyStatus = allChecked ? 'checked' : allUnchecked ? 'unchecked' : 'intermediate';
    
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
                    ? [...prevState.TF, tfId]
                    : prevState.TF.filter((item) => item !== tfId)
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


    return (
        <section className='text-left'>    
            <ul>  
                {Array.from(families.entries()).map(([familyId, familyData]) => (
                    <li key={familyId} >
                        <span onClick={() => toggleFamilyOpen(familyId)} className="cursor-pointer select-none">
                            {familyData.isOpen ? '▾' : '▸'}
                        </span>
                        <label key={familyId}>
                            <span>
                                <input
                                    type="checkbox"
                                    id={familyId}
                                    value={familyId}
                                    checked={families.get(familyId).status === 'checked'}
                                    ref= {(el) => {
                                        if (el) el.indeterminate = families.get(familyId)?.status === 'intermediate';
                                    }}  
                                    onChange={handleFamilyChange}
                                />
                            </span>
                            <span>
                                <strong>{familyData.family_name}</strong>
                            </span>
                        </label>

                        {familyData.isOpen && (
                            <ul>                    
                                {familyData.family_elements.map((tf) => (
                                <li key={tf.id}>
                                    <label>
                                        <input
                                            type="checkbox"
                                            id={tf.id}
                                            value={tf.id}
                                            checked={selectedData.TF.includes(tf.id)}
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
        </section>
    )

}


export default TfFamily
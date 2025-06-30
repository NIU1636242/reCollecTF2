const SpeciesNode = ({node, species, setSpecies, allSpecies, setAllSpecies, roots, selectedData, setSelectedData}) => {

    //Structure looks like:
        // species = {
        //     parent_id: {
        //         status: '',
        //         children: [] // If full looks like: [{id: child_id, name: child_name}, ...]
        //     },
        //     ...
        // }
        // roots = [ {id: root_id, name: root_name}, ...]
    
    const handleChange = (e) => {
        const isChecked = e.target.checked;
        const newSpecies = new Map(species);
        const newAllSpecies = new Map(allSpecies);
        const terminalNodes = [];

        const updateChildren = (node, isChecked) => {
            const currentNode = newSpecies.get(node.id);
            if (!currentNode) return;

            const newStatus = isChecked ? 'checked' : 'unchecked';

            newSpecies.set(node.id, {
                ...currentNode,
                status: newStatus
            });

            newAllSpecies.set(node.id, {
                ...currentNode,
                status: newStatus
            });

            if (currentNode.children.length > 0) {
                currentNode.children.forEach((child) => {
                    updateChildren(child, isChecked);
                });
            } else {
                terminalNodes.push(node);
            }
        };

        const updateParents = (nodeId) => {
            for (let [parentId, parentNode] of newSpecies.entries()) {
                if (parentNode.children.some(child => child.id === nodeId)) {
                    const childStatuses = parentNode.children.map(child => newSpecies.get(child.id)?.status);
                    let newStatus = 'unchecked';

                    if (childStatuses.every(status => status === 'checked')) {
                        newStatus = 'checked';
                    } else if (childStatuses.every(status => status === 'unchecked')) {
                        newStatus = 'unchecked';
                    } else {
                        newStatus = 'indeterminate';
                    }

                    newSpecies.set(parentId, {
                        ...parentNode,
                        status: newStatus
                    });

                    newAllSpecies.set(parentId, {
                        ...parentNode,
                        status: newStatus
                    });

                    updateParents(parentId); // Recurse upward
                }
            }
        };

        // 1. Update children recursively
        updateChildren(node, isChecked);

        // 2. Update parents upward
        updateParents(node.id);        

        // 3. Update selectedData
        setSelectedData((prevState) => {
            const current = new Set(prevState.Species);
            if (isChecked) {
                terminalNodes.forEach((node) => current.add(node));
            } else {
                terminalNodes.forEach((node) => current.delete(node));
            }
            return {
                ...prevState,
                Species: [...current]
            };
        });
        
        setSpecies(newSpecies);        
        setAllSpecies(newAllSpecies);
    };

    const toggleNodeOpen = (id) => {
        const newSpecies = new Map(species);
        const currentNode = newSpecies.get(id);
        if (currentNode) {
            newSpecies.set(id, {
                ...currentNode,
                isOpen: !currentNode.isOpen
            });
            setSpecies(newSpecies);
        }
    }

    return (
        <section className='text-left'>
            <ul className="list-none">
                <li className="my-2.5">
                    {species.get(node.id).children.length !== 0 && (
                        <span onClick={() => toggleNodeOpen(node.id)} className="cursor-pointer select-none">
                            { species.get(node.id).isOpen  ? '▾' : '▸'}
                        </span>
                    )}
                    <label className="inline-flex items-center gap-2">
                        <span>
                            <input
                                className="form-control"
                                type="checkbox"
                                id={node.id}
                                value={node.id}
                                onChange={handleChange}
                                checked={species.get(node.id).status === 'checked'}
                                ref= {(el) => {
                                    if (el) el.indeterminate = species.get(node.id)?.status === 'indeterminate';
                                }}
                            >
                            </input>
                        </span>
                        <span>
                            <strong>{node.name}</strong>
                        </span>
                    </label>
                     <ul className="list-none pl-1 ml-7">
                        {species.get(node.id).isOpen && species.get(node.id).children.map((child) => {
                            return (
                                <SpeciesNode 
                                    key={child.id}
                                    node={child} 
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
                    </ul> 
                </li>
            </ul>      
        </section>    
    );
}

export default SpeciesNode;
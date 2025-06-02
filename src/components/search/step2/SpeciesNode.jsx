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
        const speciesId = node.id;
        const newSpecies = new Map(species);
        const newAllSpecies = new Map(allSpecies);
        const terminalNodes = [];

        const updateChildren = (nodeId, isChecked) => {
            const currentNode = newSpecies.get(nodeId);
            if (!currentNode) return;

            const newStatus = isChecked ? 'checked' : 'unchecked';

            newSpecies.set(nodeId, {
                ...currentNode,
                status: newStatus
            });

            newAllSpecies.set(nodeId, {
                ...currentNode,
                status: newStatus
            });

            if (currentNode.children.length > 0) {
                currentNode.children.forEach((child) => {
                    updateChildren(child.id, isChecked);
                });
            } else {
                terminalNodes.push(nodeId);
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
                        newStatus = 'intermediate';
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
        updateChildren(speciesId, isChecked);

        // 2. Update parents upward
        updateParents(speciesId);        

        // 3. Update selectedData
        setSelectedData((prevState) => {
            const current = new Set(prevState.Species);
            if (isChecked) {
                terminalNodes.forEach((id) => current.add(id));
            } else {
                terminalNodes.forEach((id) => current.delete(id));
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
        <section className='text-left ml-4'>
            <ul>
                <li>
                    <span onClick={() => toggleNodeOpen(node.id)} className="cursor-pointer select-none">
                            {species.get(node.id).isOpen ? '▾' : '▸'}
                    </span>
                    <label>
                        <span>
                            <input
                                type="checkbox"
                                id={node.id}
                                value={node.id}
                                onChange={handleChange}
                                checked={species.get(node.id).status === 'checked'}
                                ref= {(el) => {
                                    if (el) el.indeterminate = species.get(node.id)?.status === 'intermediate';
                                }}
                            >
                            </input>
                        </span>
                        <span>
                            <strong>{node.name}</strong>
                        </span>
                    </label>
                    <ul>
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
import { useEffect, useState } from 'react'
import { getTFWithFamilies, getTaxonomy, getExpTechniques } from '../../../db/queries/search'
import TfFamily from '../step1/TfFamily';
import Species from '../step2/Species';
import Technique from '../step3/Technique';
import { useSearch } from '@/contexts/SearchContext';

const SearchManagement = ({ searchStep, searchTerm, selectedData, setSelectedData, 
    techniqueSearchNumber, categorySelected}) => {

    const {
        // ALL DATA
        allFamilies,
        setAllFamilies,

        allSpecies,
        setAllSpecies,
        allRoots,
        setAllRoots,

        allExpressionTechniques,
        setAllExpressionTechniques,

        allBindingTechniques,
        setAllBindingTechniques,

        allInSilicoTechniques,
        setAllInSilicoTechniques,

        // CURRENT DATA SHOWN
        families,
        setFamilies,

        species,
        setSpecies,
        roots,
        setRoots,

        expressionTechniques,
        setExpressionTechniques,

        bindingTechniques,
        setBindingTechniques,

        inSilicoTechniques,
        setInSilicoTechniques,

        hasInitialized,
        setHasInitialized
    } = useSearch();

    const [loading, setLoading] = useState(false);

    // Fetch data when the component mounts
    useEffect(() => {           
        
        let loadingTimeout = null;
        
        if (searchStep === 1 && !hasInitialized[0]) { 

            let hasLoaded = false;
            loadingTimeout = setTimeout(() => {
                if(!hasLoaded) {
                    setLoading(true);
                }
            }, 500); // Show loading after 0.5 seconds

            //families : Map():

                // {
                //   1: { family_name: 1, family_elements: [{id: 1, name: tf_1}, {id: 2, name: tf_2}] },
                //   2: { family_name: 2, family_elements: [{id: 3, name: tf_3}, {id: 4, name: tf_4}] },
                //   3: { family_name: 3, family_elements: [{id: 5, name: tf_5}, {id: 6, name: tf_6}] }
                // }

            //Where 1, 2, 3 is family_id (key in the Map)

            let initFamilies = new Map() //We use Map to avoid duplicates
            

            getTFWithFamilies().then((res) => {
                res.forEach((row) => {
                    if (!initFamilies.has(row.family_id)) {
                        initFamilies.set(row.family_id, {
                            status: 'unchecked', // 'unchecked', 'checked', 'indeterminate'
                            isOpen: false,
                            family_name: row.family_name,
                            family_elements: []
                        })
                    }
                    initFamilies.get(row.family_id).family_elements.push({id: row.element_id, name: row.element_name, status: 'unchecked'})

                })
 
                setFamilies(initFamilies)
                setAllFamilies(initFamilies)
                hasLoaded = true;
                clearTimeout(loadingTimeout);
                setLoading(false);
                setHasInitialized((prev) => {
                    const newInit = [...prev];
                    newInit[0] = true; 
                    return newInit;
                });
            })
            .catch((error) => {
                console.error("Error fetching TF names:", error);
            });
        }
        else if (searchStep === 2 && !hasInitialized[1]) {

            let hasLoaded = false;
            loadingTimeout = setTimeout(() => {
                if(!hasLoaded) {
                    setLoading(true);
                }
            }, 500); // Show loading after 0.5 seconds


            let initTaxonomyMap = new Map() //We use Map to avoid duplicates
            let initRoots = []
            
            getTaxonomy().then((res) => { //This returns all the taxonomy nodes ordered by parent_id
                res.forEach((node) => {
                    if (!initTaxonomyMap.has(node.id)) {
                        initTaxonomyMap.set(node.id, {
                            status: 'unchecked', // 'unchecked', 'checked', 'indeterminate'
                            children: []
                        }) // Key: parent_id, Value: array of children
                    }
                    if (node.parent_id) {
                        initTaxonomyMap.get(node.parent_id).children.push({
                            id: node.id,
                            name: node.name
                        })
                    }
                    else {
                        initRoots.push({id: node.id, name: node.name})
                    }
                })

                initTaxonomyMap.forEach((value) => {
                    if (value.children.length !== 0) {
                        value.isOpen = false;
                    }
                });
                
                    //Structure looks like:
                    // species = {
                    //     parent_id: {
                    //         status: '',
                    //         children: [] // If full looks like: [{id: child_id, name: child_name}, ...]
                    //         isOpen: false // If it has children
                    //     },
                    //     ...
                    // }
                    // roots = [ {id: root_id, name: root_name}, ...]

                setSpecies(initTaxonomyMap)
                setAllSpecies(initTaxonomyMap)
                setRoots(initRoots) 
                setAllRoots(initRoots) 
                hasLoaded = true;
                clearTimeout(loadingTimeout);
                setLoading(false)
                setHasInitialized((prev) => {
                    const newInit = [...prev];
                    newInit[1] = true; 
                    return newInit;
                });
            })
            .catch((error) => {
                console.error("Error fetching Species names:", error);
            });
        }
        else if (searchStep === 3 && !hasInitialized[2][techniqueSearchNumber]) {

            let hasLoaded = false;
            loadingTimeout = setTimeout(() => {
                if(!hasLoaded) {
                    setLoading(true);
                }
            }, 500); // Show loading after 0.5 seconds

            let initExpTechniques = new Map()
            let initBindingTechniques = new Map()
            let initInSilicoTechniques = new Map()

            getExpTechniques().then((res) => {
                res.forEach((row) => {
                    switch (row.type) {
                        case 'expression':
                            if (!initExpTechniques.has(row.category_id)) {
                                initExpTechniques.set(row.category_id, {
                                    status: 'unchecked', // 'unchecked', 'checked', 'indeterminate'
                                    isOpen: false,
                                    category_name: row.category_name,
                                    category_techniques: []
                                })
                            }   
                            initExpTechniques.get(row.category_id).category_techniques.push({id: row.id, name: row.technique_name, status: 'unchecked'})
                            break;
                        case 'binding':
                            if (!initBindingTechniques.has(row.category_id)) {
                                initBindingTechniques.set(row.category_id, {
                                    status: 'unchecked', // 'unchecked', 'checked', 'indeterminate'
                                    isOpen: false,
                                    category_name: row.category_name,
                                    category_techniques: []
                                })
                            }
                            initBindingTechniques.get(row.category_id).category_techniques.push({id: row.id, name: row.technique_name, status: 'unchecked'})
                            break;
                        case 'insilico':
                            if (!initInSilicoTechniques.has(row.category_id)) {
                                initInSilicoTechniques.set(row.category_id, {
                                    status: 'unchecked', // 'unchecked', 'checked', 'indeterminate'
                                    isOpen: false,
                                    category_name: row.category_name,
                                    category_techniques: []
                                })
                            }
                            initInSilicoTechniques.get(row.category_id).category_techniques.push({id: row.id, name: row.technique_name, status: 'unchecked'})
                            break;
                        default:
                            console.warn(`Unknown technique type: ${row.type}`);
                            break;
                        }
                    
                })

                setExpressionTechniques(initExpTechniques)
                setBindingTechniques(initBindingTechniques)
                setInSilicoTechniques(initInSilicoTechniques)
                setAllExpressionTechniques(initExpTechniques)
                setAllBindingTechniques(initBindingTechniques)
                setAllInSilicoTechniques(initInSilicoTechniques)
                hasLoaded = true;
                clearTimeout(loadingTimeout);
                setLoading(false)
                setHasInitialized((prev) => {
                    const newInit = [...prev];
                    newInit[2][techniqueSearchNumber] = true; 
                    return newInit;
                });
            })
            .catch((error) => {
                console.error("Error fetching Techniques names:", error);
            });
        }    
        
        return () => {if (loadingTimeout) {clearTimeout(loadingTimeout)};}
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (searchStep == 1) {
                            
            if (searchTerm.length === 0) {
                setFamilies(allFamilies);
                return;
            }

            const filteredFamilies = new Map();

            allFamilies.forEach((value, key) => {        
                
                if (value.status === 'checked' || value.status === 'indeterminate') {
                    filteredFamilies.set(key, {
                        status: value.status,
                        isOpen: true,
                        family_name: value.family_name,
                        family_elements: value.family_elements
                    });
                }
                else {
                    const filteredFamily = value.family_name.toLowerCase().includes(searchTerm.toLowerCase());                
                    if (filteredFamily && searchTerm.length > 0) {                    
                        filteredFamilies.set(key, {
                            status: value.status,
                            isOpen: true,
                            family_name: value.family_name,
                            family_elements: value.family_elements
                        });
                    }
                    else {
                        const filteredTf = value.family_elements.filter((tf) => 
                            tf.name.toLowerCase().includes(searchTerm.toLowerCase())
                        );
                        if (filteredTf.length > 0) {
                            filteredFamilies.set(key, {
                                status: value.status,
                                isOpen: true,
                                family_name: value.family_name,
                                family_elements: filteredTf
                            });
                        }
                    }
                }
            });
            setFamilies(filteredFamilies);
            return;
        }
        if (searchStep === 2) {

            if(searchTerm.length === 0) {
                setSpecies(allSpecies);
                setRoots(allRoots);
                return;
            }
            
            const filteredSpecies = new Map();
            const filteredRoots = [];

            function filterTaxonomy(node, parentMatches, searchTerm) {
                const term = searchTerm.toLowerCase();
                const selfMatches = node.name.toLowerCase().includes(term);
                const fullNode = allSpecies.get(node.id); 
                let filteredChildren = [];

                if (!fullNode) return null;

                // CASE 1: Node is already selected
                if (fullNode.status === 'checked' || fullNode.status === 'indeterminate') {
                    filteredSpecies.set(node.id, {
                        status: fullNode.status,
                        isOpen: true,
                        children: fullNode.children.map(c => ({ id: c.id, name: c.name }))
                    });

                    fullNode.children.forEach(child => {
                        filterTaxonomy({ id: child.id, name: child.name }, true, searchTerm);
                    });

                    return { id: node.id, name: node.name };
                }

                // CASE 1: Parent or direct match
                if (selfMatches || parentMatches) {
                    filteredSpecies.set(node.id, {
                        status: fullNode.status,
                        isOpen: true,
                        children: fullNode.children.map(c => ({ id: c.id, name: c.name }))
                    });

                    fullNode.children.forEach(child => {
                        filterTaxonomy({ id: child.id, name: child.name }, true, searchTerm);
                    });

                    return { id: node.id, name: node.name };
                }

                // CASE 2: No match, must check children
                if (fullNode.children.length === 0) {
                    // No children, so no match
                    return null;
                }
                filteredChildren = fullNode.children
                    .map(child => filterTaxonomy({ id: child.id, name: child.name }, false, searchTerm))
                    .filter(c => c !== null);

                if (filteredChildren.length > 0) {
                    filteredSpecies.set(node.id, {
                        status: fullNode.status,
                        isOpen: true,
                        children: filteredChildren.map(c => ({ id: c.id, name: c.name }))
                    });

                    return { id: node.id, name: node.name };
                }

                // CASE 3: No match at all
                return null;
            }

            allRoots.forEach(root => {
                const result = filterTaxonomy(root, false, searchTerm);
                if (result) {
                    filteredRoots.push({ id: result.id, name: result.name });
                }
            });
            setSpecies(filteredSpecies);
            setRoots(filteredRoots);
            return;
        }
        else if (searchStep == 3) {

            if(searchTerm.length === 0) {
                if (categorySelected === 'Expression') { 
                    setExpressionTechniques(allExpressionTechniques);
                }
                else if (categorySelected === 'Binding') {
                    setBindingTechniques(allBindingTechniques);
                }
                else if (categorySelected === 'In Silico') {
                    setInSilicoTechniques(allInSilicoTechniques);
                }
                return;
            }

            if (categorySelected === 'Expression') {  
                const filteredExpressionTechniques = new Map();
                allExpressionTechniques.forEach((value, key) => {
                    if (value.status === 'checked' || value.status === 'indeterminate') {
                        filteredExpressionTechniques.set(key, {
                            status: value.status,
                            isOpen: true,
                            category_name: value.category_name,
                            category_techniques: value.category_techniques
                        });
                    }
                    else {
                        const filteredCategory = value.category_name.toLowerCase().includes(searchTerm.toLowerCase());
                        if (filteredCategory) {
                            filteredExpressionTechniques.set(key, {
                                status: value.status,
                                isOpen: true,
                                category_name: value.category_name,
                                category_techniques: value.category_techniques
                            });
                        }
                        else {
                            const filteredTechniques = value.category_techniques.filter((technique) => 
                                technique.name.toLowerCase().includes(searchTerm.toLowerCase())
                            );
                            if (filteredTechniques.length > 0) {
                                filteredExpressionTechniques.set(key, {
                                    status: value.status,
                                    isOpen: true,
                                    category_name: value.category_name,
                                    category_techniques: filteredTechniques
                                });
                            }
                        }
                    }
                });
                setExpressionTechniques(filteredExpressionTechniques);
            }
            else if (categorySelected === 'Binding') {
                const filteredBindingTechniques = new Map();
                allBindingTechniques.forEach((value, key) => {
                    if (value.status === 'checked' || value.status === 'indeterminate') {
                        filteredBindingTechniques.set(key, {
                            status: value.status,
                            isOpen: true,
                            category_name: value.category_name,
                            category_techniques: value.category_techniques
                        });
                    }
                    else {
                        const filteredCategory = value.category_name.toLowerCase().includes(searchTerm.toLowerCase());
                        if (filteredCategory) {
                            filteredBindingTechniques.set(key, {
                                status: value.status,
                                isOpen: true,
                                category_name: value.category_name,
                                category_techniques: value.category_techniques
                            });
                        }
                        else {
                            const filteredTechniques = value.category_techniques.filter((technique) => 
                                technique.name.toLowerCase().includes(searchTerm.toLowerCase())
                            );
                            if (filteredTechniques.length > 0) {
                                filteredBindingTechniques.set(key, {
                                    status: value.status,
                                    isOpen: true,
                                    category_name: value.category_name,
                                    category_techniques: filteredTechniques
                                });
                            }
                        }
                    }
                });
                setBindingTechniques(filteredBindingTechniques);
            }
            else if (categorySelected === 'In Silico') {
                const filteredInSilicoTechniques = new Map();
                allInSilicoTechniques.forEach((value, key) => {
                    if (value.status === 'checked' || value.status === 'indeterminate') {
                        filteredInSilicoTechniques.set(key, {
                            status: value.status,
                            isOpen: true,
                            category_name: value.category_name,
                            category_techniques: value.category_techniques
                        });
                    }
                    else {
                        const filteredCategory = value.category_name.toLowerCase().includes(searchTerm.toLowerCase());
                        if (filteredCategory) {
                            filteredInSilicoTechniques.set(key, {
                                status: value.status,
                                isOpen: true,
                                category_name: value.category_name,
                                category_techniques: value.category_techniques
                            });
                        }
                        else {
                            
                            const filteredTechniques = value.category_techniques.filter((technique) => 
                                technique.name.toLowerCase().includes(searchTerm.toLowerCase())
                            );
                            if (filteredTechniques.length > 0) {
                                filteredInSilicoTechniques.set(key, {
                                    status: value.status,
                                    isOpen: true,
                                    category_name: value.category_name,
                                    category_techniques: filteredTechniques
                                });
                            }
                        }
                    }
                });
                setInSilicoTechniques(filteredInSilicoTechniques);
            }
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchTerm]); 

    return (
        <>
            { loading ? (
                    <div className="animate-pulse text-gray-500 font-semibold text-2xl text-center mt-7">
                        Loading...
                    </div>
                ) :
                searchStep === 1 ? (
                    <TfFamily 
                        families={families}
                        setFamilies={setFamilies}
                        allFamilies={allFamilies}
                        setAllFamilies={setAllFamilies}
                        selectedData={selectedData} 
                        setSelectedData={setSelectedData}
                    />
                ) : 
                searchStep === 2 ? (
                    <Species 
                        species={species} 
                        setSpecies={setSpecies}
                        allSpecies={allSpecies}
                        setAllSpecies={setAllSpecies}
                        roots={roots}
                        selectedData={selectedData}
                        setSelectedData={setSelectedData}
                    />
                ) : searchStep === 3 ? (
                    <>
                    <Technique 
                        expressionTechniques={expressionTechniques}
                        bindingTechniques={bindingTechniques}
                        inSilicoTechniques={inSilicoTechniques}
                        setExpressionTechniques={setExpressionTechniques}
                        setBindingTechniques={setBindingTechniques}
                        setInSilicoTechniques={setInSilicoTechniques}
                        allExpressionTechniques={allExpressionTechniques}
                        setAllExpressionTechniques={setAllExpressionTechniques}
                        allBindingTechniques={allBindingTechniques}
                        setAllBindingTechniques={setAllBindingTechniques}
                        allInSilicoTechniques={allInSilicoTechniques}
                        setAllInSilicoTechniques={setAllInSilicoTechniques}
                        selectedData={selectedData}
                        setSelectedData={setSelectedData}
                        categorySelected={categorySelected}
                        techniqueSearchNumber={techniqueSearchNumber}
                    />
                    </>
                ) : null
            }
        </>
    );
}

export default SearchManagement
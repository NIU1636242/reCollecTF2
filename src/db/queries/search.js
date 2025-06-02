//Functions that will run the queries

//Example 

import { runQuery } from "../queryExecutor";

export async function testQuery() {
    return runQuery("SELECT 1");
}

export async function getFirstAndSecondExpTechniques() {
  return runQuery("SELECT * FROM core_experimental_technique LIMIT 2");
}

export async function getTFNames() {
    return runQuery("SELECT name FROM core_TF")
}

export async function getTFWithFamilies() {

    const query = `
    SELECT 
        tff.TF_family_id as family_id, tff.name as family_name, 
        tf.TF_id as element_id, tf.name as element_name
    FROM core_tffamily tff
    LEFT JOIN core_tf tf ON tff.TF_family_id = tf.family_id
    ORDER BY tff.name, tf.name;
    `
    //This will return something like this:
    //[
    //  { family_id: 1, family_name: 'Family 1', element_id: 1, element_name: 'TF 1' },
    //  { family_id: 1, family_name: 'Family 1', element_id: 2, element_name: 'TF 2' },
    //  { family_id: 2, family_name: 'Family 2', element_id: 3, element_name: 'TF 3' },
    //  { family_id: 2, family_name: 'Family 2', element_id: 4, element_name: 'TF 4' },
    //  ...
    //]

    return runQuery(query)
}

export async function getAllTfFamilies() {
    return runQuery("SELECT TF_family_id, name FROM core_tffamily")
}

export async function getFamilyIdByTf(tfId) {
    const query = `
    SELECT family_id FROM core_tf tf
    WHERE tf.TF_id = "${tfId}";
    `    
    return runQuery(query)
}

export async function getCategoryIdByTechnique(techniqueId) {
    const query = `
    SELECT etc.experimentaltechniquecategory_id as category_id FROM core_experimentaltechnique_categories etc
    WHERE etc.experimentaltechnique_id = ${techniqueId};
    `    
    return runQuery(query)
}

export async function getTaxonomy() {
    return runQuery("SELECT id, name, parent_id FROM core_taxonomy ORDER BY parent_id");
}

export async function getExpTechniques() {
    //core_experimentaltechniquecategory cat core_experimental_technique et have N-N relationship
    //The table that joins them by the ids is core_experimentaltechnique_categories

    const query = `
    SELECT 
        ET.preset_function AS type,
        CAT.category_id AS category_id, 
        CAT.name AS category_name, 
        ET.technique_id AS id, 
        ET.name AS technique_name
    FROM core_experimentaltechniquecategory CAT
    JOIN core_experimentaltechnique_categories ETC ON CAT.category_id = ETC.experimentaltechniquecategory_id
    JOIN core_experimentaltechnique ET ON ETC.experimentaltechnique_id = et.technique_id
    ORDER BY CAT.category_id, ET.name;
    `
    //This will return something like this:
    //[
    //  { category: 1, category_name: 'Category 1', id: 1, name: 'Technique 1' },
    //  { category: 1, category_name: 'Category 1', id: 2, name: 'Technique 2' },
    //  { category: 2, category_name: 'Category 2', id: 3, name: 'Technique 3' },
    //  { category: 2, category_name: 'Category 2', id: 4, name: 'Technique 4' },
    //  ...
    //]

    return runQuery(query)
}

//Usage:

/*
    import { useEffect, useState } from "react";
    import { getFirstAndSecondExpTechniques } from "@/db/queries/search";

    export default function BioSampleList() {
        const [samples, setSamples] = useState([]);

        useEffect(() => {
            (async () => {
            const result = await getAllBioSamples();
            setSamples(result);
            })();
        }, []);

        return (
            <div>
            <h2>Experimental tachniques</h2>
            <ul>
                {samples.map((row, i) => (
                <li key={i}>{row.name}</li>
                ))}
            </ul>
            </div>
        );
    }
*/ 
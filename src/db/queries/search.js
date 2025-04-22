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
import SearchStep from "../general/SearchStep";
import { useSearch } from "../../contexts/SearchContext";
import ResultSummary from "./ResultSummary";
import { getSearchResults } from "@/db/queries/search.js"
import { useEffect, useState } from "react";

function SearchResults() {

    const {selectedData, setSelectedData } = useSearch();

    // Get results data

    //We have

    // selectedData.TF: Array of selected transcription factors by id
    // selectedData.Species: Array of selected species by id
    // selectedData.Techniques: Array of selected experimental techniques by catid.techid
        // Something like: [ catid-techniqueId1, catid-techniqueId2, ... ] -> need to remove catid

    const [results, setResults] = useState(new Map())

    //results example
    //[{param1: x param2: y param3: z}, {param1: a param2: b param3: c}]
    //Params needed:
    //core_curation => TF_species, curation_id
    //core_tf => name, 
    //core_tfinstance => uniprot_accession,
    //core_siteinstance => start, end, strand
    //core_curation_siteinstance => annotated_seq, TF_type
    //core_genome => genome_accession
    //core_gene => name, locus_tag
    //core_experimentaltechnique => name, EO_term
    //core_publication => publication_type, pmid

    //Doubts:
        // _seq from core_siteinstance and annotated_seq from core_curation_siteinstance are the same?
 
    //TODO: Use effect to fetch results based on selectedData

    useEffect(() => {
        let initResults = new Map()
        getSearchResults().then((res => {
            console.log(res);
            res.forEach(row => {

                //1: Unique instance for each result

                const key = `${row.TF_name}-${row.uniprot_accession}-${row.TF_species}`
                if (!initResults.has(key)) {
                    initResults.set(key, {
                        TF_name: row.TF_name,
                        uniprot_accession: row.uniprot_accession,
                        TF_species: row.TF_species,
                        table_data: new Map() //Map() with the rows of the results table. Each map is a row and its value has all the properties.
                    })
                }

                //2: Unique instance for each table row from each result

                let dataKey = `${row.TF_name}-${row.uniprot_accession}-${row.TF_species}-${row.annotated_seq}`
                const tableData = initResults.get(key).table_data

                if (!tableData.has(dataKey)) {
                        tableData.set(dataKey, {
                        curation_id: row.curation_id,
                        publication_type: row.publication_type,
                        pmid: row.pmid,
                        annotated_seq: row.annotated_seq,
                        TF_type: row.TF_type,
                        start: row.start,
                        end: row.end,
                        strand: row.strand,
                        genome_accession: row.genome_accession,
                        techniques: [],
                        gene_regulation: []
                    })
                }

                //3: We add only techniques and gene regualtions not repeated to its corresponding row

                const currentData = tableData.get(dataKey);

                const techKey = `${row.tech_name}-${row.EO_term}`;
                if (!currentData.techniques.some(t => `${t.tech_name}-${t.EO_term}` === techKey)) {
                    currentData.techniques.push({ tech_name: row.tech_name, EO_term: row.EO_term });
                }

                const geneKey = `${row.gene_name}-${row.locus_tag}`;
                if (!currentData.gene_regulation.some(g => `${g.gene_name}-${g.locus_tag}` === geneKey)) {
                    currentData.gene_regulation.push({ gene_name: row.gene_name, locus_tag: row.locus_tag });
                }
            });
            console.log(initResults);
            setResults(initResults);
        }))

    }, [])

    //TODO: Print ResultSummary component for each result
    return (
        <>
            <ResultSummary />
        </>
    );
}
export default SearchResults;
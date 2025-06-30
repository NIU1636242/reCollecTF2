
const ResultSummary = ({result}) => {

    const TF_NAME = result.uniprot_accession
    const TF_species = result.TF_species
    
    return (
        <>
            <div className="w-full max-w-7xl mx-auto">
                <table className="table-fixed w-full border-collapse border border-gray-400 text-center text-sm">

                <thead>
                    <tr>
                        <th className="border p-2">Genome</th>
                        <th className="border p-2">TF</th>
                        <th className="border p-2">TF conformation</th>
                        <th className="border p-2 break-words">Site Sequence</th>
                        <th className="border p-2">Site Location</th>
                        <th className="border p-2">Experimental Techniques</th>
                        <th className="border p-2">Gene Regulation</th>
                        <th className="border p-2">Curation</th>
                        <th className="border p-2">PMID</th>
                    </tr>
                </thead>
                <tbody>
                    {Array.from(result.table_data.entries()).map(([dataId, data]) => (
                        <tr key={dataId}>
                            <td className="border p-2"> 
                                <a className="text-accent hover:underline"
                                    href={`https://www.ncbi.nlm.nih.gov/nuccore/${data.genome_accession}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    {data.genome_accession}
                                </a>
                            </td>
                            <td className="border p-2"> 
                                <a className="text-accent hover:underline"
                                    href={`http://uniprot.org/uniprot/${TF_NAME}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    {TF_NAME}
                                </a>
                            </td>
                            <td className="border p-2">{data.TF_type}</td>
                            <td className="border p-2 break-words">{data.annotated_seq}</td>
                            <td className="border p-2">{`${data.strand == '-1' ? '- ' : data.strand == '1' ? '+ ' : ''} [${data.start}, ${data.end}]`}</td>
                            <td className="border p-2">
                                {data.techniques
                                    .map((technique) =>
                                        technique.EO_term
                                        ? `${technique.tech_name} (${technique.EO_term})`
                                        : technique.tech_name
                                    )
                                    .join(', ')
                                }
                            </td>
                            <td className="border p-2">
                                {data.gene_regulation
                                    .map((geneReg) =>
                                        geneReg.gene_name && geneReg.locus_tag
                                        ? (
                                            <span key={geneReg.locus_tag}>
                                                {geneReg.gene_name} (
                                                <a
                                                    className="text-accent hover:underline"
                                                    href={`https://www.ncbi.nlm.nih.gov/gene/?term=${geneReg.locus_tag}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    >
                                                    {geneReg.locus_tag}
                                                </a>
                                                )
                                            </span>
                                            )
                                        : geneReg.tech_name
                                    )
                                    .reduce((prev, curr) => prev === null ? [curr] : [...prev, ', ', curr], null)
                                }
                            </td>
                            <td className="border p-2">{data.curation_id}</td>
                            <td className="border p-2">
                                <a className="text-accent hover:underline"
                                    href={`https://pubmed.ncbi.nlm.nih.gov/${data.pmid}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    {data.pmid}
                                </a>
                            </td>
                        </tr>
                    ))}
                </tbody>
                </table>
            </div>
        </>
    )

}

export default ResultSummary;
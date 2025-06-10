import { useState, useEffect } from 'react';
import ResultView from './ResultView';

const ResultSummary = ({result}) => {

    const [isShown, setIsShown] = useState(false);
    const [summaryStyle, setSummaryStyle] = useState("flex border-b border-gray-300")
    const [tfName, setTfName] = useState(result.TF_name)
    const [uniprotId] = useState(result.uniprot_accession)

    useEffect (() => {
        console.log("Result: ", result);
    }, [])

    const handleResultIsShown = () => {
        const newIsShown = !isShown
        const newSummaryStyle = `flex border-b border-gray-300 ${newIsShown ? 'font-bold' : ''}`
        const newTfName = `${result.TF_name} ${newIsShown ? `(UniProtKB - ${uniprotId})`: ''}`
        setSummaryStyle(newSummaryStyle)
        setIsShown(newIsShown)
        setTfName(newTfName)
    }

    return (
        <>
            <div className={summaryStyle}>
                <div className="w-1/4 p-2">
                    { isShown ?
                        (<a className="text-blue-500 hover:underline" href={`http://uniprot.org/uniprot/${uniprotId}`} target="_blank" rel="noopener noreferrer">{tfName}</a>)
                    :
                        (tfName)
                    }
                </div>
                <div className="w-1/2 p-2">{result.TF_species}</div>
                <div className="w-1/4 p-2 flex justify-end"><button className="btn" onClick={handleResultIsShown}>{isShown ? "X" : "VIEW"}</button></div>
            </div>
            {isShown && (<ResultView result={result} setIsShown={setIsShown} />)}
        </>
    )

}

export default ResultSummary;
import { useState } from 'react';
import ResultView from './ResultView';

const ResultSummary = ({result}) => {

    const [isShown, setIsShown] = useState(false);
    const [uniprotId] = useState(result.uniprot_accession);

    const handleResultIsShown = () => {
        setIsShown(prev => !prev);
    };

    const summaryStyle = `flex border-b border-gray-300 ${isShown ? 'font-bold' : ''}`;
    const tfName = `${result.TF_name} ${isShown ? `(UniProtKB - ${uniprotId})` : ''}`;

    return (
        <>
            <div className={summaryStyle}>
                <div className="w-1/4 p-2">
                    { isShown ?
                        (<a className="text-accent hover:underline" href={`http://uniprot.org/uniprot/${uniprotId}`} target="_blank" rel="noopener noreferrer">{tfName}</a>)
                    :
                        (tfName)
                    }
                </div>
                <div className="w-1/2 p-2">{result.TF_species}</div>
                <div className="w-1/4 p-2 flex justify-end"><button className="btn" onClick={handleResultIsShown}>{isShown ? "X" : "VIEW"}</button></div>
            </div>
            {isShown && (<ResultView result={result} setIsShown={setIsShown}/>)}
        </>
    )

}

export default ResultSummary;
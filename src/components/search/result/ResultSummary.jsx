import { useState } from 'react';
import ResultView from './ResultView';

const ResultSummary = ({result}) => {




    const [isShown, setIsShown] = useState(false);

    return (
        <>
            <h1>Result Summary</h1>
            {isShown && (<ResultView result={result} setIsShown={setIsShown} />)}
        </>
    )

}

export default ResultSummary;
import { useNavigate } from "react-router-dom";

const ModalWarning = ({ tfValid, speciesValid, techniquesValid, emptyResult}) => {

    const navigate = useNavigate()

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-gray-900 p-4 rounded shadow-xl w-full max-w-md">
                <div className="flex justify-center items-center">
                    <h1 className="text-xl font-bold mb-4">{`${emptyResult ? "ERROR" : "WARNING"}`}</h1>
                </div>
                <div className="flex justify-center items-center">
                    <h2 className="text-center text-lg">
                        {
                            (!tfValid || !speciesValid || !techniquesValid) &&
                            `You didn't select any ${[
                            !tfValid && 'transcription factor',
                            !speciesValid && 'species',
                            !techniquesValid && 'technique'
                            ].filter(Boolean).join(', ').replace(/, ([^,]*)$/, ' or $1')}.` //replace last , for an and
                        }
                        {
                            (emptyResult) &&
                            `No results found for your search.`
                        }
                        <h3 className="mt-4 text-lg">Please, modify your search.</h3>
                    </h2>
                </div>
                {(!tfValid || emptyResult) && <div className="flex justify-center items-center"><button className="btn items-center mt-5" onClick={() => navigate('/Search/1')}>Modify</button></div>}
                {(tfValid && !speciesValid) && <div className="flex justify-center items-center"> <button className="btn items-center mt-5" onClick={() => navigate('/Search/2')}>Modify</button></div>}
                {(tfValid && speciesValid && !techniquesValid) && <div className="flex justify-center items-center"><button className="btn items-center mt-5" onClick={() => navigate('/Search/3')}>Modify</button></div>}
            </div>
        </div>
    )
};

export default ModalWarning;
import { useState } from 'react';
import { dispatchWorkflow } from '../../utils/serverless.js';
import { getAllTfFamilies } from '../../db/queries/search.js';
import { useEffect } from 'react';

function TfForm() {
    const [name, setName] = useState('');
    const [family, setFamily] = useState('');
    const [description, setDescription] = useState('');

    const [familyOptions, setFamilyOptions] = useState(['Loading...']);
    const [status, setStatus] = useState('');
    const [queries, setQueries] = useState({});
    const [numOfQueries, setNumOfQueries] = useState(0);
    const [showModal, setShowModal] = useState(false);


    useEffect(() => {
        // Fetch TF families when the component mounts
        getAllTfFamilies()
        .then((res) => {
            const families = res.map((row) => row);
            setFamilyOptions([{TF_family_id: 0, name: 'Select... '}, ...families]);        
        })
        .catch((err) => {
            console.error('Error fetching TF families:', err);
        });
    }, [])



    const handleSubmit = async (e) => {
        e.preventDefault();
        const action = e.nativeEvent.submitter.value;

        // Transform inputs to SQL queries

        if (action === 'save' && family !== 0) {
        const newQuery = `INSERT INTO core_tf (name, family_id, description) VALUES ('${name}', ${family}, '${description}');`;
        setQueries((prev) => {

            if (Object.values(prev).includes(newQuery)) {
            setStatus('This query already exists.');
            return prev;
            }

            const nextIndex = Object.keys(prev).length + 1;
            const newKey = `query${nextIndex}`;

            setNumOfQueries((prev) => prev + 1);
            return {...prev, [newKey]: newQuery}
            
        });
        setNumOfQueries((prev) => prev + 1);
        }
        
        if (action === 'send') {
        setStatus('Are you sure you want to send the data to the database?');
        setShowModal(true);
        }
    };

    const handleConfirmSend = async () => {
        try {
            const encodedQueries = btoa(JSON.stringify(queries));

            const res = await dispatchWorkflow({inputs: {queries: encodedQueries}});
            if (res.ok) {          
            setQueries({}); // Clear queries after sending
            setNumOfQueries(0); // Reset the number of queries
            setStatus('Your data has been sent to the database.');
            }
        } 
        catch (err) {
            setStatus('Something went wrong. Please try again.');
            console.error(err);
        }
        finally {
            setShowModal(false);
        }
    };

    const handleReset = () => {
        setName('');
        setFamily('');
        setDescription('');
        setQueries({});
        setNumOfQueries(0);
        setStatus('');
        setShowModal(false);
    }
  
    return (
        <div className="flex justify-center items-center min-h-screenpx-4 border border-gray-200">
            <form onSubmit={handleSubmit} className="p-6 rounded-lg shadow-md w-full max-w-xl space-y-4">
            <h2 className="text-2xl font-semibold mb-4">TF FORM</h2>
            
            {/* Name and Family */}
            <div className="flex flex-col md:flex-row md:space-x-4 space-y-2 md:space-y-0">
                <label className="flex-1">
                Name:
                <input
                    required
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="form-control w-full mt-1"
                />
                </label>
                <label className="flex-1">
                Family:
                <select
                    required
                    value={family}
                    onChange={(e) => setFamily(e.target.value)}
                    className="form-control w-full mt-1"
                >
                    {familyOptions.map((fam) => (
                    <option key={fam.TF_family_id} value={fam.TF_family_id}>
                        {fam.name}
                    </option>
                    ))}
                </select>
                </label>
            </div>

            {/* Description */}
            <label className="block">
                Description:
                <textarea
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="form-control w-full mt-1"
                />
            </label>

            {/* Buttons */}
            <div className="flex justify-center gap-2">
                <button type="submit" name="action" value="save" className="btn">+</button>
                <button type="reset" className="btn" onClick={handleReset}>Reset</button>
                <button disabled={numOfQueries === 0} type="submit" name="action" value="send" className="btn">Send to DATABASE</button>
            </div>

            {/* Queries output */}
            {numOfQueries > 0 && !showModal && (
                <div className="mt-2">
                {Object.entries(queries).map(([key, query]) => (
                    <p key={key} className="text-gray-500">{query}</p>
                ))}
                </div>
            )}

            {/* Status message */}
            {status && <p className="text-green-500">{status}</p>}

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                <div className="bg-gray-900 p-6 rounded shadow-xl w-full max-w-md mx-4">
                    <div className="flex justify-center items-center">
                    <p className="text-white text-center text-lg mb-4">{status}</p>
                    </div>
                    <div className="flex justify-center gap-4">
                    <button
                        className="btn"
                        onClick={() => {
                        setShowModal(false);
                        setStatus('');
                        }}
                    >
                        No
                    </button>
                    <button
                        className="btn"
                        onClick={handleConfirmSend}
                    >
                        Yes
                    </button>
                    </div>
                </div>
                </div>
            )}
            </form>
        </div>
    );
}

export default TfForm;
import TfForm from "../components/forms/TfForm.jsx";

function WritePage() {

    return (
        <div className="flex flex-col items-center justify-center text-center p-8 space-y-6">
            <h1 className="text-4xl font-bold">COLLECTF'S WRITE METHOD</h1>
            <h2 className="text-2xl font-semibold">How does it work?</h2>
            <ul className="text-lg list-disc text-left space-y-2 mt-4">
                <li>Write the new TF to be added.</li>
                <li>Select the existing family from the new TF.</li>
                <li>Write a description for the new TF.</li>
            </ul>
            <TfForm />
            <h3 className="text-xs font-semibold">Writes are only supported for Transcription Factors data at the moment.</h3>
        </div>
    );
}
export default WritePage;
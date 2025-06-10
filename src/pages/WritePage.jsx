import TfForm from "../components/forms/TfForm.jsx";

function WritePage() {

    return (
        <>
            <h1 className="text-5xl mb-4">Write to CollecTF</h1>
            <p>This is the Write Page.</p>
            <p>Here you can write new data to the database.</p>
            <p>Use the form for the table where you want to insert data.</p>
            <TfForm />
        </>
    );
}
export default WritePage;
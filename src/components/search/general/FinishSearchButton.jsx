import { useNavigate } from "react-router-dom";

function FinishSearchButton() {

    const navigate = useNavigate();


    const handleFinish = () => {
        navigate("/Search/4")
    }

    return (
        <button className="btn" onClick={handleFinish}>FINISH</button>
    );
}
export default FinishSearchButton;
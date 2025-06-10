import { useNavigate, useParams } from "react-router-dom";

function NextSearchButton() {
    const { step } = useParams();
    const searchStep = parseInt(step);
    const navigate = useNavigate();

    const goToNext = () => {
        const nextStep = searchStep + 1
        navigate (`/CollecTF/Search/${nextStep}`)
    }

    return (
      <button className="btn" onClick={goToNext}>NEXT</button>
    );
  }

export default NextSearchButton;
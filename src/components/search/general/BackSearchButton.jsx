import { useNavigate, useParams } from "react-router-dom";

function BackSearchButton() {
    const { step } = useParams();
    const searchStep = parseInt(step);
    const navigate = useNavigate();

    const handleBack = () => {
      const backStep = searchStep - 1
      if (backStep < 1) {
        navigate('/CollecTF/Search');
      } else {
        // Navigate to the previous step
        navigate(`/CollecTF/Search/${backStep}`)
      }
    }

    return (
      <button onClick={handleBack}>BACK</button>
    );
  }

export default BackSearchButton;
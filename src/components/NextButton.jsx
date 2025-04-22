import { useNavigate } from "react-router-dom";

function BackButton({searchStep}) {
    const navigate = useNavigate();

    const goToNext = () => {
        const nextStep = searchStep + 1
        navigate (`/CollecTF/Search/${nextStep}`)
    }

    return (
      <button onClick={goToNext}>NEXT</button>
    );
  }

export default BackButton;
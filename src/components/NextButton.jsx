import { useNavigate } from "react-router-dom";

function BackButton({searchStep, setStep}) {
    const navigate = useNavigate();

    const goToNext = () => {
        const nextStep = searchStep + 1
        setStep(nextStep)
        navigate (`/CollecTF/Search/${nextStep}`)
    }

    return (
      <button onClick={goToNext}>NEXT</button>
    );
  }

export default BackButton;
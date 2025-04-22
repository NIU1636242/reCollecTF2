import { useNavigate } from "react-router-dom";

function BackButton({step, setStep}) {
    const navigate = useNavigate();

    const handleClick = () => {
      const newStep = step - 1
      setStep(newStep)
      navigate(-1)
    }

    return (
      <button onClick={handleClick}>BACK</button>
    );
  }

export default BackButton;
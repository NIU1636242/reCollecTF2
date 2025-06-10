import { useNavigate } from "react-router-dom";

function FinishSearchButton() {

    //TO-DO: Add functionality to finish the search and navigate to the results page

    //TO:DO : Remove this part when finish button is implemented
    const navigate = useNavigate();

    const handleFinish = () => {
      navigate("/CollecTF/Search/4")
    }

    return (
      <button className="btn" onClick={handleFinish}>FINISH</button>
    );
  }

export default FinishSearchButton;
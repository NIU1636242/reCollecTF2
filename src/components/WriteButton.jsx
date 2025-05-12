import { Navigate, useNavigate } from "react-router-dom";

const WriteButton = () => {

    const navigate = useNavigate();

    return (<button onClick={ () => {navigate("/CollecTF/Write")}}>Write</button>)
}

export default WriteButton;
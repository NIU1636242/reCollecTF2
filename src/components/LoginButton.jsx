//import { useNavigate } from "react-router-dom";
//import "./Login.css";

function LoginButton({ isLoggedIn }) {
    return (
      <button>
        {isLoggedIn ? 'Log Out' : 'Log In'}
      </button>
    );
  }

export default LoginButton;
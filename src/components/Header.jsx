import { useNavigate } from "react-router-dom";
import SearchButton from "./SearchButton";
import LoginButton from "./LoginButton";
import WriteButton from "./WriteButton";
import "./Header.css";
import { useUser } from "./contexts/UserContext";


const Header = () => {
    const navigate = useNavigate();
    // const { user, userStatus, loading } = useSession();

    const { user, userStatus, loading } = useUser();
    
    const handleLogoClick = () => {
        navigate("/CollecTF/");
    };

    return (
        <header className="header">

        <h1 className="text-blue-400" onClick={handleLogoClick}>
            CollecTF
        </h1>

        {(userStatus == 2) && <WriteButton />}

        <SearchButton />

        <LoginButton userStatus={userStatus} user={user} loading={loading}/>

        </header>
    );
}

export default Header;
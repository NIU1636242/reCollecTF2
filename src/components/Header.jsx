import { useNavigate } from "react-router-dom";
import {useState} from "react";
import SearchButton from "./SearchButton";
import LoginButton from "./LoginButton";
import LoginModal from "./LoginModal";
import "./Header.css";

const Header = () => {
    const navigate = useNavigate();

    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
    
    const handleLogoClick = () => {
        navigate("/CollecTF/");
    };
    
    return (
        <header className="header">

        <h1 className="logo" onClick={handleLogoClick}>
            CollecTF
        </h1>

        <SearchButton />

        <LoginButton onClick={() => setIsLoginModalOpen(true)} isLoggedIn={isLoggedIn}/>

        {isLoginModalOpen && (
            <LoginModal
                isOpen={isLoginModalOpen}
                onClose={() => setIsLoginModalOpen(false)}
                setIsLoggedIn={setIsLoggedIn}
            />
        )}

        </header>
    );
}

export default Header;